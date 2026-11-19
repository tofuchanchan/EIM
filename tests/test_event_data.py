from contextlib import closing
import subprocess
import unittest

from mysql_fixture import mysql_schema
from mysql_storage import ROOT, db_connect
from tools.migrate_mysql import setup_database, target_report


class AnalyticsUpgrade(unittest.TestCase):
    def test_upgrade_preserves_old_records_and_repeats_safely(self):
        with mysql_schema() as cfg, closing(db_connect(cfg)) as db:
            before=target_report(db)
            db.execute("DROP TABLE event_visits")
            db.execute("UPDATE studio_meta SET schema_version=1 WHERE singleton=1")
            for _ in range(2):
                self.assertEqual(setup_database(cfg,upgrade=True),{"schema_version":4})
            self.assertEqual(db.one("SELECT COUNT(*) n FROM event_visits")["n"],0)
            self.assertEqual(target_report(db),before)
            for table in ("password_links", "member_state", "member_logins", "event_operations"):
                db.execute("DROP TABLE " + table)
            db.execute("UPDATE studio_meta SET schema_version=2 WHERE singleton=1")
            self.assertEqual(setup_database(cfg,upgrade=True),{"schema_version":4})
            self.assertEqual(target_report(db),before)
            db.execute("DROP TABLE event_publications")
            db.execute("UPDATE studio_meta SET schema_version=3 WHERE singleton=1")
            self.assertEqual(setup_database(cfg,upgrade=True),{"schema_version":4})
            publication = db.one("SELECT short_code,visible,accepting FROM event_publications WHERE event_id='caiyun2025'")
            self.assertEqual(len(publication["short_code"]),8)
            self.assertTrue(publication["visible"])
            self.assertFalse(publication["accepting"])
            self.assertEqual(setup_database(cfg,upgrade=True),{"schema_version":4})
            self.assertEqual(db.one("SELECT short_code FROM event_publications WHERE event_id='caiyun2025'")["short_code"],
                             publication["short_code"])
            self.assertEqual(target_report(db),before)

    def test_foreground_time_and_visitor_lifetime(self):
        script="""
        const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
        let now=0;const doc=new EventTarget(),win=new EventTarget(),store=new Map(),packets=[];
        doc.visibilityState='hidden';
        const sandbox={window:win,document:doc,crypto:require('node:crypto').webcrypto,
            localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},
            navigator:{},performance:{now:()=>now},Blob,setInterval:()=>1,clearInterval:()=>{},
            fetch:async(url,opts)=>packets.push(JSON.parse(opts.body))};
        vm.runInNewContext(fs.readFileSync('event-data.js','utf8'),sandbox);
        const a=win.EventData.tracker('event');a.page(0,7);assert.equal(packets.length,0);
        doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));
        assert.equal(packets.length,1);
        now=2400;doc.visibilityState='hidden';doc.dispatchEvent(new Event('visibilitychange'));
        assert.equal(packets.at(-1).activeMs,2400);
        now=15000;doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));
        now=16600;a.page(6,7);
        assert.equal(a.payload().activeMs,4000);assert.equal(a.payload().reachedLast,true);
        const b=win.EventData.tracker('event');b.page(0,7);
        assert.equal(b.payload().visitorId,a.payload().visitorId);assert.notEqual(b.payload().visitId,a.payload().visitId);
        """
        subprocess.run(["node","-e",script],cwd=ROOT,check=True)
