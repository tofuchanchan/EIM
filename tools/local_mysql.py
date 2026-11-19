"""Provision or start EIM's private Windows MySQL instance (loopback only)."""
import argparse
from contextlib import closing
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from mysql import connector
from mysql_storage import db_connect, load_config


def restrict(directory):
    directory.mkdir(parents=True, exist_ok=True)
    identity = subprocess.check_output(["whoami", "/user", "/fo", "csv", "/nh"])
    sid = re.search(rb"S-1-[\d-]+", identity).group().decode("ascii")
    subprocess.run(["icacls", str(directory), "/inheritance:r", "/grant:r",
                    f"*{sid}:(OI)(CI)F", "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"],
                   check=True, stdout=subprocess.DEVNULL)


def save_secret(path, data):
    if not path.exists():
        with path.open("x", encoding="utf-8") as stream:
            json.dump(data, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
    return load_config(path)


def provision(executable, directory, port):
    private = directory / "mysql-private"
    service = directory / "mysql-service"
    restrict(private)
    restrict(service)
    ini = service / "my.ini"
    if (service / "provisioned").is_file():
        app = load_config(private / "connection.json")
        if app.get("port") != port:
            raise ValueError("已有实例的端口与本次参数不一致。")
        start(executable, directory)
        return
    if not ini.exists() and (private / "connection.json").exists():
        raise ValueError("此目录已有数据库配置，请为专用实例使用独立目录。")
    if not ini.exists():
        basedir = executable.parent.parent.as_posix()
        ini.write_text(
            f'[mysqld]\nbasedir="{basedir}"\ndatadir="{(service / "store").as_posix()}"\n'
            f'port={port}\nbind-address=127.0.0.1\nmysqlx=OFF\nskip-name-resolve=ON\n'
            f'log-error="{(service / "mysql.log").as_posix()}"\n'
            'local-infile=OFF\nsecure-file-priv=NULL\nskip-log-bin\n'
            'character-set-server=utf8mb4\ncollation-server=utf8mb4_0900_bin\n'
            'innodb-buffer-pool-size=64M\ninnodb-redo-log-capacity=64M\nmax-allowed-packet=64M\n',
            encoding="utf-8",
        )
    config = {"host": "127.0.0.1", "port": port}
    def account(filename, user, database=None):
        values = dict(config, user=user, password=secrets.token_urlsafe(36))
        if database:
            values["database"] = database
        return save_secret(private / filename, values)

    root = account("recovery.json", "root")
    app = account("connection.json", "invite_app", "invite_studio")
    maintenance = account("maintenance.json", "invite_maint", "invite_studio")
    test = account("test.json", "invite_test")
    if app["port"] != port:
        raise ValueError("已有实例的端口与本次参数不一致。")
    if not (service / "store" / "mysql.ibd").is_file():
        subprocess.run([str(executable), f"--defaults-file={ini}", "--initialize"],
                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       creationflags=subprocess.CREATE_NO_WINDOW, check=True, timeout=180)
    bootstrap = private / "initial.sql"
    # Credentials are generated with the URL-safe alphabet; no password is passed in argv.
    statements = []
    for acct in (root, app, maintenance, test):
        if not re.fullmatch(r"[A-Za-z0-9_-]{40,64}", acct["password"]):
            raise ValueError("初始化凭据格式无效。")
    statements.append(f"ALTER USER 'root'@'localhost' IDENTIFIED BY '{root['password']}';")
    statements.append("CREATE DATABASE IF NOT EXISTS invite_studio CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;")
    for acct in (app, maintenance, test):
        statements.append(f"CREATE USER IF NOT EXISTS '{acct['user']}'@'127.0.0.1' IDENTIFIED BY '{acct['password']}';")
    statements += ["GRANT SELECT, INSERT, UPDATE, DELETE ON invite_studio.* TO 'invite_app'@'127.0.0.1';",
                   "GRANT ALL ON invite_studio.* TO 'invite_maint'@'127.0.0.1';",
                   "GRANT ALL ON `inviteqa\\_%`.* TO 'invite_test'@'127.0.0.1';"]
    bootstrap.write_text("\n".join(statements) + "\n", encoding="ascii")
    try:
        start(executable, directory, bootstrap)
        # Validate the dedicated accounts before marking initialization complete.
        for acct in (app, maintenance, test):
            with closing(db_connect(acct)) as db:
                db.one("SELECT 1 AS ready")
        (service / "provisioned").write_text("MySQL 8.4 local instance\n", encoding="ascii")
    finally:
        bootstrap.unlink(missing_ok=True)


def start(executable, directory, bootstrap=None):
    service = directory / "mysql-service"
    config = load_config(directory / "mysql-private" / "connection.json")
    expected = (service / "store").resolve()
    def ready():
        try:
            with closing(db_connect(config)) as db:
                row = db.one("SELECT @@datadir AS data_dir, VERSION() AS version")
                if Path(row["data_dir"]).resolve() != expected:
                    raise ValueError("此端口连接到了其他 MySQL 实例。")
                return row["version"]
        except connector.Error:
            return None
    if version := ready():
        print(f"MySQL {version} ready on 127.0.0.1:{config['port']}")
        return
    with socket.socket() as sock:
        sock.settimeout(1)
        if sock.connect_ex(("127.0.0.1", config["port"])) == 0:
            raise ValueError("端口已被占用且项目数据库账号未通过验证，请检查本机实例。")
    args = [str(executable), f"--defaults-file={service / 'my.ini'}"]
    if bootstrap:
        args.append(f"--init-file={bootstrap}")
    process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
    for _ in range(80):
        if process.poll() is not None:
            break
        if version := ready():
            print(f"MySQL {version} ready on 127.0.0.1:{config['port']} (PID {process.pid})")
            return
        time.sleep(0.25)
    raise RuntimeError(f"MySQL 启动未完成，请核对 {service / 'mysql.log'}。")


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("command", choices=("start", "provision"))
    cli.add_argument("--data-dir", type=Path, default=ROOT / "data")
    cli.add_argument("--port", type=int, default=13306)
    options = cli.parse_args()
    exe = ROOT / ".runtime/mysql/bin/mysqld.exe"
    if os.name != "nt" or not exe.is_file():
        cli.exit(1, "需要已安装的项目专用 Windows MySQL 运行时。\n")
    if options.command == "provision":
        provision(exe, options.data_dir.resolve(), options.port)
    else:
        start(exe, options.data_dir.resolve())
