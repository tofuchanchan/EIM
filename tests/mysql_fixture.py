"""A disposable schema per test. The test account only manages the inviteqa_ prefix."""
from contextlib import closing, contextmanager
import json
import os
from pathlib import Path
import secrets
import unittest

from mysql_storage import ROOT, db_connect, load_config
from tools.migrate_mysql import setup_database


@contextmanager
def mysql_schema(directory=None, *, seed=True):
    path = Path(os.environ.get("INVITE_TEST_MYSQL_CONFIG", ROOT / "data/mysql-private/test.json"))
    if not path.is_file():
        raise unittest.SkipTest("MySQL integration requires a dedicated INVITE_TEST_MYSQL_CONFIG")
    account = load_config(path)
    if account.get("database"):
        raise ValueError("测试账号配置不能指向已存在的业务库。")
    name = "inviteqa_" + secrets.token_hex(12)
    with closing(db_connect(account)) as control:
        control.execute(f"CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin")
        config = dict(account, database=name)
        try:
            if seed:
                setup_database(config)
            if directory:
                private = Path(directory) / "mysql-private"
                if os.name == "nt":
                    from tools.local_mysql import restrict
                    restrict(private)
                else:
                    private.mkdir(mode=0o700)
                with (private / "connection.json").open("x", encoding="utf-8") as f:
                    json.dump(config, f)
            yield config
        finally:
            # The schema has a fresh random name generated in this same scope.
            control.execute(f"DROP DATABASE `{name}`")
