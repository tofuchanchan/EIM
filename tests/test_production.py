"""Production proxy and session checks on the shared application routes."""
from contextlib import ExitStack, closing
from importlib.util import find_spec
from io import BytesIO
import json
import secrets
import subprocess
import sys
import tempfile
import unittest
from urllib.parse import urlsplit
from wsgiref.util import setup_testing_defaults

from mysql_fixture import mysql_schema
from mysql_storage import ROOT, db_connect


@unittest.skipUnless(find_spec("waitress"), "Install requirements-production.txt for production tests")
class ProductionRoutes(unittest.TestCase):
    PROXY = "192.0.2.10"
    CLIENT = "203.0.113.20"
    DOMAIN = "invite.example.com"
    ORIGIN = "https://" + DOMAIN

    def setUp(self):
        from production import create_application

        resources = ExitStack()
        self.addCleanup(resources.close)
        folder = resources.enter_context(tempfile.TemporaryDirectory())
        self.database = resources.enter_context(mysql_schema(folder))
        self.application = create_application(folder, self.ORIGIN, self.PROXY)
        self.password = secrets.token_urlsafe(24)
        subprocess.run(
            [sys.executable, "-B", "server.py", "user-add", "--data-dir", folder, "--username", "prod-admin"],
            input=self.password + "\n", text=True, cwd=ROOT, capture_output=True, check=True,
        )

    def request(self, method, target, payload=None, *, peer=None, host=None, origin=None, cookie=""):
        address = urlsplit(target)
        body = b"" if payload is None else json.dumps(payload).encode()
        environ = {}
        setup_testing_defaults(environ)
        environ.update(
            REQUEST_METHOD=method, PATH_INFO=address.path, QUERY_STRING=address.query,
            CONTENT_TYPE="application/json", CONTENT_LENGTH=str(len(body)),
            HTTP_HOST=host or self.DOMAIN, REMOTE_ADDR=peer or self.PROXY,
            HTTP_X_INVITE_CLIENT_IP=self.CLIENT, HTTP_COOKIE=cookie,
        )
        environ["wsgi.input"] = BytesIO(body)
        if origin:
            environ["HTTP_ORIGIN"] = origin
        result = []

        def start_response(status, headers):
            result.extend((int(status.split()[0]), dict(headers)))

        response = b"".join(self.application(environ, start_response))
        return result[0], result[1], response

    def test_production_gateway_readiness_and_origin(self):
        self.assertEqual(self.request("GET", "/healthz", peer="127.0.0.1")[0], 200)
        self.assertEqual(self.request("GET", "/", peer="192.0.2.11")[0], 403)
        self.assertEqual(self.request("GET", "/", host="another.example.com")[0], 403)
        _, _, body = self.request("GET", "/api/session")
        self.assertFalse(json.loads(body)["setupRequired"])
        self.assertEqual(self.request("POST", "/api/setup", {}, origin=self.ORIGIN)[0], 403)
        self.assertEqual(self.request("POST", "/api/login", {}, origin="http://" + self.DOMAIN)[0], 403)
        self.assertEqual(self.request("POST", "/api/login", {}, origin="https://another.example.com")[0], 403)

    def test_production_login_and_public_short_link(self):
        status, headers, _ = self.request(
            "POST", "/api/login", {"username": "prod-admin", "password": self.password}, origin=self.ORIGIN,
        )
        self.assertEqual(status, 200)
        self.assertIn("; Secure", headers["Set-Cookie"])
        self.assertIn("; HttpOnly", headers["Set-Cookie"])
        with closing(db_connect(self.database)) as db:
            self.assertEqual(db.one("SELECT ip FROM member_logins ORDER BY seq DESC LIMIT 1")["ip"], self.CLIENT)
        cookie = headers["Set-Cookie"].split(";", 1)[0]
        status, _, body = self.request("GET", "/api/events/caiyun2025/publication", cookie=cookie)
        self.assertEqual(status, 200)
        short_url = json.loads(body)["url"]
        self.assertTrue(short_url.startswith(self.ORIGIN + "/s/"))
        status, _, html = self.request("GET", urlsplit(short_url).path)
        self.assertEqual(status, 200)
        self.assertIn(short_url.encode(), html)
