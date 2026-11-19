"""Exercise the server's v1 amendment contract without persisting any changes."""
import base64
import copy
import io
import json
from pathlib import Path
import sys
import unittest
import zipfile

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from invite_packages import ValidationError, VersionConflict, inspect_changes, validate_event


def archive(doc, assets=None, method=zipfile.ZIP_DEFLATED):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", method) as zf:
        zf.writestr("changes.json", json.dumps(doc, ensure_ascii=False))
        for path, data in (assets or {}).items():
            zf.writestr(path, data)
    return output.getvalue()


class ServerPackages(unittest.TestCase):
    def setUp(self):
        self.event = dict(id="future", version=1, status="live", title="未来协作创新峰会", theme="violet",
                          date="2026-12-12", place="上海", template="classic", detail="邀请函", cover="",
                          blocks=[dict(id="schedule", type="agenda", title="日程", body="签到")],
                          fields=[dict(key="company", label="单位", required=True)])
        self.doc = dict(formatVersion=1, baseVersion=1, activityId="future", changes=[
            dict(op="set", field="time", value="14:30"),
            dict(op="set", field="template", value="agenda"),
            dict(op="addField", field=dict(id="job", label="职位", required=False)),
            dict(op="updateField", field=dict(id="company", label="企业", required=True)),
            dict(op="reorderFields", ids=["job", "company"]),
            dict(op="addBlock", block=dict(id="reminder", type="notice", title="提示", body="提前签到")),
            dict(op="updateBlock", block=dict(id="schedule", type="agenda", title="议程", body="14:30 签到")),
            dict(op="reorderBlocks", ids=["reminder", "schedule"]),
        ])

    def test_store_and_deflate_produce_same_review(self):
        original = copy.deepcopy(self.event)
        first, second = [inspect_changes(archive(self.doc, method=method), self.event)
                         for method in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)]
        self.assertEqual(first, second)
        self.assertEqual(self.event, original)
        self.assertEqual(first["baseVersion"], 1)
        self.assertEqual(len(first["diffs"]), 8)
        self.assertEqual(first["candidate"]["fields"][0], {"key": "job", "label": "职位", "required": False})
        self.assertEqual(first["candidate"]["blocks"][1]["body"], "14:30 签到")
        self.assertIn(dict(label="开始时间", before="", after="14:30"), first["diffs"])
        self.assertEqual(first["candidate"]["version"], original["version"])

    def test_remove_and_reorder_require_existing_ids(self):
        review = inspect_changes(archive(self.doc), self.event)
        next_event = dict(review["candidate"], version=2)
        patch = dict(self.doc, baseVersion=2, changes=[
            dict(op="removeBlock", id="schedule"), dict(op="removeField", id="job")
        ])
        amended = inspect_changes(archive(patch), next_event)
        self.assertEqual([d["label"] for d in amended["diffs"]], ["移除报名字段", "移除页面区块"])
        for op in [dict(op="reorderFields", ids=["company", "company"]), dict(op="removeField", id="other")]:
            with self.subTest(op=op), self.assertRaises(ValidationError):
                inspect_changes(archive(dict(patch, changes=[op])), next_event)

    def test_version_and_identity(self):
        with self.assertRaises(VersionConflict):
            inspect_changes(archive(self.doc), dict(self.event, version=2))
        with self.assertRaisesRegex(ValidationError, "目标活动"):
            inspect_changes(archive(self.doc), dict(self.event, id="another"))
        with self.assertRaisesRegex(ValidationError, "草稿版本"):
            inspect_changes(archive(dict(self.doc, baseVersion=True)), self.event)

    def test_untrusted_shapes_bounds_and_no_partial_mutation(self):
        cases = [
            dict(op="set", field="status", value="live"),
            dict(op="set", field="theme", value="teal"),
            dict(op="set", field="date", value="2026-02-29"),
            dict(op="set", field="time", value="24:10"),
            dict(op="set", field="template", value=[]),
            dict(op="set", field="title", value="🚀" * 51),
            dict(op="removeField", id="company"),
            dict(op="addField", field=dict(id="roles", label="单位", required=False)),
            dict(op="addField", field=dict(id="constructor", label="职位", required=False)),
            dict(op="addField", field=dict(id="roles", label="职位", required=1)),
            dict(op="addBlock", block=dict(id="block", type="script", title="说明", body="")),
            dict(op="set", field="place", value="苏州", unexpected=True),
        ]
        for op in cases:
            with self.subTest(op=op), self.assertRaises(ValidationError):
                inspect_changes(archive(dict(self.doc, changes=[dict(op="set", field="place", value="深圳"), op])), self.event)
        self.assertEqual(self.event["place"], "上海")
        with self.assertRaises(ValidationError):
            validate_event(dict(self.event, registrations=[]))
        with self.assertRaises(ValidationError):
            validate_event(dict(self.event, fields=[dict(self.event["fields"][0], extra=None)]))

    def test_actual_external_skill_sample(self):
        review = inspect_changes((ROOT / "example-changes.zip").read_bytes(), self.event)
        self.assertEqual(review["candidate"]["date"], "2026-12-19")
        self.assertTrue(review["candidate"]["cover"].startswith("data:image/jpeg;base64,"))
        self.assertIn({"label":"新增报名字段", "before":"无", "after":"职位（选填）"}, review["diffs"])

    def test_image_formats_and_file_rules(self):
        for suffix, fmt in [("png", "PNG"), ("jpg", "JPEG"), ("webp", "WEBP")]:
            stream = io.BytesIO()
            Image.new("RGB", (18, 12), "#755aaa").save(stream, format=fmt)
            name = "assets/cover." + suffix
            patch = dict(self.doc, changes=[dict(op="cover", asset=name)])
            with self.subTest(fmt=fmt):
                result = inspect_changes(archive(patch, {name: stream.getvalue()}), self.event)
                self.assertTrue(result["candidate"]["cover"].startswith("data:image/"+fmt.lower()))
                with self.assertRaisesRegex(ValidationError, "缺少文件"):
                    inspect_changes(archive(patch), self.event)
                with self.assertRaises(ValidationError):
                    inspect_changes(archive(patch, {name: b"not an image"}), self.event)
        for files in [{"notes.txt": b"note"}, {"assets/cover.jpg": b"unused"}, {"assets/back/cover.png": b"x"}]:
            with self.subTest(names=files.keys()), self.assertRaises(ValidationError):
                inspect_changes(archive(self.doc, files), self.event)
        with self.assertRaises(ValidationError):
            validate_event(dict(self.event, cover="data:image/jpeg;base64," + base64.b64encode(b"invalid").decode()))
        with self.assertRaisesRegex(ValidationError, "超出"):
            inspect_changes(archive(self.doc, {"assets/large.png": b" " * (2 * 1024 * 1024 + 1)}), self.event)


if __name__ == "__main__":
    unittest.main()
