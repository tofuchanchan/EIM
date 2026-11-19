"""Integration checks against a running HTTP server and an isolated MySQL database."""
import concurrent.futures
from contextlib import closing
from datetime import datetime, timedelta, timezone
import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from mysql_fixture import mysql_schema
from mysql_storage import db_connect
from urllib.parse import parse_qs, urlsplit
from event_metrics import SHANGHAI
from invite_packages import ValidationError, validate_registration_schedule
from server import registration_state


ROOT = Path(__file__).resolve().parents[1]


class Client:
    def __init__(self, origin):
        self.origin = origin
        self.http = urllib.request.build_opener(
            urllib.request.ProxyHandler({}),
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
        )

    def request(self, method, path, payload=None):
        headers = {"Origin": self.origin}
        if isinstance(payload, bytes):
            headers["Content-Type"] = "application/zip"
        elif payload is not None:
            headers["Content-Type"] = "application/json"
            payload = json.dumps(payload).encode()
        req = urllib.request.Request(self.origin + path, payload, headers, method=method)
        try:
            response = self.http.open(req, timeout=12)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.load(response)


class RegistrationTiming(unittest.TestCase):
    def test_signup_time_includes_start_and_excludes_cutoff_in_beijing(self):
        event = {"registrationSchedule": {"start": "2026-12-19T09:00", "end": "2026-12-19T10:00"}}
        start = datetime(2026, 12, 19, 1, tzinfo=timezone.utc)
        end = start + timedelta(hours=1)
        tick = timedelta(microseconds=1)
        self.assertEqual(registration_state(event, True, start - tick), "upcoming")
        self.assertEqual(registration_state(event, True, start), "live")
        self.assertEqual(registration_state(event, True, end - tick), "live")
        self.assertEqual(registration_state(event, True, end), "expired")
        for now in (start - tick, start, end):
            self.assertEqual(registration_state(event, False, now), "ended")
        self.assertEqual(registration_state({"registrationSchedule": {"start": "", "end": "2026-12-19T10:00"}},
                                            True, start - tick), "live")
        self.assertEqual(registration_state({"registrationSchedule": {"start": "2026-12-19T09:00", "end": ""}},
                                            True, end), "live")
        self.assertEqual(registration_state({}, True, end), "live")

    def test_signup_time_validates_pairs_actual_dates_and_order(self):
        valid = {"start": "2028-02-29T23:00", "end": "2028-03-01T00:00"}
        validate_registration_schedule(valid)
        for invalid in (
            {"start": valid["start"]},
            dict(valid, start="2026-02-29T23:00"),
            dict(valid, start="2028-02-29"),
            dict(valid, start="2028-02-29T24:00"),
            dict(valid, start="2028-02-29T23:00+08:00"),
            dict(valid, end=valid["start"]),
            dict(valid, end="2028-02-28T23:00"),
        ):
            with self.subTest(schedule=invalid), self.assertRaises(ValidationError):
                validate_registration_schedule(invalid)


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        fixture = mysql_schema(self.temp.name)
        self.mysql = fixture.__enter__()
        self.addCleanup(fixture.__exit__, None, None, None)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            self.port = sock.getsockname()[1]
        self.origin = f"http://127.0.0.1:{self.port}"
        self.admin = Client(self.origin)
        self.guest = Client(self.origin)
        self.start()
        self.addCleanup(self.stop)
        self.admin_credentials = {"username": "test-admin", "password": secrets.token_urlsafe(24)}
        if self._testMethodName not in ("test_operator_and_mobile_screens", "test_story_and_identity_screens",
                                        "test_forum_gallery", "test_member_management_in_browser",
                                        "test_signup_time_in_browser"):
            self.ok(self.admin, "POST", "/api/setup", self.admin_credentials)

    def start(self, env=None):
        self.service = subprocess.Popen(
            [sys.executable, "-B", "server.py", "serve", "--port", str(self.port),
             "--data-dir", self.temp.name], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        for _ in range(100):
            try:
                if self.admin.request("GET", "/api/session")[0] == 200:
                    return
            except OSError:
                pass
            if self.service.poll() is not None:
                self.fail("Service exited during startup")
            time.sleep(0.05)
        self.stop()
        self.fail("Service readiness timed out")

    def stop(self):
        self.service.terminate()
        self.service.wait(timeout=10)

    def ok(self, client, method, path, body=None):
        status, data = client.request(method, path, body)
        self.assertTrue(200 <= status < 300, (status, data))
        return data

    def copy_event(self):
        e = self.ok(self.admin, "GET", "/api/events/caiyun2025")
        e.update(id="event" + secrets.token_hex(8), title="团队交流会", status="draft", version=0)
        return self.ok(self.admin, "POST", "/api/events", {"event": e})

    @unittest.skipUnless(os.environ.get("RUN_BROWSER_TESTS") == "1", "Set RUN_BROWSER_TESTS=1 for Edge")
    def test_forum_gallery(self):
        subprocess.run(["node", "tests/test_forum_preview.cjs", self.origin, os.environ.get("STUDIO_EVIDENCE", "")],
                       cwd=ROOT, check=True, timeout=180)

    @unittest.skipUnless(os.environ.get("RUN_BROWSER_TESTS") == "1", "Set RUN_BROWSER_TESTS=1 for Edge")
    def test_operator_and_mobile_screens(self):
        subprocess.run(
            ["node", "tests/test_team_browser.cjs", self.origin, os.environ.get("STUDIO_EVIDENCE", "")],
            cwd=ROOT, check=True, timeout=180, env=dict(os.environ, PROTOTYPE_PYTHON=sys.executable),
        )

    @unittest.skipUnless(os.environ.get("RUN_BROWSER_TESTS") == "1", "Set RUN_BROWSER_TESTS=1 for Edge")
    def test_signup_time_in_browser(self):
        subprocess.run(
            ["node", "tests/test_signup_time_browser.cjs", self.origin, os.environ.get("STUDIO_EVIDENCE", "")],
            cwd=ROOT, check=True, timeout=100,
        )

    @unittest.skipUnless(os.environ.get("RUN_BROWSER_TESTS") == "1", "Set RUN_BROWSER_TESTS=1 for Edge")
    def test_story_and_identity_screens(self):
        subprocess.run(
            ["node", "tests/test_story_browser.cjs", self.origin, os.environ.get("STUDIO_EVIDENCE", "")],
            cwd=ROOT, check=True, timeout=180,
        )

    @unittest.skipUnless(os.environ.get("RUN_BROWSER_TESTS") == "1", "Set RUN_BROWSER_TESTS=1 for Edge")
    def test_member_management_in_browser(self):
        subprocess.run(["node", "tests/test_member_browser.cjs", self.origin, os.environ.get("STUDIO_EVIDENCE", "")],
                       cwd=ROOT, check=True, timeout=120)

    def activate(self, member, password, client=None):
        params = parse_qs(urlsplit(member["setupPath"]).fragment)
        body = {"token": params["token_hash"][0], "type": params["setup_type"][0], "password": password}
        self.ok(client or self.guest, "POST", "/api/set-password", body)
        return body

    def test_admin_manages_members_and_permissions_follow_their_role(self):
        path = "/api/members"
        credentials = {"username": "team-editor", "password": secrets.token_urlsafe(24)}
        self.assertEqual(self.guest.request("GET", path)[0], 401)
        self.assertEqual(self.guest.request("POST", path, credentials)[0], 401)
        directory = self.ok(self.admin, "GET", path)
        admin_id = directory["currentId"]
        self.assertEqual(len(directory["items"]), 1)
        self.assertEqual(directory["items"][0]["id"], admin_id)
        self.assertEqual(directory["items"][0]["lastIP"], "127.0.0.1")
        self.assertEqual(self.admin.request("POST", path, credentials)[0], 400)
        self.assertEqual(self.admin.request("POST", path, {"username": credentials["username"], "role": "other"})[0], 400)
        member = self.ok(self.admin, "POST", path, {"username": credentials["username"]})
        self.assertEqual(member["status"], "pending")
        self.activate(member, credentials["password"])
        self.assertEqual(member["role"], "member")
        self.assertEqual(self.admin.request("POST", path, {"username": "TEAM-EDITOR"})[0], 409)

        user = Client(self.origin)
        self.ok(user, "POST", "/api/login", credentials)
        target = path + "/" + member["id"]
        self.assertEqual(user.request("GET", path)[0], 403)
        self.assertEqual(user.request("POST", path, dict(credentials, username="no-account"))[0], 403)
        self.assertEqual(user.request("PATCH", target, {"role": "admin"})[0], 403)
        self.assertEqual(self.admin.request("PATCH", target, {"role": "owner"})[0], 400)
        self.assertEqual(self.admin.request("PATCH", path + "/99999", {"role": "admin"})[0], 404)
        self.assertEqual(self.admin.request("PATCH", path + "/" + admin_id, {"role": "member"})[0], 409)

        event = self.copy_event()
        self.assertNotIn(event["id"], self.ok(user, "GET", "/api/workspace")["recordEventIds"])
        self.assertEqual(self.ok(self.admin, "PATCH", target, {"role": "admin"})["role"], "admin")
        self.assertEqual(self.ok(user, "GET", path)["currentId"], member["id"])
        workspace = self.ok(user, "GET", "/api/workspace")
        self.assertEqual(workspace["user"]["role"], "admin")
        self.assertIn(event["id"], workspace["recordEventIds"])
        self.ok(self.admin, "PATCH", target, {"role": "member"})
        workspace = self.ok(user, "GET", "/api/workspace")
        self.assertEqual(workspace["user"]["role"], "member")
        self.assertNotIn(event["id"], workspace["recordEventIds"])
        self.assertEqual(user.request("GET", path)[0], 403)

    def test_concurrent_role_changes_preserve_an_administrator(self):
        path = "/api/members"
        first_id = self.ok(self.admin, "GET", path)["currentId"]
        credentials = {"username": "other-admin", "password": secrets.token_urlsafe(24)}
        other_entry = self.ok(self.admin, "POST", path, {"username": credentials["username"], "role": "admin"})
        self.activate(other_entry, credentials["password"])
        other_id = other_entry["id"]
        other = Client(self.origin)
        self.ok(other, "POST", "/api/login", credentials)
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            responses = [pool.submit(client.request, "PATCH", path + "/" + target, {"role": "member"})
                         for client, target in ((self.admin, other_id), (other, first_id))]
            statuses = [response.result()[0] for response in responses]
        self.assertEqual(sorted(statuses), [200, 403])
        winner = self.admin if statuses[0] == 200 else other
        roles = [member['role'] for member in self.ok(winner, "GET", path)["items"]]
        self.assertCountEqual(roles, ["admin", "member"])

    def test_member_lifecycle_and_activity_operations(self):
        member = self.ok(self.admin, "POST", "/api/members", {"username": "ops-member"})
        self.assertEqual(member["expiresIn"], 24 * 3600)
        path = "/api/members/" + member["id"]
        first = member["setupPath"]
        with closing(db_connect(self.mysql)) as db:
            db.execute("UPDATE password_links SET expires=0 WHERE user_id=%s", (int(member["id"]),))
        params = parse_qs(urlsplit(first).fragment)
        old_password = secrets.token_urlsafe(20)
        body = {"token": params["token_hash"][0], "type": "invite", "password": old_password}
        self.assertEqual(self.guest.request("POST", "/api/set-password", body)[0], 400)
        member = self.ok(self.admin, "POST", path + "/password-link", {})
        new_params = parse_qs(urlsplit(member["setupPath"]).fragment)
        body["token"] = new_params["token_hash"][0]
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            uses = [pool.submit(Client(self.origin).request, "POST", "/api/set-password", body) for _ in range(2)]
            self.assertEqual(sorted(call.result()[0] for call in uses), [200, 400])
        self.assertEqual(self.guest.request("POST", "/api/set-password", body)[0], 400)

        operator = Client(self.origin)
        creds = {"username": "ops-member", "password": old_password}
        self.ok(operator, "POST", "/api/login", creds)
        self.assertEqual(operator.request("GET", path + "/logins")[0], 403)
        self.assertEqual(self.ok(self.admin, "GET", path + "/logins")["items"][0]["ip"], "127.0.0.1")
        original = self.ok(operator, "GET", "/api/events/caiyun2025")
        event = dict(original, id="operationsTest", status="draft", version=0)
        event = self.ok(operator, "POST", "/api/events", {"event": event, "sourceId": original["id"]})
        event_path = "/api/events/" + event["id"]
        changed = self.ok(self.admin, "PUT", event_path, {"event": dict(event, title="审核后的活动")})
        self.assertEqual(self.admin.request("PUT", event_path, {"event": event})[0], 409)
        self.ok(self.admin, "PUT", event_path, {"event": changed})
        published = self.ok(operator, "POST", event_path + "/publish", {"event": changed})
        public_path = "/api/public/" + event["id"]
        self.ok(self.guest, "POST", public_path + "/registrations", {
            "version": published["version"], "requestId": secrets.token_hex(16),
            "values": {"name": "测试来宾", "company": "测试企业", "phone": "", "attendees": "1"},
        })
        entries = self.ok(self.admin, "GET", event_path + "/operations")["items"]
        self.assertEqual([(e["operation"], e["username"]) for e in entries],
                         [("publish", "ops-member"), ("edit", "test-admin"), ("copy", "ops-member")])
        self.assertEqual(entries[1]["changes"], ["title"])
        self.assertEqual(self.guest.request("GET", event_path + "/operations")[0], 401)

        self.assertEqual(self.ok(self.admin, "PATCH", path, {"enabled": False})["status"], "disabled")
        self.assertEqual(operator.request("GET", "/api/workspace")[0], 401)
        self.assertEqual(operator.request("POST", "/api/login", creds)[0], 401)
        self.assertEqual(self.ok(self.guest, "GET", public_path), published)
        workspace = self.ok(self.admin, "GET", "/api/workspace")
        self.assertEqual(workspace["eventPeople"][event["id"]]["creator"], "ops-member")
        self.assertTrue(any(row["eventId"] == event["id"] for row in workspace["rows"]))
        self.ok(self.admin, "PATCH", path, {"enabled": True})
        self.assertEqual(operator.request("GET", "/api/workspace")[0], 401)
        self.ok(operator, "POST", "/api/login", creds)
        reset = self.ok(self.admin, "POST", path + "/password-link", {})
        self.assertIn("setup_type=recovery", reset["setupPath"])
        self.assertEqual(operator.request("GET", "/api/workspace")[0], 401)
        self.assertEqual(operator.request("POST", "/api/login", creds)[0], 401)
        new_password = secrets.token_urlsafe(24)
        self.activate(reset, new_password)
        self.ok(operator, "POST", "/api/login", dict(creds, password=new_password))
        self.assertEqual(len(self.ok(self.admin, "GET", path + "/logins")["items"]), 3)

    def test_amendment_endpoints_and_downloads_are_disabled(self):
        event = self.copy_event()
        path = "/api/events/" + event["id"]
        for action in ("import-preview", "import-apply"):
            with self.subTest(action=action):
                self.assertEqual(self.admin.request("POST", path + "/" + action, b"")[0], 404)
        for filename in ("packages.js", "example-changes.zip", "skills/invitation-package-editor.zip"):
            with self.subTest(filename=filename):
                self.assertEqual(self.guest.request("GET", "/" + filename)[0], 404)
        self.assertEqual(self.ok(self.admin, "GET", path), event)

    def test_publication_permissions_short_url_and_lifecycle(self):
        event = self.copy_event()
        path = "/api/events/" + event["id"]
        public_api = "/api/public/" + event["id"]
        publication = path + "/publication"
        credentials = {"username": "publisher-collaborator", "password": secrets.token_urlsafe(24)}
        invitation = self.ok(self.admin, "POST", "/api/members", {"username": credentials["username"]})
        self.activate(invitation, credentials["password"])
        collaborator = Client(self.origin)
        self.ok(collaborator, "POST", "/api/login", credentials)
        state = self.ok(collaborator, "GET", publication)
        self.assertFalse(state["canManage"])
        self.assertIsNone(state["url"])
        self.assertEqual(collaborator.request("POST", path + "/publish", {"event": event, "expectedRevision": 0})[0], 403)
        event = self.ok(collaborator, "PUT", path, {"event": dict(event, title="合作编辑后的活动")})
        event = self.ok(self.admin, "POST", path + "/publish", {"event": event, "expectedRevision": 0})
        initial = self.ok(self.admin, "GET", publication)
        short_url = initial["url"]
        self.assertRegex(short_url, r"/s/[A-Za-z0-9]{8}$")
        with self.guest.http.open(short_url, timeout=8) as page:
            document = page.read().decode("utf-8")
            self.assertIn(f'<meta name="invite-event" content="{event["id"]}">', document)
            self.assertIn(short_url, document)
        with self.admin.http.open(self.origin + path + "/qr", timeout=8) as qr:
            self.assertEqual(qr.headers.get_content_type(), "image/png")
            self.assertIn(initial["shortCode"] + ".png", qr.headers["Content-Disposition"])
            self.assertEqual(qr.read(8), b'\x89PNG\r\n\x1a\n')
        signup = {"version": event["version"], "requestId": secrets.token_hex(16),
                  "values": {"name": "来宾", "company": "团队", "phone": "", "attendees": "1"}}
        self.ok(self.guest, "POST", public_api + "/registrations", signup)

        close = {"operation": "close", "expectedRevision": initial["revision"]}
        self.assertEqual(collaborator.request("PATCH", publication, close)[0], 403)
        closed = self.ok(self.admin, "PATCH", publication, close)
        self.assertTrue(closed["online"])
        self.assertFalse(closed["accepting"])
        self.assertEqual(self.ok(self.guest, "GET", public_api)["status"], "ended")
        self.assertEqual(self.guest.request("POST", public_api + "/registrations",
                                           dict(signup, requestId=secrets.token_hex(16)))[0], 409)
        self.assertEqual(self.admin.request("POST", path + "/publish",
                                            {"event": event, "expectedRevision": initial["revision"]})[0], 409)
        offline = self.ok(self.admin, "PATCH", publication, {"operation": "offline", "expectedRevision": closed["revision"]})
        for guest_url in (short_url, self.origin + "/i/" + event["id"]):
            with self.assertRaises(urllib.error.HTTPError) as err:
                self.guest.http.open(guest_url, timeout=8)
            with err.exception as response:
                self.assertEqual(response.code, 410)
                self.assertIn("<title>邀请函已下线 · EIM</title>", response.read().decode("utf-8"))
        self.assertEqual(self.guest.request("GET", public_api)[0], 410)
        self.assertEqual(self.guest.request("POST", public_api + "/registrations",
                                           dict(signup, requestId=secrets.token_hex(16)))[0], 410)
        updated = self.ok(self.admin, "POST", path + "/publish",
                          {"event": dict(event, title="下线期间修订"), "expectedRevision": offline["revision"]})
        state = self.ok(self.admin, "GET", publication)
        self.assertFalse(state["online"])
        self.assertFalse(state["accepting"])
        self.assertEqual(state["url"], short_url)
        state = self.ok(self.admin, "PATCH", publication, {"operation": "restore", "expectedRevision": state["revision"]})
        self.assertTrue(state["online"])
        self.assertFalse(state["accepting"])
        self.assertEqual(self.ok(self.guest, "GET", public_api)["title"], updated["title"])
        self.ok(self.admin, "PATCH", publication, {"operation": "open", "expectedRevision": state["revision"]})
        self.assertEqual(self.ok(self.guest, "GET", public_api)["status"], "live")
        self.assertEqual(sum(r["eventId"] == event["id"] for r in self.ok(self.admin, "GET", "/api/workspace")["rows"]), 1)
        operations = self.ok(self.admin, "GET", path + "/operations")["items"]
        self.assertEqual([op["operation"] for op in operations[:6]],
                         ["open", "restore", "publish", "offline", "close", "publish"])
        self.assertIn("title", operations[2]["changes"])

    def test_publication_sharing_uses_configured_origin(self):
        self.stop()
        self.start(env=dict(os.environ, INVITE_PUBLIC_ORIGIN="https://invite.example.com/",
                            INVITE_WECHAT_APP_ID="test-app", INVITE_WECHAT_APP_SECRET="test-placeholder"))
        state = self.ok(self.admin, "GET", "/api/events/caiyun2025/publication")
        self.assertTrue(state["publicOriginConfigured"])
        self.assertTrue(state["wechatConfigured"])
        self.assertEqual(state["url"], "https://invite.example.com/s/" + state["shortCode"])
        self.assertNotIn("test-placeholder", json.dumps(state))
        with self.guest.http.open(self.origin + "/s/" + state["shortCode"], timeout=8) as page:
            self.assertIn(state["url"], page.read().decode("utf-8"))

    def test_signup_time_uses_published_window_and_respects_manual_close(self):
        now = datetime.now(SHANGHAI)

        def local_time(hours):
            return (now + timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M")

        event = self.copy_event()
        path = "/api/events/" + event["id"]
        public = "/api/public/" + event["id"]
        signup = {"version": event["version"], "requestId": secrets.token_hex(16),
                  "values": {"company": "定时回归企业", "name": "来宾", "phone": "", "attendees": "1"}}
        waiting = {"start": local_time(1), "end": local_time(2)}
        invalid = dict(event, registrationSchedule={"start": waiting["end"], "end": waiting["start"]})
        self.assertEqual(self.admin.request("PUT", path, {"event": invalid})[0], 400)
        event = self.ok(self.admin, "POST", path + "/publish", {"event": dict(event, registrationSchedule=waiting)})
        self.assertEqual(self.ok(self.guest, "GET", public)["status"], "ended")
        with self.guest.http.open(self.origin + public, timeout=8) as page:
            self.assertEqual(page.headers["X-Invite-Registration-Enabled"], "1")
            self.assertGreater(int(page.headers["X-Invite-Server-Time"]), 0)
        signup["version"] = event["version"]
        code, error = self.guest.request("POST", public + "/registrations", signup)
        self.assertEqual(code, 409)
        self.assertIn("未开始", error["error"])

        active = {"start": local_time(-1), "end": local_time(1)}
        draft = self.ok(self.admin, "PUT", path, {"event": dict(event, registrationSchedule=active)})
        self.assertEqual(self.ok(self.guest, "GET", public)["registrationSchedule"], waiting)
        self.assertEqual(self.guest.request("POST", public + "/registrations", signup)[0], 409)
        event = self.ok(self.admin, "POST", path + "/publish", {"event": draft})
        self.assertEqual(self.ok(self.guest, "GET", public)["status"], "live")
        signup["version"] = event["version"]
        receipt = self.ok(self.guest, "POST", public + "/registrations", signup)

        publication_path = path + "/publication"
        state = self.ok(self.admin, "GET", publication_path)
        self.assertTrue(state["accepting"])
        closed = self.ok(self.admin, "PATCH", publication_path,
                         {"operation": "close", "expectedRevision": state["revision"]})
        code, error = self.guest.request("POST", public + "/registrations",
                                         dict(signup, requestId=secrets.token_hex(16)))
        self.assertEqual(code, 409)
        self.assertIn("未开放", error["error"])
        expired = {"start": "", "end": local_time(-1)}
        event = self.ok(self.admin, "POST", path + "/publish",
                        {"event": dict(event, registrationSchedule=expired), "expectedRevision": closed["revision"]})
        state = self.ok(self.admin, "GET", publication_path)
        self.assertFalse(state["accepting"])
        self.ok(self.admin, "PATCH", publication_path,
                {"operation": "open", "expectedRevision": state["revision"]})
        code, error = self.guest.request("POST", public + "/registrations",
                                         dict(signup, version=event["version"], requestId=secrets.token_hex(16)))
        self.assertEqual(code, 409)
        self.assertIn("已截止", error["error"])
        self.assertEqual(self.ok(self.guest, "POST", public + "/registrations", signup), receipt)

    def test_insights_count_visits_foreground_time_and_attributed_signups(self):
        from contextlib import closing
        from mysql_storage import db_connect
        e=self.copy_event()
        url="/api/public/"+e["id"]
        first=dict(visitId="1"*32,visitorId="a"*32,activeMs=0,reachedLast=False)
        self.assertEqual(self.guest.request("POST",url+"/visits",first)[0],404)
        live=self.ok(self.admin,"POST","/api/events/"+e["id"]+"/publish",{"event":e})
        for visit in (first,dict(first,visitId="2"*32),dict(first,visitId="3"*32,visitorId="b"*32)):
            self.ok(self.guest,"POST",url+"/visits",visit)
        with closing(db_connect(self.mysql)) as db:
            db.execute("UPDATE event_visits SET started_at=UTC_TIMESTAMP(3)-INTERVAL 30 SECOND WHERE event_id=%s",(e["id"],))
        self.ok(self.guest,"POST",url+"/visits",dict(first,activeMs=12000,reachedLast=True))
        self.ok(self.guest,"POST",url+"/visits",dict(first,activeMs=4000))
        # Reordered/retried packets preserve the longest visible time and the end-page flag.
        signup={"version":live["version"],"requestId":"visit-reg-101","values":{"name":"测试嘉宾"},
                "visit":dict(first,activeMs=12000,reachedLast=True)}
        for _ in range(2):
            self.ok(self.guest,"POST",url+"/registrations",signup)
        stats="/api/insights?event="+e["id"]
        self.assertEqual(self.guest.request("GET",stats)[0],401)
        out=self.ok(self.admin,"GET",stats+"&days=7")
        self.assertEqual(out["summary"],dict(pv=3,uv=2,ms=12000,reached=1,converted=1,signups=1))
        overview = "/api/insights/events?days=7"
        self.assertEqual(self.guest.request("GET",overview)[0],401)
        totals={item["eventId"]:item for item in self.ok(self.admin,"GET",overview)["items"]}
        self.assertEqual(totals[e["id"]],dict(eventId=e["id"],**out["summary"]))
        self.assertEqual(totals["caiyun2025"]["pv"],0)
        self.assertEqual(len(out["trend"]),7)
        self.assertEqual(sum(r["pv"] for r in out["trend"]),3)
        with closing(db_connect(self.mysql)) as db:
            db.execute("UPDATE event_visits SET started_at=UTC_TIMESTAMP(3)-INTERVAL 15 DAY WHERE visit_id=UNHEX(%s)",("3"*32,))
        self.assertEqual(self.ok(self.admin,"GET",stats+"&days=7")["summary"]["uv"],1)
        self.assertEqual(self.ok(self.admin,"GET",stats+"&days=30")["summary"]["uv"],2)
        narrowed = self.ok(self.admin,"GET",overview)["items"]
        self.assertEqual(next(item for item in narrowed if item["eventId"]==e["id"])["pv"],2)
        self.assertEqual(self.admin.request("GET",stats+"&days=99")[0],400)
        self.assertEqual(self.admin.request("POST",url+"/visits",dict(first,activeMs=-1))[0],400)

    def test_manual_edit_conflict_public_snapshot_and_restart(self):
        e = self.copy_event()
        path = "/api/events/" + e["id"]
        public = "/api/public/" + e["id"]
        self.assertEqual(self.guest.request("GET", public)[0], 404)
        self.assertEqual(self.guest.request("GET", "/api/workspace")[0], 401)
        self.assertFalse(self.ok(self.guest, "GET", "/api/session")["setupRequired"])
        self.assertEqual(self.ok(self.guest, "GET", "/api/session")["storage"], "mysql")
        original = self.ok(self.admin, "POST", path + "/publish", {"event": e})
        changed = self.ok(self.admin, "PUT", path, {"event": dict(original, title="同事已更新")})
        stale = dict(original, place="第二会场")
        self.assertEqual(self.admin.request("PUT", path, {"event": stale})[0], 409)
        self.assertEqual(self.ok(self.guest, "GET", public)["place"], original["place"])
        self.assertEqual(self.ok(self.admin, "GET", path)["version"], changed["version"])
        self.assertEqual(self.ok(self.guest, "GET", public)["title"], original["title"])
        signup = {"version": original["version"], "requestId": secrets.token_hex(16),
                  "values": {"name": "测试联系人", "company": "测试企业", "phone": "", "attendees": "2"}}
        first = self.ok(self.guest, "POST", public + "/registrations", signup)
        again = self.ok(self.guest, "POST", public + "/registrations", signup)
        self.assertEqual(first["id"], again["id"])
        changed["fields"] = [field for field in changed["fields"] if field["key"] != "attendees"]
        current = self.ok(self.admin, "POST", path + "/publish", {"event": changed})
        outdated = dict(signup, requestId=secrets.token_hex(16))
        self.assertEqual(self.guest.request("POST", public + "/registrations", outdated)[0], 409)
        self.stop()
        self.start()
        self.ok(self.admin, "POST", "/api/login", self.admin_credentials)
        rows = self.ok(self.admin, "GET", "/api/workspace")["rows"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["values"]["company"], "测试企业")
        self.assertEqual(rows[0]["values"]["attendees"], "2")
        self.assertIn("attendees", [field["key"] for field in rows[0]["fields"]])
        self.assertEqual(self.ok(self.guest, "GET", public)["version"], current["version"])

    def test_shared_drafts_private_records_and_simultaneous_updates(self):
        member_password = secrets.token_urlsafe(24)
        subprocess.run([sys.executable, "-B", "server.py", "user-add", "--username", "test-editor",
                        "--data-dir", self.temp.name], input=member_password + "\n", text=True,
                       cwd=ROOT, capture_output=True, check=True)
        member = Client(self.origin)
        self.ok(member, "POST", "/api/login", {"username": "test-editor", "password": member_password})
        event = self.copy_event()
        path = "/api/events/" + event["id"]
        event = self.ok(self.admin, "POST", path + "/publish", {"event": event})
        self.ok(self.guest, "POST", "/api/public/" + event["id"] + "/registrations", {
            "version": event["version"], "requestId": secrets.token_hex(16),
            "values": {"name": "私有报名", "company": "独立测试", "phone": "", "attendees": "1"},
        })
        workspace = self.ok(member, "GET", "/api/workspace")
        self.assertNotIn(event["id"], workspace["recordEventIds"])
        self.assertEqual(member.request("GET","/api/insights?event="+event["id"])[0],404)
        self.assertEqual(self.ok(member,"GET","/api/insights")["summary"]["signups"],0)
        self.assertNotIn(event["id"], [item["eventId"] for item in self.ok(member,"GET","/api/insights/events")["items"]])
        self.assertEqual(workspace["rows"], [])
        self.assertEqual(self.ok(member, "GET", path)["title"], event["title"])
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            responses = [pool.submit(c.request, "PUT", path, {"event": dict(event, title=title)})
                         for title, c in [("第一份", self.admin), ("第二份", member)]]
            self.assertEqual(sorted(f.result()[0] for f in responses), [200, 409])
        self.ok(member, "POST", "/api/logout", {})
        self.assertEqual(member.request("GET", "/api/workspace")[0], 401)


if __name__ == "__main__":
    unittest.main()
