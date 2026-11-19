"""The six seven-page looks share the Zhongbang brief and editable content."""
import json
from pathlib import Path
import subprocess
import unittest

from invite_packages import validate_event


class BusinessInvitations(unittest.TestCase):
    def test_six_designs_one_brief(self):
        root = Path(__file__).resolve().parents[1]
        code = """global.window=global;require('./invite-layout.js');require('./forum-media.js');
        require('./forum-designs.js');console.log(JSON.stringify(Object.keys(ForumTemplates.looks).map(ForumTemplates.sample)));"""
        samples = json.loads(subprocess.check_output(["node", "-e", code], cwd=root))
        self.assertEqual(len(samples), 6)
        signatures = []
        layouts = []
        for event in samples:
            validate_event(event)
            self.assertIn("中邦",event["title"])
            pages = event["design"]["pages"]
            self.assertEqual([p["name"] for p in pages],
                             ["邀请函首页", "诚挚邀请", "活动议程", "会场导航", "受邀回执", "参会须知", "关于承办方"])
            self.assertIn("inline-register", [el["content"].get("action") for el in pages[4]["elements"]])
            self.assertTrue(any(el["type"] == "image" and el["content"]["src"].startswith("data:image/png;")
                                for el in pages[3]["elements"]))
            content = []
            for p in pages:
                visible=[]
                actions=[]
                for el in p["elements"]:
                    c=el["content"]
                    if c.get("text"):
                        visible.extend(line for line in c["text"].splitlines() if line)
                    if c.get("rows"):
                        visible.extend(cell for row in c["rows"] for cell in row)
                    if c.get("action"):
                        actions.append((c["action"],c["url"]))
                content.append((p["name"],sorted(visible),sorted(actions)))
            signatures.append(([event[k] for k in ("title", "date", "time", "place", "fields")], content))
            layouts.append(tuple((el["x"], el["y"], el["w"], el["h"]) for el in pages[0]["elements"]))
        for sig in signatures[1:]:
            self.assertEqual(signatures[0], sig)
        self.assertEqual(len(set(layouts)), 6)
        compositions=[tuple(el["type"] for el in e["design"]["pages"][2]["elements"]) for e in samples]
        self.assertGreaterEqual(len(set(compositions)),5)


if __name__ == "__main__":
    unittest.main()
