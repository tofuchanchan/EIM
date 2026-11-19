"""Production WSGI entrypoint behind the trusted HTTPS reverse proxy."""
import argparse
from contextlib import closing
from email.message import Message
from http import HTTPStatus
from ipaddress import ip_address
import logging
import os
from pathlib import Path
import re
import secrets
import threading
from types import SimpleNamespace
from urllib.parse import quote, urlsplit

from mysql.connector import Error as MySQLError
from waitress import serve

from mysql_storage import SCHEMA_VERSION, db_connect, initialize
from server import ApiError, JSON_LIMIT, StudioHandler


LOGGER = logging.getLogger("invite.studio")
DOMAIN_LABEL = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", re.ASCII)


def canonical_origin(value):
    value = value.strip().rstrip("/")
    try:
        address = urlsplit(value)
        host = address.hostname
        if (
            address.scheme != "https" or not host or len(host) > 253
            or address.port not in (None, 443) or address.path or address.query or address.fragment
            or address.netloc.lower() not in (host, host + ":443")
            or len(host.split(".")) < 2
            or any(not DOMAIN_LABEL.fullmatch(label) for label in host.split("."))
        ):
            raise ValueError
        try:
            ip_address(host)
        except ValueError:
            return f"https://{host}"
        raise ValueError
    except ValueError:
        raise ValueError("INVITE_PUBLIC_ORIGIN 须为 HTTPS 域名，去掉路径和查询参数。") from None


def parse_ip(value):
    if not value or "%" in value:
        raise ValueError("IP address is missing or scoped.")
    address = ip_address(value)
    return getattr(address, "ipv4_mapped", None) or address


class ProductionRequest(StudioHandler):
    """Adapt the existing request and response methods to a single WSGI call."""

    def __init__(self, environ, server):
        self.server = server
        self.command = environ["REQUEST_METHOD"]
        self.path = environ.get("REQUEST_URI")
        if self.path is None:
            self.path = quote(environ["PATH_INFO"], encoding="latin-1")
            if environ.get("QUERY_STRING"):
                self.path += "?" + environ["QUERY_STRING"]
        self.headers = Message()
        for key, value in environ.items():
            if key.startswith("HTTP_"):
                self.headers[key[5:].replace("_", "-")] = value
        for field in ("CONTENT_TYPE", "CONTENT_LENGTH"):
            if environ.get(field) and not self.headers.get(field.replace("_", "-")):
                self.headers[field.replace("_", "-")] = environ[field]
        self.peer = environ.get("REMOTE_ADDR", "")
        self.client_address = (self.peer, 0)
        self.rfile = environ["wsgi.input"]
        self.wfile = self
        self.status = 500
        self.response_headers = []
        self.body = b""

    def send_response(self, code, message=None):
        self.status = code

    def send_header(self, keyword, value):
        self.response_headers.append((keyword, value))

    def end_headers(self):
        pass

    def write(self, data):
        self.body = data

    def log_error(self, message, *args):
        LOGGER.error(message, *args)

    def dispatch(self):
        if not self.path.startswith("/") or self.path.startswith("//"):
            raise ApiError(400, "请求地址无效。")
        try:
            peer = parse_ip(self.peer)
        except ValueError:
            raise ApiError(403, "请通过正式 HTTPS 地址访问。") from None
        health = self.command in ("GET", "HEAD") and self.path == "/healthz"
        if health and peer.is_loopback:
            self.readiness()
            return
        if peer != self.server.trusted_proxy:
            raise ApiError(403, "请通过正式 HTTPS 地址访问。")
        canonical_host = self.server.public_origin.removeprefix("https://")
        if self.headers.get("Host", "").lower() not in (canonical_host, canonical_host + ":443"):
            raise ApiError(403, "请通过正式 HTTPS 地址访问。")
        if health:
            self.readiness()
            return
        try:
            client = parse_ip(self.headers.get("X-Invite-Client-IP", ""))
        except ValueError:
            raise ApiError(400, "代理提供的客户端地址无效。") from None
        self.client_address = (str(client), 0)
        if self.command not in ("GET", "HEAD"):
            origin = self.headers.get("Origin")
            if origin and origin not in (self.server.public_origin, self.server.public_origin + ":443"):
                raise ApiError(403, "请在当前服务页面提交。")
            if origin and origin.endswith(":443"):
                self.headers.replace_header("Origin", self.server.public_origin)
        self.headers.replace_header("Host", canonical_host)
        super().dispatch()

    def readiness(self):
        with closing(db_connect(self.server.database_config)) as db:
            schema = db.one("SELECT schema_version FROM studio_meta WHERE singleton=1")
        if not schema or schema["schema_version"] != SCHEMA_VERSION:
            raise ApiError(503, "数据库结构未就绪。")
        self.reply({"ok": True})


def create_application(data_dir, public_origin, trusted_proxy):
    origin = canonical_origin(public_origin)
    try:
        proxy = parse_ip(trusted_proxy)
        if proxy.is_unspecified or proxy.is_multicast:
            raise ValueError
    except ValueError:
        raise ValueError("INVITE_TRUSTED_PROXY 须为 HTTPS 代理的单个 IP 地址。") from None
    server = SimpleNamespace(
        database_config=initialize(Path(data_dir)),
        local_only=False,
        secure_cookie=True,
        public_origin=origin,
        trusted_proxy=proxy,
        wechat_configured=False,
        dummy_salt=secrets.token_bytes(16),
        rate_lock=threading.Lock(),
        login_attempts={},
    )

    def application(environ, start_response):
        request = ProductionRequest(environ, server)
        request.handle_request()
        start_response(f"{request.status} {HTTPStatus(request.status).phrase}", request.response_headers)
        return [request.body]

    return application


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--data-dir", type=Path, default=Path("/run/invite-studio"))
    cli.add_argument("--host", default="127.0.0.1")
    cli.add_argument("--port", type=int, default=8080)
    cli.add_argument("--threads", type=int, default=8, choices=range(2, 33))
    args = cli.parse_args()
    logging.basicConfig(level=logging.INFO)
    try:
        application = create_application(args.data_dir, os.getenv("INVITE_PUBLIC_ORIGIN", ""),
                                         os.getenv("INVITE_TRUSTED_PROXY", ""))
    except MySQLError as error:
        cli.exit(1, f"无法连接系统数据库（MySQL 错误 {error.errno}）。\n")
    except ValueError as error:
        cli.exit(1, f"{error}\n")
    serve(application, host=args.host, port=args.port, threads=args.threads, channel_timeout=30,
          connection_limit=128, max_request_body_size=JSON_LIMIT, max_request_header_size=32 * 1024,
          clear_untrusted_proxy_headers=True)


if __name__ == "__main__":
    main()
