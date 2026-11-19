"""Initialize a fresh MySQL schema or import and verify an existing SQLite snapshot."""
import argparse
from contextlib import closing, contextmanager
import hashlib
import json
from pathlib import Path
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from invite_packages import validate_event
from mysql_storage import (
    SCHEMA_VERSION, allocate_legacy_publications, create_tables, db_connect, load_config, transaction, username_key,
)


# All persisted fields, including the insertion order used by the workspace.
TABLES = {
    "users": ("id username username_key password_hash salt role", "id"),
    "sessions": ("digest user_id expires", "digest"),
    "events": ("seq id draft published owner_id", "seq"),
    "registrations": ("seq id event_id request_id version at fields_json values_json", "seq"),
    "registration_identities": ("event_id kind digest registration_id", "event_id,kind,digest"),
}


def fingerprint(rows):
    digest = hashlib.sha256()
    count = 0
    for row in rows:
        values = [{"bytes": bytes(v).hex()} if isinstance(v, (bytes, bytearray, memoryview)) else v for v in row]
        digest.update(json.dumps(values, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n")
        count += 1
    return {"rows": count, "sha256": digest.hexdigest()}


@contextmanager
def snapshot(path):
    with closing(sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True)) as src:
        src.execute("BEGIN")
        if src.execute("PRAGMA integrity_check").fetchall() != [("ok",)] or src.execute("PRAGMA foreign_key_check").fetchone():
            raise ValueError("SQLite 快照未通过完整性检查。")
        if src.execute("PRAGMA user_version").fetchone()[0] not in (1, 2):
            raise ValueError("不支持的 SQLite 结构版本。")
        yield src


def source_rows(src, table):
    columns, order = TABLES[table]
    if table == "registration_identities" and src.execute("PRAGMA user_version").fetchone()[0] == 1:
        return
    fields = [("rowid" if c == "seq" else c) for c in columns.split() if c != "username_key"]
    sql = f"SELECT {','.join(fields)} FROM {table} ORDER BY {order.replace('seq','rowid')}"
    for row in src.execute(sql):
        if table == "users":
            row = (*row[:2], username_key(row[1]), *row[2:])
        yield row


def target_report(db):
    report = {}
    for table, (columns, order) in TABLES.items():
        fields = ",".join(f"`{col}`" for col in columns.split())
        with db.connection.cursor() as cursor:
            cursor.execute(f"SELECT {fields} FROM `{table}` ORDER BY {order}")
            report[table] = fingerprint(cursor)
    return report


def compare(expected, actual):
    mismatches = [table for table in expected if expected[table] != actual[table]]
    if mismatches:
        raise ValueError("逐字段校验不一致：" + ", ".join(mismatches))


def setup_database(config, source=None, verify_only=False, upgrade=False, *, seed_samples=True):
    schema = config.get("database")
    if upgrade and (verify_only or source):
        raise ValueError("结构升级应独立运行。")
    if not seed_samples and (source or verify_only or upgrade):
        raise ValueError("跳过样例仅适用于初始化。")
    if not schema or schema.lower() in ("mysql", "information_schema", "performance_schema", "sys"):
        raise ValueError("请指定 EIM 的独立业务库。")
    with closing(db_connect(config)) as db:
        lock = "invite-schema:" + hashlib.sha256(schema.encode()).hexdigest()[:40]
        if db.one("SELECT GET_LOCK(%s,10) AS acquired", (lock,))["acquired"] != 1:
            raise RuntimeError("已有初始化或迁移任务运行中。")
        existing = {r["TABLE_NAME"] for r in db.all(
            "SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema=DATABASE()")}
        extensions = {"studio_meta", "event_visits", "member_state", "password_links", "member_logins",
                      "event_operations", "event_publications"}
        if existing - (set(TABLES) | extensions):
            raise ValueError("目标包含其他应用的表，不能用作 EIM 迁移库。")
        if upgrade:
            if "studio_meta" not in existing:
                raise ValueError("升级需要已初始化的 EIM 业务库。")
            meta = db.one("SELECT schema_version FROM studio_meta WHERE singleton=1")
            if not meta or not 1 <= meta["schema_version"] <= SCHEMA_VERSION:
                raise ValueError("不支持此结构版本。")
            create_tables(db)
            with transaction(db, write=True):
                allocate_legacy_publications(db)
                db.execute("UPDATE studio_meta SET schema_version=%s WHERE singleton=1", (SCHEMA_VERSION,))
            return {"schema_version": SCHEMA_VERSION}
        if "studio_meta" not in existing and any(db.one(f"SELECT 1 AS present FROM `{t}` LIMIT 1") for t in existing):
            raise ValueError("目标库已有数据，已停止初始化。")
        if not verify_only:
            create_tables(db)
        with transaction(db, write=not verify_only):
            meta = db.one("SELECT schema_version,source_digest FROM studio_meta WHERE singleton=1")
            if meta and meta["schema_version"] != SCHEMA_VERSION:
                raise ValueError("目标数据库结构版本不兼容。")
            if not meta and any(db.one(f"SELECT 1 AS present FROM `{t}` LIMIT 1") for t in TABLES):
                raise ValueError("目标库已有数据但没有 EIM 迁移标记，已停止导入。")
            if verify_only and (not meta or not source):
                raise ValueError("校验需要已初始化的 MySQL 目标和 SQLite 快照。")
            if source:
                with snapshot(source) as src:
                    expected = {t: fingerprint(source_rows(src, t)) for t in TABLES}
                    manifest = hashlib.sha256(json.dumps(expected, sort_keys=True).encode()).hexdigest()
                    if meta and meta["source_digest"] != manifest:
                        raise ValueError("目标库不对应本次快照，已停止导入。")
                    if not meta:
                        for table, (columns, _) in TABLES.items():
                            fields = columns.split()
                            names = ",".join(f"`{c}`" for c in fields)
                            marks = ",".join(["%s"] * len(fields))
                            for row in source_rows(src, table):
                                db.execute(f"INSERT INTO `{table}` ({names}) VALUES ({marks})", row)
                    compare(expected, target_report(db))
                    if not meta:
                        allocate_legacy_publications(db)
                        db.execute("INSERT INTO studio_meta(singleton,schema_version,source_digest) VALUES(1,%s,%s)",
                                   (SCHEMA_VERSION, manifest))
                    return expected
            if not meta:
                if seed_samples:
                    for event in json.loads((ROOT / "seed-events.json").read_text(encoding="utf-8-sig")):
                        validate_event(event)
                        data = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
                        db.execute("INSERT INTO events(id,draft,published) VALUES(%s,%s,%s)",
                                   (event["id"], data, data if event["status"] != "draft" else None))
                    allocate_legacy_publications(db)
                db.execute("INSERT INTO studio_meta(singleton,schema_version) VALUES(1,%s)", (SCHEMA_VERSION,))
            return None


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--config", type=Path, required=True, help="MySQL maintenance connection JSON")
    mode = cli.add_mutually_exclusive_group(required=True)
    mode.add_argument("--sqlite", type=Path, help="Import from a read-only SQLite backup")
    mode.add_argument("--empty-install", action="store_true", help="Initialize a fresh workspace with the historical sample")
    mode.add_argument("--upgrade", action="store_true", help="Upgrade an existing EIM MySQL database in place")
    cli.add_argument("--verify-only", action="store_true")
    cli.add_argument("--no-samples", action="store_true", help="Skip the demo activity during --empty-install")
    args = cli.parse_args()
    if args.no_samples and (not args.empty_install or args.verify_only):
        cli.error("--no-samples requires --empty-install without --verify-only")
    result = setup_database(load_config(args.config), args.sqlite, args.verify_only, args.upgrade,
                            seed_samples=not args.no_samples)
    print(json.dumps(result or {"initialized": True}, ensure_ascii=False, indent=2))
