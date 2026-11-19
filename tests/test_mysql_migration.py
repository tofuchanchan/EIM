from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import hashlib
from pathlib import Path
import sqlite3
import tempfile
import unittest

from mysql_fixture import mysql_schema
from mysql_storage import db_connect, transaction, username_key
from server import ApiError, create_user
from tools.migrate_mysql import setup_database


def make_legacy(path, version=2):
    with closing(sqlite3.connect(path)) as db:
        db.executescript("""
          CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,password_hash BLOB,salt BLOB,role TEXT);
          CREATE TABLE sessions(digest TEXT PRIMARY KEY,user_id INTEGER,expires INTEGER);
          CREATE TABLE events(id TEXT PRIMARY KEY,draft TEXT,published TEXT,owner_id INTEGER);
          CREATE TABLE registrations(id TEXT PRIMARY KEY,event_id TEXT,request_id TEXT,version INTEGER,
                                     at TEXT,fields_json TEXT,values_json TEXT);
        """)
        db.execute("PRAGMA user_version=" + str(version))
        db.execute("INSERT INTO users VALUES(17,'Vincent测试',?,?, 'admin')", (bytes(range(32)),bytes(range(16))))
        db.execute("INSERT INTO sessions VALUES(?,17,2000000000)", ("a"*64,))
        db.execute("INSERT INTO events(rowid,id,draft,published,owner_id) VALUES(8,'AbC',?,?,17)",
                   ('{"title":"测试🌊","version":3}', '{"version":1}'))
        db.execute("INSERT INTO events(rowid,id,draft,published,owner_id) VALUES(12,'abc','{}',NULL,NULL)")
        db.execute("""INSERT INTO registrations VALUES('rOne','AbC','uniqueReq',1,
                    '2026-11-18T12:11:10.125+00:00','[{"key":"phone"}]','{"phone":"13800000001"}')""")
        if version == 2:
            db.execute("CREATE TABLE registration_identities(event_id TEXT,kind TEXT,digest BLOB,registration_id TEXT)")
            db.execute("INSERT INTO registration_identities VALUES('AbC','phone',?,'rOne')",
                       (hashlib.sha256(b"identity").digest(),))
        db.commit()


class MySQLMigration(unittest.TestCase):
    def test_production_initialization_skips_demo_activity(self):
        with mysql_schema(seed=False) as config, closing(db_connect(config)) as db:
            setup_database(config, seed_samples=False)
            setup_database(config)
            self.assertEqual(db.one("SELECT COUNT(*) n FROM events")["n"], 0)
            self.assertEqual(db.one("SELECT COUNT(*) n FROM event_publications")["n"], 0)
            self.assertEqual(db.one("SELECT schema_version FROM studio_meta WHERE singleton=1")["schema_version"], 4)

    def test_all_fields_order_binary_sessions_and_retry(self):
        with mysql_schema(seed=False) as target, tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/"old.sqlite3"
            make_legacy(path)
            report = setup_database(target, path)
            self.assertEqual([v["rows"] for v in report.values()], [1,1,2,1,1])
            self.assertEqual(setup_database(target, path, verify_only=True), report)
            self.assertEqual(setup_database(target, path), report)
            with closing(db_connect(target)) as db:
                self.assertEqual(db.one("SELECT id FROM users WHERE username_key=%s", (username_key("vINCENT测试"),))["id"], 17)
                self.assertEqual([r["seq"] for r in db.all("SELECT seq FROM events ORDER BY seq")], [8,12])
                self.assertIsNone(db.one("SELECT published FROM events WHERE id='abc'")["published"])
                db.execute("UPDATE events SET draft='changed' WHERE id='AbC'")
            with self.assertRaisesRegex(ValueError, "校验不一致"):
                setup_database(target, path)
            with closing(db_connect(target)) as db:
                self.assertEqual(db.one("SELECT draft FROM events WHERE id='AbC'")["draft"], "changed")

    def test_v1_source_without_identity_table(self):
        with mysql_schema(seed=False) as target, tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/"old.sqlite3"
            make_legacy(path, version=1)
            report = setup_database(target, path)
            self.assertEqual(report["registration_identities"]["rows"],0)

    def test_failed_import_rolls_back_and_can_be_retried(self):
        with mysql_schema(seed=False) as target, tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/"old.sqlite3"
            make_legacy(path)
            with closing(sqlite3.connect(path)) as legacy, legacy:
                legacy.execute("UPDATE events SET owner_id=9999 WHERE id='AbC'")
            from mysql.connector import IntegrityError
            with self.assertRaises(IntegrityError):
                setup_database(target, path)
            with closing(db_connect(target)) as db:
                self.assertIsNone(db.one("SELECT * FROM users LIMIT 1"))
                self.assertIsNone(db.one("SELECT * FROM studio_meta"))
            with closing(sqlite3.connect(path)) as legacy, legacy:
                legacy.execute("UPDATE events SET owner_id=17 WHERE id='AbC'")
            self.assertEqual(setup_database(target, path)["events"]["rows"],2)

    def test_concurrent_first_admin(self):
        with mysql_schema() as config:
            def setup(n):
                try:
                    with closing(db_connect(config)) as db, transaction(db,write=True):
                        return create_user(db,f"operator{n}",bytes(16),bytes(32),first_only=True)["role"]
                except ApiError as error:
                    return error.status
            with ThreadPoolExecutor(2) as pool:
                self.assertCountEqual(pool.map(setup,range(2)),["admin",409])
