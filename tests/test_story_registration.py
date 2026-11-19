"""Validate story definitions and enforce published signup rules against isolated MySQL databases."""
import base64
import concurrent.futures
from contextlib import closing
import io
import json
from pathlib import Path
import secrets
import sys
import unittest

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from mysql_fixture import mysql_schema
from invite_packages import ValidationError, validate_event
from server import ApiError, compact, db_connect, registration, save_event, transaction


def event(event_id="eventFirst"):
    sample = json.loads((ROOT / "seed-events.json").read_text(encoding="utf-8"))[0]
    sample.update(id=event_id, version=1, status="draft", fields=[
        dict(key="mobile", label="手机", required=False),
        dict(key="wx", label="账户", required=False),
        dict(key="backup", label="备用", required=False),
    ])
    return sample


class StoryContractTests(unittest.TestCase):
    def test_old_and_new_events(self):
        original = event()
        validate_event(original)
        stream = io.BytesIO()
        Image.new("RGB", (16, 16), "#7711aa").save(stream, "PNG")
        image = "data:image/png;base64," + base64.b64encode(stream.getvalue()).decode()
        story = dict(font="serif", accent="#aaaaaa", background="#fce118",
                     mapUrl="https://example.org/c?q=meeting", followUrl="", followImage=image,
                     pages=[dict(type=kind, title=kind, body="")
                            for kind in ("cover", "letter", "organizers", "about", "rsvp")])
        for template in ("summit", "salon", "classic"):
            validate_event(dict(original, template=template, story=story))
        for invalid in [dict(story, pages=list(reversed(story["pages"]))), dict(story, pages=story["pages"][:-1]),
                        dict(story, pages=story["pages"] + story["pages"][-1:]), dict(story, font="invalid"),
                        dict(story, followUrl="javascript:void(0)"), dict(story, mapUrl="http://map.test:nope/"),
                        dict(story, accent="#fff"),
                        dict(story, followImage="https://img.example.org/photo.jpg")]:
            with self.subTest(field=list(invalid)), self.assertRaises(ValidationError):
                validate_event(dict(original, template="summit", story=invalid))

    def test_rule_binds_to_distinct_existing_keys(self):
        current = event()
        for good in [dict(phone="", wechat=""), dict(phone="mobile", wechat="wx"), dict(phone="", wechat="wx")]:
            validate_event(dict(current, registrationUnique=good))
        for invalid in [dict(phone="mobile", wechat="mobile"), dict(phone="missing", wechat=""),
                        dict(phone="mobile"), dict(phone=[], wechat="wx"), None]:
            with self.subTest(rules=invalid), self.assertRaises(ValidationError):
                validate_event(dict(current, registrationUnique=invalid))


class SignupTests(unittest.TestCase):
    def setUp(self):
        fixture = mysql_schema()
        self.config = fixture.__enter__()
        self.addCleanup(fixture.__exit__, None, None, None)
        self.db = db_connect(self.config)
        self.addCleanup(self.db.close)
        self.first = self.create("eventFirst")

    def create(self, event_id):
        e = event(event_id)
        self.db.execute("INSERT INTO events(id,draft) VALUES(%s,%s)", (event_id, compact(e)))
        return e

    def save(self, e, *, publish=True):
        validate_event(e)
        with transaction(self.db, write=True):
            return save_event(self.db, e, e["id"], publish)

    def signup(self, e, values, request_id=None, db=None):
        return registration(db or self.db, e["id"], {
            "version": e["version"], "requestId": request_id or secrets.token_hex(15), "values": values,
        })

    def total(self, table):
        return self.db.one("SELECT COUNT(*) AS total FROM "+table)["total"]

    def test_independent_rules_retries_event_scope_and_atomicity(self):
        rule = dict(phone="mobile", wechat="wx")
        live = self.save(dict(self.first, registrationUnique=rule))
        ident = dict(mobile="＋８６（１３８）-0000 0021", wx="WeChat_Test")
        first = self.signup(live, ident, "request1")
        self.assertEqual(self.signup(live, ident, "request1"), first)
        for invalid in [dict(mobile="008613800000021", wx="other"), dict(mobile="13800000022", wx="wechat_test")]:
            with self.assertRaises(ApiError) as error:
                self.signup(live, invalid)
            self.assertEqual(error.exception.status, 409)
        self.assertEqual(self.total("registrations"), 1)
        self.assertEqual(self.total("registration_identities"), 2)
        for invalid in [dict(mobile="", wx="ok"), dict(mobile="---", wx="ok"), dict(mobile="13800000022", wx="")]:
            with self.assertRaises(ApiError) as error:
                self.signup(live, invalid)
            self.assertEqual(error.exception.status, 400)
        self.signup(live, dict(mobile="13800000022", wx="another"))
        second = self.save(dict(self.create("eventSecond"), registrationUnique=rule))
        self.signup(second, ident)
        self.assertEqual(self.total("registrations"), 3)

    def test_switch_rules_rebuilds_history_and_conflicts_roll_back(self):
        live = self.save(self.first)
        self.signup(live, dict(mobile="13800000021", wx="same", backup="alpha"))
        self.signup(live, dict(mobile="13800000022", wx="Same", backup="beta"))
        self.signup(live, {})  # Historical optional values cannot block future submissions.
        attempted = self.save(dict(live, registrationUnique=dict(phone="", wechat="wx")), publish=False)
        self.assertEqual(self.total("registration_identities"), 0)
        with self.assertRaisesRegex(ApiError, "已有报名中存在重复") as error:
            self.save(attempted)
        self.assertEqual(error.exception.status, 409)
        current = self.db.one("SELECT published FROM events WHERE id=%s", (live["id"],))["published"]
        self.assertEqual(json.loads(current), live)
        self.assertEqual(self.total("registration_identities"), 0)
        phone = self.save(dict(attempted, registrationUnique=dict(phone="mobile", wechat="")))
        self.assertEqual(self.total("registration_identities"), 2)
        with self.assertRaisesRegex(ApiError, "手机号已报名"):
            self.signup(phone, dict(mobile="+86 13800000022"))
        with self.assertRaisesRegex(ApiError, "已有报名中存在重复"):
            self.save(dict(phone, registrationUnique=dict(phone="mobile", wechat="wx")))
        self.assertEqual(self.total("registration_identities"), 2)
        rebound = self.save(dict(phone, registrationUnique=dict(phone="", wechat="backup")))
        with self.assertRaisesRegex(ApiError, "微信号已报名"):
            self.signup(rebound, dict(mobile="13912345678", backup="ALPHA"))
        self.signup(rebound, dict(mobile="13800000021", backup="new"))
        off = self.save(dict(rebound, registrationUnique=dict(phone="", wechat="")))
        self.assertEqual(self.total("registration_identities"), 0)
        self.signup(off, dict(mobile="13800000021", backup="new"))

    def test_two_independent_writers_compete_for_one_identity(self):
        live = self.save(dict(self.first, registrationUnique=dict(phone="", wechat="wx")))

        def compete(n):
            with closing(db_connect(self.config)) as db:
                try:
                    self.signup(live, dict(wx="Subscriber" if n == 1 else "subscriber"), db=db)
                    return 201
                except ApiError as exc:
                    return exc.status

        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            self.assertEqual(sorted(pool.map(compete, (1, 2))), [201, 409])
        self.assertEqual(self.total("registrations"), 1)


if __name__ == "__main__":
    unittest.main()
