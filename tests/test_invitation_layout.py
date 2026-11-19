"""Component canvas contract and storage compatibility."""
import base64
import copy
from contextlib import closing
import io
import json
from pathlib import Path
import subprocess
import unittest

from PIL import Image

from invite_packages import MIB, ValidationError, validate_design, validate_event
from server import db_connect, event_row, save_event, transaction
from mysql_fixture import mysql_schema


def component(kind="paragraph", content=None):
    return {
        "id": "block_" + kind, "type": kind, "x": 3.4, "y": 10, "w": 95, "h": 40,
        "content": {"text": "{{title}}"} if content is None else content,
        "style": {"fontSize": 20, "font": "serif", "align": "left", "bold": True, "radius": 4,
                  "color": "#113355", "background": "transparent"},
        "animation": {"type": "rise", "duration": 420, "delay": 60},
    }


def page(elements):
    return {"id": "pageOne", "name": "邀请信", "background": "#fefefe", "transition": "fade", "elements": elements}


def png():
    buffer = io.BytesIO()
    Image.new("RGB", (11, 9), "teal").save(buffer, "PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


class InvitationLayout(unittest.TestCase):
    def setUp(self):
        original = json.loads((Path(__file__).resolve().parents[1] / "seed-events.json").read_text(encoding="utf-8"))[0]
        self.original = original
        self.event = dict(original, template="invitation")

    def validate_components(self, items):
        validate_event(dict(self.event, design={"pages": [page(items)]}))

    def test_all_editable_component_kinds(self):
        components = [component(k) for k in ("paragraph", "textbox", "title")]
        components.extend([component("table", {"rows": [["时间", "项目"], ["14:00", "签到"]]}),
                           component("button", {"text": "回执", "action": "register", "url": ""}),
                           component("divider", {}),
                           component("image", {"src": png(), "fit": "cover", "alt": "主视觉"})])
        self.validate_components(components)
        components[-1]["content"]["src"] = "@cover"
        self.validate_components(components)
        self.validate_components([])

    def test_geometry_style_animation_and_identity(self):
        normal = component()
        bad = [
            dict(normal, x=-.01), dict(normal, w=0), dict(normal, y=95, h=6), dict(normal, w=True),
            dict(normal, h=float("nan")), dict(normal, h=float("inf")),
            dict(normal, type="html"), dict(normal, script="anything"),
            dict(normal, style=dict(normal["style"], align="justify")),
            dict(normal, style=dict(normal["style"], fontSize=1)),
            dict(normal, style=dict(normal["style"], background="not-a-color")),
            dict(normal, style=dict(normal["style"], bold="true")),
            dict(normal, animation=dict(normal["animation"], duration=-1)),
            dict(normal, animation=dict(normal["animation"], type="random")),
        ]
        for invalid in bad:
            with self.subTest(component=invalid), self.assertRaises(ValidationError):
                self.validate_components([invalid])
        with self.assertRaises(ValidationError):
            self.validate_components([normal, copy.deepcopy(normal)])
        with self.assertRaises(ValidationError):
            validate_event(dict(self.event, design={"pages": [page([]),page([])]}))

    def test_content_and_page_limits(self):
        for bad in [component("table", {"rows": [["a"], ["b","c"]]}),
                    component("table", {"rows": []}), component("paragraph", {"text": "字"*8001}),
                    component("button", {"action":"link","text":"跳转","url":"invalid"}),
                    component("image", {"src":"https://example.org/remote.png","alt":"","fit":"cover"}),
                    component("image", {"src":"data:image/png;base64,eHh4","alt":"","fit":"cover"})]:
            with self.subTest(kind=bad["type"]), self.assertRaises(ValidationError):
                self.validate_components([bad])
        for invalid in [{"pages":[]}, {"pages":[dict(page([]), transition="unknown")]},
                        {"pages":[dict(page([]), elements=[component()]*65)]}]:
            with self.assertRaises(ValidationError):
                validate_event(dict(self.event, design=invalid))
        # Directly exercise the aggregate budget without constructing a huge test image.
        image_component = component("image", {"src": png(), "fit": "cover", "alt": ""})
        with self.assertRaisesRegex(ValidationError, "合计"):
            validate_design({"pages": [page([image_component])]}, cover_bytes=8*MIB)

    def test_new_draft_preserves_old_public_version_until_publish(self):
        validate_event(self.original)
        with mysql_schema() as config, closing(db_connect(config)) as db:
            design = {"pages":[page([component()])]}
            candidate = dict(self.event, design=design)
            validate_event(candidate)
            original_public = event_row(db,candidate["id"])["published"]
            with transaction(db, write=True):
                saved = save_event(db, candidate, candidate["id"])
            self.assertEqual(event_row(db,candidate["id"])["published"],original_public)
            with transaction(db, write=True):
                published = save_event(db,saved,candidate["id"],publish=True)
            self.assertEqual(published["design"],design)
            self.assertEqual(json.loads(event_row(db,candidate["id"])["published"])["design"], design)

    def test_browser_converts_existing_content_to_valid_editable_design(self):
        source = dict(self.original, template="salon", story={
            "accent": "#2c5544", "background": "#f0f0f0", "font": "serif",
            "pages": [
                {"type": "cover", "title": "旧封面", "body": "原始封面副标题"},
                {"type": "agenda", "title": "旧活动议程", "body": "09:00 浏览完整议程"},
                {"type": "location", "title": "旧地址", "body": "三楼"},
                {"type": "follow", "title": "扫码交流", "body": "往期关注方式"},
                {"type": "rsvp", "title": "回执", "body": "提交回执"},
            ],
            "mapUrl": "https://example.com/maps", "followUrl": "https://example.com/follow", "followImage": png(),
        })
        script = """
            global.window = global;
            require('./invite-layout.js');
            const fs = require('node:fs');
            const input = JSON.parse(fs.readFileSync(0, 'utf8'));
            const old = JSON.stringify(input);
            const result = InviteLayout.prepare(input);
            if (JSON.stringify(input) !== old) throw Error('Conversion mutated the source');
            process.stdout.write(JSON.stringify(result));
        """
        for sample in [self.original, source]:
            result = subprocess.run(["node", "-e", script], input=json.dumps(sample), text=True,
                                    encoding="utf-8", capture_output=True, check=True,
                                    cwd=Path(__file__).resolve().parents[1])
            event = json.loads(result.stdout)
            self.assertEqual(event["template"], "invitation")
            validate_event(event)
            content = json.dumps(event["design"], ensure_ascii=False)
            if sample is source:
                for value in ("原始封面副标题", "浏览完整议程", "往期关注方式", source["story"]["mapUrl"],
                              source["story"]["followUrl"], source["story"]["followImage"]):
                    self.assertIn(value, content)
            else:
                for block in self.original["blocks"]:
                    self.assertIn(block["title"], content)


if __name__ == "__main__":
    unittest.main()
