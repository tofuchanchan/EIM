"""Anonymous public-invitation visits, foreground time and owner-scoped aggregates."""
from datetime import datetime, time, timedelta, timezone
import hashlib
import re

from mysql_storage import transaction


SHANGHAI = timezone(timedelta(hours=8))
TOKEN = re.compile(r"[0-9a-f]{32}")


def visit_values(data):
    if not isinstance(data, dict):
        return None
    visit, visitor = data.get("visitId"), data.get("visitorId")
    duration, last = data.get("activeMs"), data.get("reachedLast")
    if not all(isinstance(k, str) and TOKEN.fullmatch(k) for k in (visit, visitor)):
        return None
    if type(duration) is not int or not 0 <= duration <= 2**53-1 or type(last) is not bool:
        return None
    return bytes.fromhex(visit), hashlib.sha256(bytes.fromhex(visitor)).digest(), duration, last


def store_visit(db, event_id, values, *, converted=False):
    """Caller has checked publication. Reordered heartbeats/retries cannot add a second visit."""
    visit, digest, milliseconds, reached = values
    db.execute("""INSERT INTO event_visits(event_id,visit_id,visitor_digest,started_at)
                  VALUES(%s,%s,%s,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE visit_id=event_visits.visit_id""",
               (event_id, visit, digest))
    db.execute("""UPDATE event_visits SET active_ms=GREATEST(active_ms,
                     LEAST(%s,GREATEST(0,TIMESTAMPDIFF(MICROSECOND,started_at,UTC_TIMESTAMP(3)) DIV 1000))),
                  reached_last=GREATEST(reached_last,%s),converted=GREATEST(converted,%s)
                  WHERE event_id=%s AND visit_id=%s AND visitor_digest=%s""",
               (milliseconds, reached, converted, event_id, visit, digest))


def midnight(day):
    return datetime.combine(day, time.min, SHANGHAI).astimezone(timezone.utc)


def metric_scope(user, event_id=None):
    scope = ["1=1"]
    args = []
    if user["role"] != "admin":
        scope.append("e.owner_id=%s")
        args.append(user["id"])
    if event_id:
        scope.append("e.id=%s")
        args.append(event_id)
    return " AND ".join(scope), tuple(args)


def activity_totals(db, user, days):
    """One grouped result per permitted activity, including activities with zero visits."""
    today = datetime.now(SHANGHAI).date()
    since = midnight(today-timedelta(days=days-1)) if days else None
    where, args = metric_scope(user)
    visits_since = " AND v.started_at>=%s" if since else ""
    signup_since = " AND r.at>=%s" if since else ""
    with transaction(db, write=False):
        events = db.all("SELECT e.id FROM events e WHERE "+where+" ORDER BY e.seq DESC", args)
        visits = db.all(
            "SELECT v.event_id,COUNT(*) pv,COUNT(DISTINCT v.visitor_digest) uv,SUM(v.active_ms) ms,"
            "SUM(v.reached_last) reached,SUM(v.converted) converted FROM event_visits v "
            "JOIN events e ON e.id=v.event_id WHERE "+where+visits_since+" GROUP BY v.event_id",
            args+((since.replace(tzinfo=None),) if since else ()))
        registrations = db.all(
            "SELECT r.event_id,COUNT(*) signups FROM registrations r JOIN events e ON e.id=r.event_id WHERE "
            +where+signup_since+" GROUP BY r.event_id",
            args+((since.isoformat(timespec="milliseconds"),) if since else ()))
    by_event={row["event_id"]:{k:int(v) for k,v in row.items() if k!="event_id"} for row in visits}
    signup_counts={row["event_id"]:int(row["signups"]) for row in registrations}
    empty=dict(pv=0,uv=0,ms=0,reached=0,converted=0)
    return {"items":[dict(eventId=row["id"], signups=signup_counts.get(row["id"],0),
                          **by_event.get(row["id"],empty)) for row in events]}


def insights(db, user, event_id, days):
    """Visit metrics use the visit's start day; signups use the submission day."""
    today = datetime.now(SHANGHAI).date()
    since = midnight(today-timedelta(days=days-1)) if days else None
    where, args = metric_scope(user, event_id)

    def counts(table, alias, column, since_dt, select, group=""):
        sql = f"SELECT {select} FROM {table} {alias} JOIN events e ON e.id={alias}.event_id WHERE {where}"
        params = list(args)
        if since_dt:
            sql += f" AND {column}>=%s"
            params.append(since_dt.isoformat(timespec="milliseconds") if alias=="r" else since_dt.replace(tzinfo=None))
        return db.all(sql+" "+group, tuple(params))

    with transaction(db, write=False):
        if event_id and not db.one("SELECT e.id FROM events e WHERE "+where,tuple(args)):
            return None
        raw = counts("event_visits","v","v.started_at",since,
                     "COUNT(*) pv,COUNT(DISTINCT visitor_digest) uv,COALESCE(SUM(active_ms),0) ms,"
                     "COALESCE(SUM(reached_last),0) reached,COALESCE(SUM(converted),0) converted")[0]
        summary = {k:int(v) for k,v in raw.items()}
        summary["signups"] = int(counts("registrations","r","r.at",since,"COUNT(*) n")[0]["n"])
        start = today-timedelta(days=(days or 30)-1)
        trend_from = midnight(start)
        visit_days = counts("event_visits","v","v.started_at",trend_from,
                            "DATE(v.started_at+INTERVAL 8 HOUR) day, COUNT(*) n","GROUP BY day")
        signup_days = counts("registrations","r","r.at",trend_from,
                             "DATE(CAST(REPLACE(LEFT(r.at,19),'T',' ') AS DATETIME)+INTERVAL 8 HOUR) day, COUNT(*) n","GROUP BY day")
    pv_by_day = {str(row["day"]):int(row["n"]) for row in visit_days}
    signups_by_day = {str(row["day"]):int(row["n"]) for row in signup_days}
    trend = []
    for offset in range((today-start).days+1):
        key = (start+timedelta(days=offset)).isoformat()
        trend.append(dict(day=key,pv=pv_by_day.get(key,0),signups=signups_by_day.get(key,0)))
    return {"summary":summary,"trend":trend,"since":since.isoformat() if since else None}
