"""EIM shared HTTP service. Run server.py --help for setup and startup."""
import argparse
import base64
from contextlib import closing
from datetime import datetime, timezone
from getpass import getpass
import hashlib
from html import escape
import hmac
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import ipaddress
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import threading
import time
import unicodedata
from urllib.parse import parse_qs, urlsplit

from mysql.connector import Error as MySQLError, IntegrityError, errorcode
import qrcode
from mysql_storage import allocate_publication, db_connect, initialize, transaction, username_key
from event_metrics import SHANGHAI, activity_totals, insights, store_visit, visit_values
from invite_packages import ValidationError, validate_event


ROOT = Path(__file__).resolve().parent
COOKIE = 'invite_studio_session'
SESSION_TTL = 7 * 86400
JSON_LIMIT = 16 * 1024 * 1024
PUBLIC_FILES = {
    'index.html', 'studio.js', 'studio.css', 'posters.css', 'posters.js',
    'editor.css', 'editor.js', 'motion.css', 'device-cover.js', 'device-cover.css',
    'designer.js', 'designer.css', 'invite-layout.js', 'invite-layout.css',
    'forum-designs.js', 'forum-media.js',
    'event-data.js', 'ui-controls.js', 'ui-controls.css',
}
EVENT_PATH = r'([a-zA-Z][a-zA-Z0-9_-]{0,63})'
SHORT_PATH = re.compile(r'/s/([A-Za-z0-9]{8})')
MEMBER_PATH = re.compile(r'/api/members(?:/([1-9][0-9]{0,19})(?:/(logins|password-link))?)?')
PASSWORD_LINK_TTL = 24 * 3600
IDENTITY_LABELS = {'phone': '手机号', 'wechat': '微信号'}


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def compact(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds')


def password_hash(password, salt):
    return hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 600000)


def valid_username(name):
    if not isinstance(name, str) or not 1 <= len(name) <= 64 or name != name.strip() or not name.isprintable():
        raise ApiError(400, '用户名须为 1 至 64 个可见字符。')
    return name


def valid_password(password, creating=True):
    if not isinstance(password, str) or len(password) > 256 or not password.strip() or (creating and len(password) < 10):
        raise ApiError(400, '请输入有效密码。新密码须为 10 至 256 个字符。')
    return password


def credentials(data, creating):
    return valid_username(data.get('username')), valid_password(data.get('password'), creating)


def create_user(db, username, salt, digest, first_only=False):
    # A singleton row serializes the first-admin decision even when users is empty.
    db.one('SELECT singleton FROM studio_meta WHERE singleton=1 FOR UPDATE')
    first = db.one('SELECT id FROM users LIMIT 1') is None
    if first_only and not first:
        raise ApiError(409, '管理员已设置，请登录。')
    return insert_user(db, username, salt, digest, 'admin' if first else 'member')


def insert_user(db, username, salt, digest, role):
    try:
        user_id = db.execute('INSERT INTO users(username,username_key,password_hash,salt,role) VALUES(%s,%s,%s,%s,%s)',
                             (username, username_key(username), digest, salt, role))
    except IntegrityError as exc:
        if exc.errno != errorcode.ER_DUP_ENTRY:
            raise
        raise ApiError(409, '用户名已存在。') from exc
    return {'id': user_id, 'username': username, 'role': role}


def session_user(user):
    return {'username': user['username'], 'role': user['role']} if user else None


def member_entry(user):
    status = 'disabled' if not user.get('enabled', True) else 'pending' if user.get('pending') else 'active'
    return {'id': str(user['id']), **session_user(user), 'status': status}


def lock_user(db, user_id):
    db.one('SELECT id FROM users WHERE id=%s FOR UPDATE', (user_id,))


def issue_password_link(db, user_id, kind):
    token = secrets.token_hex(32)
    digest = hashlib.sha256(bytes.fromhex(token)).digest()
    db.execute('DELETE FROM password_links WHERE user_id=%s', (user_id,))
    db.execute('INSERT INTO password_links(user_id,digest,kind,expires) VALUES(%s,%s,%s,%s)',
               (user_id, digest, kind, int(time.time()) + PASSWORD_LINK_TTL))
    return {'setupPath': f'/set-password#token_hash={token}&setup_type={kind}', 'expiresIn': PASSWORD_LINK_TTL}


def log_time(value):
    return value.replace(tzinfo=timezone.utc).isoformat(timespec='milliseconds') if value else None


def log_event(db, event, actor_id, operation, changes=()):
    db.execute('''INSERT INTO event_operations(event_id,actor_id,operation,version,changes,at)
                  VALUES(%s,%s,%s,%s,%s,UTC_TIMESTAMP(3))''',
               (event['id'], actor_id, operation, event['version'], compact(list(changes))))


def session_token(db, user_id):
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    db.execute('DELETE FROM sessions WHERE expires<=%s', (now,))
    db.execute('INSERT INTO sessions(digest,user_id,expires) VALUES(%s,%s,%s)',
               (hashlib.sha256(token.encode()).hexdigest(), user_id, now + SESSION_TTL))
    return token


def is_loopback(host):
    if host == 'localhost':
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def event_row(db, event_id, *, lock=False):
    sql = ('''SELECT e.*,p.short_code,p.visible,p.accepting,p.revision FROM events e
              LEFT JOIN event_publications p ON p.event_id=e.id WHERE e.id=%s'''
           + (' FOR UPDATE' if lock else ''))
    row = db.one(sql, (event_id,))
    if row is None:
        raise ApiError(404, '找不到该活动。')
    return row


def can_manage_publication(row, user):
    return user['role'] == 'admin' or row['owner_id'] == user['id']


def publication_entry(row, user):
    return {'shortCode': row['short_code'], 'online': bool(row['visible']), 'accepting': bool(row['accepting']),
            'revision': row['revision'] or 0, 'canManage': can_manage_publication(row, user)}


def require_online(row):
    if not row['published']:
        raise ApiError(404, '邀请函尚未发布。')
    if row['visible'] == 0:
        raise ApiError(410, '邀请函已下线。')


def visible_snapshot(row):
    require_online(row)
    return json.loads(row['published'])


def registration_state(event, accepting, now=None):
    """Evaluate the published window in Beijing time with an exclusive cutoff."""
    if not accepting:
        return 'ended'
    schedule = event.get('registrationSchedule', {})
    if not schedule.get('start') and not schedule.get('end'):
        return 'live'
    minute = (now or datetime.now(SHANGHAI)).astimezone(SHANGHAI).isoformat(timespec='minutes')[:16]
    if schedule.get('start') and minute < schedule['start']:
        return 'upcoming'
    if schedule.get('end') and minute >= schedule['end']:
        return 'expired'
    return 'live'


def registration_enabled(row, event):
    return event.get('status') == 'live' if row['accepting'] is None else bool(row['accepting'])


def check_publication_revision(row, expected):
    if type(expected) is not int:
        raise ApiError(400, '缺少有效的发布版本。')
    if expected != (row['revision'] or 0):
        raise ApiError(409, '发布状态已更新，请重新确认。')


def active_rules(event):
    return {kind: key for kind, key in event.get('registrationUnique', {}).items() if key}


def canonical_identity(kind, value):
    """Return an identity valid under the published rule, or None for legacy/malformed values."""
    value = unicodedata.normalize('NFKC', value).strip()
    if kind == 'phone':
        value = re.sub(r'[\s()\-]', '', value)
        if value.startswith('00'):
            value = '+' + value[2:]
        if re.fullmatch(r'\+861[0-9]{10}', value):
            value = value[3:]
        return value if re.fullmatch(r'\+?[0-9]{7,15}', value) else None
    return value.lower() if re.fullmatch(r'[A-Za-z0-9_-]{1,64}', value) else None


def claim_identities(db, event_id, registration_id, rules, values, *, historical=False):
    for kind, key in rules.items():
        canonical = canonical_identity(kind, values.get(key, ''))
        if canonical is None:
            if historical:
                continue  # No comparable identity in this old registration.
            raise ApiError(400, '请填写有效的'+IDENTITY_LABELS[kind]+'。')
        digest = hashlib.sha256('\0'.join((event_id, kind, canonical)).encode()).digest()
        try:
            db.execute('INSERT INTO registration_identities(event_id,kind,digest,registration_id) VALUES(%s,%s,%s,%s)',
                       (event_id, kind, digest, registration_id))
        except IntegrityError as exc:
            if exc.errno != errorcode.ER_DUP_ENTRY:
                raise
            if historical:
                raise ApiError(409, '已有报名中存在重复的'+IDENTITY_LABELS[kind]+'，本次规则未发布。') from exc
            raise ApiError(409, '该'+IDENTITY_LABELS[kind]+'已报名本场活动，请勿重复提交。') from exc


def save_event(db, event, event_id, publish=False, *, actor_id=None, row=None):
    row = row if row is not None else event_row(db, event_id, lock=True)
    previous = json.loads(row['draft'])
    if previous['version'] != event['version']:
        raise ApiError(409, '草稿版本已更新，请载入最新版本后再编辑。')
    if event['id'] != event_id:
        raise ApiError(400, '目标活动不匹配。')
    updated = dict(event, status=previous['status'])
    prior_public = json.loads(row['published']) if publish and row['published'] else None
    if publish:
        if not updated['date'] or not updated['place'].strip():
            raise ApiError(400, '发布前请补全活动日期和地点。')
        rules = active_rules(updated)
        if rules != active_rules(prior_public or {}):
            # Rebuild only when the published field bindings change. Publication and all claims
            # share one write transaction, including rollback if two historical values coincide.
            db.execute('DELETE FROM registration_identities WHERE event_id=%s', (event_id,))
            if rules:
                history = db.all('SELECT id,values_json FROM registrations WHERE event_id=%s', (event_id,))
                for signup in history:
                    claim_identities(db, event_id, signup['id'], rules, json.loads(signup['values_json']),
                                     historical=True)
        updated['status'] = 'live'
    if updated != previous:
        updated['version'] += 1
    data = compact(updated)
    if publish:
        db.execute('UPDATE events SET draft=%s,published=%s WHERE id=%s', (data,data,event_id))
        if not row['short_code']:
            allocate_publication(db, event_id, not prior_public or prior_public['status'] == 'live')
        elif updated != prior_public:
            db.execute('UPDATE event_publications SET revision=revision+1 WHERE event_id=%s', (event_id,))
    else:
        db.execute('UPDATE events SET draft=%s WHERE id=%s', (data,event_id))
    if actor_id is not None and (updated != previous or (publish and updated != prior_public)):
        before = (prior_public or {}) if publish else previous
        changed = sorted(key for key in updated.keys() | before.keys()
                         if key not in ('version', 'id', 'status') and updated.get(key) != before.get(key))
        log_event(db, updated, actor_id, 'publish' if publish else 'edit', changed)
    return updated


def workspace(db, user):
    with transaction(db, write=False):
        events, published, allowed, people, publications = [], {}, [], {}, {}
        for row in db.all('''SELECT e.*,p.short_code,p.visible,p.accepting,p.revision,owner.username AS creator
                             FROM events e LEFT JOIN users owner ON owner.id=e.owner_id
                             LEFT JOIN event_publications p ON p.event_id=e.id ORDER BY e.seq DESC'''):
            events.append(json.loads(row['draft']))
            people[row['id']] = {'creator': row['creator']}
            publications[row['id']] = publication_entry(row, user)
            if row['published']:
                published[row['id']] = json.loads(row['published'])
            if user['role'] == 'admin' or row['owner_id'] == user['id']:
                allowed.append(row['id'])
        rows = db.all('''SELECT r.* FROM registrations r JOIN events e ON e.id=r.event_id
                          WHERE %s='admin' OR e.owner_id=%s ORDER BY r.seq DESC''', (user['role'],user['id']))
        records = [{'id': r['id'], 'eventId': r['event_id'], 'at': r['at'],
                    'fields': json.loads(r['fields_json']), 'values': json.loads(r['values_json'])} for r in rows]
    return {'user': session_user(user), 'events': events, 'published': published,
            'rows': records, 'recordEventIds': allowed, 'eventPeople': people, 'publications': publications}


def registration(db, event_id, data):
    version, values, request_id = data.get('version'), data.get('values'), data.get('requestId')
    if (type(version) is not int or version < 1 or not isinstance(values, dict)
            or not isinstance(request_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,128}', request_id)):
        raise ApiError(400, '报名格式无效，请重新打开邀请函。')
    if len(values) > 30 or any(not isinstance(v, str) or len(v) > 120 for v in values.values()):
        raise ApiError(400, '报名字段过多或输入超过 120 个字符。')
    values = {k: v.strip() for k,v in values.items()}
    with transaction(db, write=True):
        # Claims, retries and publication use the same event lock and lock order.
        row = event_row(db, event_id, lock=True)
        prior = db.one('SELECT * FROM registrations WHERE event_id=%s AND request_id=%s', (event_id,request_id))
        if prior:
            if prior['version'] != version or values != json.loads(prior['values_json']):
                raise ApiError(409, '这次提交已处理，请重新打开邀请函。')
            return {'id': prior['id'], 'at': prior['at']}
        event = visible_snapshot(row)
        state = registration_state(event, registration_enabled(row, event))
        if state != 'live':
            raise ApiError(409, {'upcoming': '报名尚未开始。', 'expired': '报名已截止。',
                                 'ended': '本活动当前未开放报名。'}[state])
        if version != event['version']:
            raise ApiError(409, '邀请函已更新，请刷新页面后报名。')
        if set(values) - {f['key'] for f in event['fields']}:
            raise ApiError(400, '报名字段与邀请函不符。')
        rules = active_rules(event)
        for field in event['fields']:
            value = values.get(field['key'], '')
            label = field['label']
            if field['required'] and not value:
                raise ApiError(400, '请填写'+label+'。')
            if field['key'] in rules.values():
                continue  # The explicit phone/WeChat rule validates this identifier below.
            if value and re.search('电话|手机',label) and not re.fullmatch(r'[+0-9() -]{6,24}',value):
                raise ApiError(400, '请输入有效的联系电话。')
            if value and '邮箱' in label and not re.fullmatch(r'[^@\s]+@[^@\s]+',value):
                raise ApiError(400, '请输入有效的邮箱。')
        receipt = {'id': secrets.token_urlsafe(16), 'at': utc_now()}
        db.execute('''INSERT INTO registrations(id,event_id,request_id,version,at,fields_json,values_json)
                   VALUES(%s,%s,%s,%s,%s,%s,%s)''', (receipt['id'],event_id,request_id,version,receipt['at'],
                                            compact(event['fields']),compact(values)))
        claim_identities(db, event_id, receipt['id'], rules, values)
        view = visit_values(data.get('visit'))
        if view:
            store_visit(db,event_id,view,converted=True)
        return receipt


class StudioHandler(BaseHTTPRequestHandler):
    server_version = 'EIM'

    def reply(self, data, status=200, mime=None, headers=None):
        body = data if mime else compact(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', mime or 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control','no-store')
        if not mime:
            self.send_header('X-Invite-Server-Time', str(time.time_ns() // 1_000_000))
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','same-origin')
        self.send_header('X-Frame-Options','DENY')
        self.send_header('Content-Security-Policy',"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'")
        for k,v in (headers or {}).items():
            self.send_header(k,v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def payload(self, limit=JSON_LIMIT):
        if self.headers.get_content_type() != 'application/json':
            raise ApiError(415, '请求内容类型不匹配。')
        try:
            size = int(self.headers.get('Content-Length', ''))
        except ValueError:
            raise ApiError(411, '请求缺少有效长度。') from None
        if not 0 <= size <= limit:
            raise ApiError(413, '提交的数据太大。')
        raw = self.rfile.read(size)
        if len(raw) != size:
            raise ApiError(400, '数据未完整上传。')
        try:
            obj = json.loads(raw.decode('utf-8'))
            if not isinstance(obj, dict):
                raise ValueError
            # Reject data that cannot be represented as utf8mb4.
            compact(obj).encode('utf-8')
        except (ValueError, RecursionError):
            raise ApiError(400,'JSON 内容无效。') from None
        return obj

    def token_digest(self):
        cookie = SimpleCookie()
        cookie.load(self.headers.get('Cookie', ''))
        token = cookie.get(COOKIE)
        if token and re.fullmatch(r'[A-Za-z0-9_-]{43}',token.value):
            return hashlib.sha256(token.value.encode()).hexdigest()
        return ''

    def user(self, db):
        return db.one('''SELECT u.id,u.username,u.role FROM sessions s JOIN users u ON s.user_id=u.id
                           LEFT JOIN member_state m ON m.user_id=u.id
                           WHERE s.digest=%s AND s.expires>%s AND COALESCE(m.enabled,1)=1
                           AND COALESCE(m.pending,0)=0''',(self.token_digest(),int(time.time())))

    def setup_allowed(self):
        return self.server.local_only and is_loopback(self.client_address[0]) and is_loopback(self.request_host)

    def user_reply(self, user, token):
        cookie = f'{COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_TTL if token else 0}'
        if self.server.secure_cookie:
            cookie += '; Secure'
        self.reply({'user': session_user(user),
                    'setupRequired':False}, headers={'Set-Cookie':cookie})

    def login(self, db):
        name,password = credentials(self.payload(limit=4096), creating=False)
        peer = self.client_address[0]
        # Bound repeated PBKDF attempts per source without retaining user credentials.
        now = time.monotonic()
        with self.server.rate_lock:
            limiter = self.server.login_attempts
            expired = [key for key,(start,_) in limiter.items() if now-start>=60]
            for key in expired:
                limiter.pop(key)
            start,count = limiter.get(peer,(now,0))
            if count >= 15:
                raise ApiError(429,'登录尝试过多，请稍后再试。')
            limiter[peer] = (start,count+1)
        user = db.one('SELECT * FROM users WHERE username_key=%s',(username_key(name),))
        digest = password_hash(password, user['salt'] if user else self.server.dummy_salt)
        if not user or not hmac.compare_digest(digest, user['password_hash']):
            raise ApiError(401, '用户名或密码不正确。')
        with transaction(db, write=True):
            lock_user(db, user['id'])
            current = db.one("""SELECT u.*, COALESCE(m.enabled,1) enabled, COALESCE(m.pending,0) pending
                                FROM users u LEFT JOIN member_state m ON m.user_id=u.id WHERE u.id=%s""", (user['id'],))
            if not current['enabled'] or current['pending'] or not hmac.compare_digest(digest, current['password_hash']):
                raise ApiError(401, '用户名或密码不正确，或账号暂不可登录。')
            token = self.record_session(db, current['id'])
        with self.server.rate_lock:
            self.server.login_attempts.pop(peer,None)
        self.user_reply(current, token)

    def record_session(self, db, user_id):
        token = session_token(db, user_id)
        db.execute('INSERT INTO member_logins(user_id,ip,at) VALUES(%s,%s,UTC_TIMESTAMP(3))',
                   (user_id, self.client_address[0]))
        return token

    def set_password(self, db):
        data = self.payload(limit=4096)
        token, kind = data.get('token'), data.get('type')
        error = ApiError(400, '链接已失效或已使用，请联系管理员重新生成。')
        if not isinstance(token, str) or not re.fullmatch(r'[0-9a-f]{64}', token) or kind not in ('invite', 'recovery'):
            raise error
        password = valid_password(data.get('password'))
        digest = hashlib.sha256(bytes.fromhex(token)).digest()
        query = 'SELECT user_id FROM password_links WHERE digest=%s AND kind=%s AND expires>%s'
        candidate = db.one(query, (digest, kind, int(time.time())))
        if not candidate:
            raise error
        user_id = candidate['user_id']
        salt = secrets.token_bytes(16)
        hashed = password_hash(password, salt)
        with transaction(db, write=True):
            lock_user(db, user_id)
            state = db.one('SELECT enabled,pending FROM member_state WHERE user_id=%s', (user_id,))
            if not state or not state['enabled'] or not state['pending'] or not db.one(query, (digest, kind, int(time.time()))):
                raise error
            db.execute('UPDATE users SET salt=%s,password_hash=%s WHERE id=%s', (salt, hashed, user_id))
            db.execute('UPDATE member_state SET pending=0 WHERE user_id=%s', (user_id,))
            db.execute('DELETE FROM password_links WHERE user_id=%s', (user_id,))
            db.execute('DELETE FROM sessions WHERE user_id=%s', (user_id,))
        self.reply({'ok': True})

    def public_origin(self):
        if self.server.public_origin:
            return self.server.public_origin
        scheme = 'https' if self.server.secure_cookie else 'http'
        return f"{scheme}://{self.headers['Host']}"

    def publication_url(self, row):
        return self.public_origin() + '/s/' + row['short_code']

    def publication_api(self, db, user, event_id, action):
        if self.command in ('GET', 'HEAD'):
            row = event_row(db, event_id)
            state = publication_entry(row, user)
            url = self.publication_url(row) if state['shortCode'] else None
            if action == 'qr':
                require_online(row)
                if not url:
                    raise ApiError(404, '活动短链接尚未生成。')
                image = BytesIO()
                qrcode.make(url, box_size=12, border=4).save(image, format='PNG')
                self.reply(image.getvalue(), mime='image/png',
                           headers={'Content-Disposition': f'attachment; filename="invite-{row["short_code"]}.png"'})
                return
            self.reply(dict(state, url=url, published=json.loads(row['published']) if row['published'] else None,
                            publicOriginConfigured=bool(self.server.public_origin),
                            wechatConfigured=self.server.wechat_configured))
            return
        if action != 'publication' or self.command != 'PATCH':
            raise ApiError(405, '请求方法不适用。')
        body = self.payload(limit=1024)
        operation = body.get('operation')
        options = {'close': ('accepting', False), 'open': ('accepting', True),
                   'offline': ('visible', False), 'restore': ('visible', True)}
        if not isinstance(operation, str) or operation not in options:
            raise ApiError(400, '发布操作无效。')
        with transaction(db, write=True):
            lock_user(db, user['id'])
            actor = self.user(db)
            if not actor:
                raise ApiError(401, '请先登录。')
            row = event_row(db, event_id, lock=True)
            if not can_manage_publication(row, actor):
                raise ApiError(403, '仅活动创建人和管理员可以管理发布。')
            if not row['short_code']:
                raise ApiError(409, '请先发布邀请函。')
            check_publication_revision(row, body.get('expectedRevision'))
            field, value = options[operation]
            if field == 'accepting' and not row['visible']:
                raise ApiError(409, '请先恢复上线。')
            if bool(row[field]) != value:
                db.execute(f'UPDATE event_publications SET {field}=%s,revision=revision+1 WHERE event_id=%s',
                           (value, event_id))
                log_event(db, json.loads(row['published']), actor['id'], operation)
                row.update({field: value, 'revision': row['revision'] + 1})
        self.reply(publication_entry(row, actor))

    def members(self, db, user, member_id, action):
        if user['role'] != 'admin':
            raise ApiError(403, '仅管理员可以管理成员。')
        if self.command in ('GET', 'HEAD'):
            if not member_id:
                items = db.all("""SELECT u.id,u.username,u.role,m.pending,COALESCE(m.enabled,1) enabled,
                                  l.ip,l.at FROM users u LEFT JOIN member_state m ON m.user_id=u.id
                                  LEFT JOIN member_logins l ON l.seq=(
                                      SELECT seq FROM member_logins WHERE user_id=u.id ORDER BY seq DESC LIMIT 1)
                                  ORDER BY u.id""")
                self.reply({'currentId': str(user['id']), 'items': [
                    dict(member_entry(item), lastLogin=log_time(item['at']), lastIP=item['ip']) for item in items]})
                return
            if action == 'logins':
                if not db.one('SELECT id FROM users WHERE id=%s', (int(member_id),)):
                    raise ApiError(404, '找不到该成员。')
                rows = db.all('SELECT ip,at FROM member_logins WHERE user_id=%s ORDER BY seq DESC LIMIT 100', (int(member_id),))
                self.reply({'items': [dict(ip=row['ip'], at=log_time(row['at'])) for row in rows]})
                return
        creating = not member_id and self.command == 'POST'
        linking = member_id and action == 'password-link' and self.command == 'POST'
        updating = member_id and not action and self.command == 'PATCH'
        if not (creating or linking or updating):
            raise ApiError(405, '请求方法不适用。')
        data = self.payload(limit=4096)
        role = data.get('role', 'member' if creating else None)
        enabled = data.get('enabled')
        if (creating or 'role' in data) and role not in ('member', 'admin'):
            raise ApiError(400, '请选择有效的成员角色。')
        if updating and (set(data) not in ({'role'}, {'enabled'}) or ('enabled' in data and type(enabled) is not bool)):
            raise ApiError(400, '请提交有效的角色或启停状态。')
        if creating:
            name = valid_username(data.get('username'))
            if 'password' in data:
                raise ApiError(400, '请让成员通过一次性链接设置密码。')

        with transaction(db, write=True):
            db.one('SELECT singleton FROM studio_meta WHERE singleton=1 FOR UPDATE')
            actor = self.user(db)
            if not actor:
                raise ApiError(401, '请先登录。')
            if actor['role'] != 'admin':
                raise ApiError(403, '仅管理员可以管理成员。')
            if creating:
                member = insert_user(db, name, secrets.token_bytes(16), secrets.token_bytes(32), role)
                db.execute('INSERT INTO member_state(user_id,pending) VALUES(%s,1)', (member['id'],))
                result = dict(member_entry(dict(member, pending=True)), **issue_password_link(db, member['id'], 'invite'))
            else:
                target_id = int(member_id)
                lock_user(db, target_id)
                target = db.one("""SELECT u.id,u.username,u.role,COALESCE(m.enabled,1) enabled,
                                   COALESCE(m.pending,0) pending FROM users u LEFT JOIN member_state m
                                   ON m.user_id=u.id WHERE u.id=%s""", (target_id,))
                if not target:
                    raise ApiError(404, '找不到该成员。')
                if target_id == actor['id'] and (linking or enabled is False or role == 'member'):
                    raise ApiError(409, '请由另一位管理员操作当前账号。')
                if linking:
                    if not target['enabled']:
                        raise ApiError(409, '请先启用该账号。')
                    db.execute("""INSERT INTO member_state(user_id,pending) VALUES(%s,1)
                                  ON DUPLICATE KEY UPDATE pending=1""", (target_id,))
                    db.execute('DELETE FROM sessions WHERE user_id=%s', (target_id,))
                    kind = 'invite' if target['pending'] else 'recovery'
                    result = dict(member_entry(dict(target, pending=True)), **issue_password_link(db, target_id, kind))
                elif enabled is not None:
                    db.execute("""INSERT INTO member_state(user_id,enabled) VALUES(%s,%s)
                                  ON DUPLICATE KEY UPDATE enabled=%s""", (target_id, enabled, enabled))
                    if not enabled:
                        db.execute('DELETE FROM sessions WHERE user_id=%s', (target_id,))
                        db.execute('DELETE FROM password_links WHERE user_id=%s', (target_id,))
                    result = member_entry(dict(target, enabled=enabled))
                else:
                    db.execute('UPDATE users SET role=%s WHERE id=%s', (role, target_id))
                    result = member_entry(dict(target, role=role))
        self.reply(result, 201 if creating or linking else 200)

    def api(self, db, path):
        get = self.command in ('GET','HEAD')
        post = self.command == 'POST'
        if path == '/api/session' and get:
            user = self.user(db)
            self.reply({'storage':'mysql','user':session_user(user),
                        'setupRequired':self.setup_allowed() and db.one('SELECT id FROM users LIMIT 1') is None})
            return
        if path == '/api/setup' and post:
            if not self.setup_allowed():
                raise ApiError(403,'首次初始化仅限本机服务。')
            if db.one('SELECT id FROM users LIMIT 1'):
                raise ApiError(409,'管理员已设置，请登录。')
            name,password = credentials(self.payload(limit=4096), creating=True)
            salt = secrets.token_bytes(16)
            digest = password_hash(password,salt)
            with transaction(db, write=True):
                user = create_user(db,name,salt,digest,first_only=True)
                token = self.record_session(db,user['id'])
            self.user_reply(user,token)
            return
        if path == '/api/set-password' and post:
            self.set_password(db)
            return
        if path == '/api/login' and post:
            self.login(db)
            return
        if path == '/api/logout' and post:
            db.execute('DELETE FROM sessions WHERE digest=%s',(self.token_digest(),))
            self.user_reply(None,'')
            return
        match = re.fullmatch(r'/api/public/'+EVENT_PATH+r'(/registrations|/cover|/visits)?',path)
        if match:
            event_id, subpath = match.groups()
            if get and subpath in (None, '/cover'):
                row = event_row(db, event_id)
                event = visible_snapshot(row)
                if subpath == '/cover':
                    if not event.get('cover'):
                        raise ApiError(404, '尚未设置封面。')
                    header, encoded = event['cover'].split(',', 1)
                    self.reply(base64.b64decode(encoded), mime=header[5:].split(';')[0])
                else:
                    accepting = registration_enabled(row, event)
                    event['status'] = 'live' if registration_state(event, accepting) == 'live' else 'ended'
                    self.reply(event, headers={'X-Invite-Registration-Enabled': '1' if accepting else '0'})
            elif post and subpath == '/registrations':
                self.reply(registration(db,event_id,self.payload(limit=65536)),201)
            elif post and subpath == '/visits':
                values = visit_values(self.payload(limit=1024))
                if not values:
                    raise ApiError(400,'访问记录格式无效。')
                with transaction(db,write=True):
                    row = db.one('''SELECT e.published IS NOT NULL published,p.visible FROM events e
                                    LEFT JOIN event_publications p ON p.event_id=e.id WHERE e.id=%s FOR UPDATE''',
                                 (event_id,))
                    require_online(row or {'published':False})
                    store_visit(db,event_id,values)
                self.reply({'ok':True})
            else:
                raise ApiError(405,'请求方法不适用。')
            return
        user = self.user(db)
        if not user:
            raise ApiError(401,'请先登录。')
        if match := MEMBER_PATH.fullmatch(path):
            self.members(db, user, *match.groups())
            return
        if path == '/api/workspace' and get:
            self.reply(workspace(db,user))
            return
        if path in ('/api/insights', '/api/insights/events') and get:
            query = parse_qs(urlsplit(self.path).query)
            period = query.get('days',['all'])[0]
            if period not in ('all','7','30'):
                raise ApiError(400,'统计范围无效。')
            if path == '/api/insights/events':
                self.reply(activity_totals(db,user,0 if period=='all' else int(period)))
                return
            result = insights(db,user,query.get('event',[''])[0],0 if period=='all' else int(period))
            if result is None:
                raise ApiError(404,'找不到可查看的活动。')
            self.reply(result)
            return
        if path == '/api/events' and post:
            payload = self.payload()
            event = payload.get('event')
            validate_event(event)
            source = payload.get('sourceId')
            if source is not None and (not isinstance(source, str) or not re.fullmatch(EVENT_PATH, source)):
                raise ApiError(400, '复制来源无效。')
            if event['version'] != 0:
                raise ApiError(400,'新活动须使用初始版本。')
            event.update(version=1,status='draft')
            with transaction(db, write=True):
                lock_user(db, user['id'])
                if not self.user(db):
                    raise ApiError(401, '请先登录。')
                if source:
                    event_row(db, source)
                try:
                    db.execute('INSERT INTO events(id,draft,owner_id) VALUES(%s,%s,%s)',
                               (event['id'],compact(event),user['id']))
                except IntegrityError as exc:
                    if exc.errno != errorcode.ER_DUP_ENTRY:
                        raise
                    raise ApiError(409,'活动 ID 已存在。') from exc
                log_event(db, event, user['id'], 'copy' if source else 'create')
            self.reply(event,201)
            return
        match = re.fullmatch(r'/api/events/'+EVENT_PATH+r'(?:/(publish|operations|publication|qr))?',path)
        if not match:
            raise ApiError(404,'接口不存在。')
        event_id, action = match.groups()
        if action in ('publication', 'qr'):
            self.publication_api(db, user, event_id, action)
            return
        if get and action == 'operations':
            event_row(db, event_id)
            rows = db.all('''SELECT u.username,op.operation,op.version,op.changes,op.at FROM event_operations op
                            JOIN users u ON u.id=op.actor_id WHERE op.event_id=%s ORDER BY op.seq DESC LIMIT 100''', (event_id,))
            self.reply({'items': [dict(username=row['username'], operation=row['operation'], version=row['version'],
                                       changes=json.loads(row['changes']), at=log_time(row['at'])) for row in rows]})
            return
        if get and action is None:
            self.reply(json.loads(event_row(db,event_id)['draft']))
            return
        if self.command=='PUT' and action is None or post and action=='publish':
            payload = self.payload()
            event = payload.get('event')
            validate_event(event)
            with transaction(db, write=True):
                lock_user(db, user['id'])
                actor = self.user(db)
                if not actor:
                    raise ApiError(401, '请先登录。')
                row = event_row(db, event_id, lock=True)
                if action == 'publish':
                    if not can_manage_publication(row, actor):
                        raise ApiError(403, '仅活动创建人和管理员可以发布。')
                    if 'expectedRevision' in payload:
                        check_publication_revision(row, payload['expectedRevision'])
                saved = save_event(db,event,event_id,publish=action=='publish',actor_id=actor['id'],row=row)
            self.reply(saved)
            return
        raise ApiError(405,'请求方法不适用。')

    def dispatch(self):
        path = urlsplit(self.path).path
        host = self.headers.get('Host','')
        if not re.fullmatch(r'[A-Za-z0-9.\-\[\]:]+',host):
            raise ApiError(400,'无效的 Host。')
        self.request_host = urlsplit('//'+host).hostname
        if self.server.local_only and not is_loopback(self.request_host):
            raise ApiError(403,'此服务仅接受本机地址。')
        if self.command not in ('GET','HEAD'):
            origin = self.headers.get('Origin')
            if self.headers.get('Sec-Fetch-Site')=='cross-site' or (
                origin and origin not in ('http://'+host,'https://'+host)
            ):
                raise ApiError(403,'请在当前服务页面提交。')
        if path.startswith('/api/'):
            with closing(db_connect(self.server.database_config)) as db:
                self.api(db,path)
            return
        if self.command not in ('GET','HEAD'):
            raise ApiError(405,'请求方法不适用。')
        guest = re.fullmatch(r'/i/'+EVENT_PATH, path)
        short = SHORT_PATH.fullmatch(path)
        gallery = re.fullmatch(r'/templates(?:/(?:archive|blueprint|salon|poster|ink|neural))?', path)
        name = 'index.html' if path in ('/', '/set-password') or guest or short or gallery else path.removeprefix('/')
        if name not in PUBLIC_FILES or not (ROOT/name).is_file():
            raise ApiError(404,'页面不存在。')
        body = (ROOT/name).read_bytes()
        if gallery:
            body = body.replace(b'<head>', b'<head><base href="/">', 1)
        if guest or short:
            # Published designs carry their own assets. Guests need no starter collection.
            body = re.sub(rb' *<script defer src="forum-(?:media|designs)\.js"></script>\s*', b'', body)
            with closing(db_connect(self.server.database_config)) as db:
                if short:
                    mapping = db.one('SELECT event_id FROM event_publications WHERE short_code=%s', (short[1],))
                    if not mapping:
                        raise ApiError(404, '找不到该活动。')
                    event_id = mapping['event_id']
                else:
                    event_id = guest[1]
                row = event_row(db, event_id)
            if row['visible'] == 0:
                unavailable = ('<!doctype html><html lang="zh-CN"><meta charset="utf-8">'
                               '<meta name="viewport" content="width=device-width,initial-scale=1">'
                               '<title>邀请函已下线 · EIM</title><link rel="stylesheet" href="/studio.css">'
                               '<main id="workspace"><section class="auth-card"><h1>邀请函已下线</h1>'
                               '<p>如需活动信息，请联系活动主办方。</p></section></main></html>')
                self.reply(unavailable.encode('utf-8'), 410, 'text/html; charset=utf-8')
                return
            event = visible_snapshot(row)
            title = escape(event['title'], quote=True)
            tags = (f'<base href="/"><meta name="invite-event" content="{escape(event_id, quote=True)}">'
                    f'<meta property="og:title" content="{title}">')
            if row['short_code']:
                tags += f'<meta property="og:url" content="{escape(self.publication_url(row), quote=True)}">'
            if event.get('cover'):
                cover_url = f"{self.public_origin()}/api/public/{event_id}/cover?v={event['version']}"
                tags += f'<meta property="og:image" content="{escape(cover_url, quote=True)}">'
            body = body.replace(b'<head>', ('<head>'+tags).encode(), 1)
            body = re.sub(b'<title>.*?</title>', lambda _: f'<title>{title}</title>'.encode(), body, count=1)
        self.reply(body,mime=mimetypes.guess_type(name)[0] or 'application/octet-stream')

    def handle_request(self):
        try:
            self.dispatch()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except (ApiError, ValidationError) as error:
            code = error.status if isinstance(error,ApiError) else 400
            self.reply({'error':str(error)}, code)
        except MySQLError as error:
            self.log_error('MySQL error %s in %s', error.errno, self.command)
            self.reply({'error':'数据库暂时不可用，请稍后重试。'},503)
        except Exception:
            self.log_error('Unexpected request error (%s)',self.command)
            self.reply({'error':'服务器处理失败。'},500)

    do_GET = do_HEAD = do_POST = do_PUT = do_PATCH = handle_request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(required=True,dest='command')
    serve = commands.add_parser('serve')
    serve.add_argument('--host',default='127.0.0.1')
    serve.add_argument('--port',type=int,default=5820)
    serve.add_argument('--secure-cookie',action='store_true',help='Use a Secure cookie behind an HTTPS reverse proxy')
    serve.add_argument('--background',action='store_true',help='Start a worker detached from the launcher with file logs')
    add = commands.add_parser('user-add')
    add.add_argument('--username',required=True)
    for sub in (serve,add):
        sub.add_argument('--data-dir',type=Path,default=ROOT/'data')
    args = parser.parse_args()
    config = initialize(args.data_dir.resolve())
    if args.command == 'serve' and args.background:
        directory = args.data_dir.resolve()
        command = [sys.executable, '-B', '-u', str(ROOT/'server.py'), 'serve',
                   '--host', args.host, '--port', str(args.port), '--data-dir', str(directory)]
        if args.secure_cookie:
            command.append('--secure-cookie')
        with (directory/'service.log').open('ab') as out, (directory/'service-error.log').open('ab') as err:
            process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=out, stderr=err,
                                       close_fds=True, start_new_session=os.name != 'nt',
                                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        print(process.pid)
        return
    if args.command == 'user-add':
        password = getpass('Password: ') if sys.stdin.isatty() else sys.stdin.readline().rstrip('\r\n')
        name,password = credentials({'username':args.username,'password':password},creating=True)
        salt = secrets.token_bytes(16)
        digest = password_hash(password,salt)
        with closing(db_connect(config)) as db, transaction(db, write=True):
            user = create_user(db,name,salt,digest)
        print(f"Created {user['role']} account: {name}")
        return
    with ThreadingHTTPServer((args.host,args.port),StudioHandler) as server:
        server.database_config = config
        server.local_only = is_loopback(server.server_address[0])
        server.secure_cookie = args.secure_cookie
        server.public_origin = os.environ.get('INVITE_PUBLIC_ORIGIN', '').strip().rstrip('/')
        if server.public_origin and not re.fullmatch(r'https://[A-Za-z0-9.-]+(?::443)?', server.public_origin):
            raise ValueError('INVITE_PUBLIC_ORIGIN 须为 HTTPS 域名，去掉路径和查询参数。')
        server.wechat_configured = bool(os.environ.get('INVITE_WECHAT_APP_ID') and
                                        os.environ.get('INVITE_WECHAT_APP_SECRET'))
        server.dummy_salt = secrets.token_bytes(16)
        server.rate_lock = threading.Lock()
        server.login_attempts = {}
        print(f'EIM listening on http://{args.host}:{server.server_port}',flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    try:
        main()
    except (ApiError, ValueError, MySQLError) as error:
        sys.exit(str(error))
