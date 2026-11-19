"""MySQL storage for EIM. All live HTTP requests use InnoDB."""
from contextlib import closing, contextmanager
import json
from pathlib import Path
import secrets
from string import ascii_letters, digits

from mysql import connector
from mysql.connector import IntegrityError, errorcode


ROOT = Path(__file__).resolve().parent
SCHEMA_VERSION = 4
CONFIG_KEYS = {"host", "port", "user", "password", "database", "ssl_ca",
               "ssl_verify_cert", "ssl_verify_identity"}


def load_config(path):
    path = Path(path)
    if not path.is_file():
        raise ValueError(f"MySQL 配置不存在：{path}。请先配置数据库并完成初始化或迁移。")
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(data, dict) or set(data) - CONFIG_KEYS:
        raise ValueError("MySQL 配置项无效。")
    if not all(isinstance(data.get(k), str) and data[k] for k in ("host", "user", "password")):
        raise ValueError("MySQL 配置缺少主机或账号。")
    return data


def username_key(name):
    # Preserve the original SQLite NOCASE login semantics (ASCII A–Z only).
    return name.translate(str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ",
                                        "abcdefghijklmnopqrstuvwxyz")).encode("utf-8")


class Database:
    def __init__(self, config):
        self.connection = connector.connect(**config, charset="utf8mb4", autocommit=True,
                                            use_pure=True, connection_timeout=8)

    def close(self):
        self.connection.close()

    def one(self, sql, params=()):
        with self.connection.cursor(dictionary=True, buffered=True) as cursor:
            cursor.execute(sql, params)
            return cursor.fetchone()

    def all(self, sql, params=()):
        with self.connection.cursor(dictionary=True, buffered=True) as cursor:
            cursor.execute(sql, params)
            return cursor.fetchall()

    def execute(self, sql, params=()):
        with self.connection.cursor() as cursor:
            cursor.execute(sql, params)
            return cursor.lastrowid


db_connect = Database


@contextmanager
def transaction(db, *, write):
    db.connection.start_transaction(isolation_level="READ COMMITTED" if write else "REPEATABLE READ",
                                    readonly=not write)
    try:
        yield
        db.connection.commit()
    except BaseException:
        db.connection.rollback()
        raise


def initialize(directory):
    """Verify an already-provisioned database; the application only needs DML privileges."""
    config = load_config(Path(directory) / "mysql-private" / "connection.json")
    if not config.get("database"):
        raise ValueError("MySQL 配置缺少数据库名。")
    with closing(db_connect(config)) as db:
        meta = db.one("SELECT schema_version FROM studio_meta WHERE singleton=1")
        if not meta or meta["schema_version"] != SCHEMA_VERSION:
            raise ValueError("MySQL 数据库尚未初始化，或结构版本不兼容。")
    return config


def create_tables(db):
    script = (ROOT / "mysql_schema.sql").read_text(encoding="utf-8")
    for statement in script.split(";"):
        if statement.strip():
            db.execute(statement.strip())


def allocate_publication(db, event_id, accepting):
    for _ in range(16):
        code = "".join(secrets.choice(ascii_letters + digits) for _ in range(8))
        try:
            db.execute("INSERT INTO event_publications(event_id,short_code,accepting) VALUES(%s,%s,%s)",
                       (event_id, code, accepting))
            return
        except IntegrityError as exc:
            if exc.errno != errorcode.ER_DUP_ENTRY:
                raise
            if db.one("SELECT short_code FROM event_publications WHERE event_id=%s", (event_id,)):
                return
    raise RuntimeError("无法分配活动短码。")


def allocate_legacy_publications(db):
    rows = db.all("""SELECT e.id,CASE WHEN JSON_VALID(e.published)
                         THEN JSON_UNQUOTE(JSON_EXTRACT(e.published,'$.status'))='live' ELSE FALSE END accepting
                     FROM events e LEFT JOIN event_publications p ON p.event_id=e.id
                     WHERE e.published IS NOT NULL AND p.event_id IS NULL""")
    for row in rows:
        allocate_publication(db, row["id"], bool(row["accepting"]))
