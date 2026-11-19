"""Interoperability regressions: stdlib ZIPs exchanged with the browser package module."""
import base64
import io
import json
from pathlib import Path
import subprocess
import unittest
import zipfile


ROOT = Path(__file__).resolve().parents[1]
NODE = """
global.window=global;
require('./packages.js');
(async()=>{
  const chunks=[];
  for await(const chunk of process.stdin) chunks.push(chunk);
  const input=JSON.parse(Buffer.concat(chunks));
  if(input.export){
    const blob=await EventPackages.export(input.event);
    process.stdout.write(Buffer.from(await blob.arrayBuffer()).toString('base64'));
    return;
  }
  const results=[];
  for(const file of input.files){
    try{
      const value=await EventPackages.inspect(new Blob([Buffer.from(file,'base64')]),input.event);
      results.push({ok:true,...value});
    }catch(error){results.push({ok:false,message:error.message});}
  }
  process.stdout.write(JSON.stringify({event:input.event,results}));
})().catch(err=>{console.error(err);process.exitCode=1});
"""


def run_node(payload):
    return subprocess.run(["node", "-e", NODE], cwd=ROOT, check=True, capture_output=True,
                          input=json.dumps(payload).encode()).stdout


def make_archive(doc, compress=True, extra=None, root="changes.json"):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED if compress else zipfile.ZIP_STORED) as zf:
        zf.writestr(root, json.dumps(doc, ensure_ascii=False))
        for name, content in (extra or {}).items():
            zf.writestr(name, content)
    return base64.b64encode(stream.getvalue()).decode()


class PackageContract(unittest.TestCase):
    def setUp(self):
        self.event = dict(id="test", version=3, status="live", title="交流日", date="2026-12-12",
                          place="上海", detail="欢迎参加", template="classic", theme="violet",
                          blocks=[dict(id="intro", type="text", title="交流", body="活动介绍")],
                          fields=[dict(key="company", label="企业", required=True)],
                          cover="", rows=["个人报名数据不应导出"])
        self.changes = dict(formatVersion=1, activityId="test", baseVersion=3, changes=[
            dict(op="set", field="date", value="2026-12-19"),
            dict(op="set", field="time", value="14:00"),
            dict(op="set", field="template", value="agenda"),
            dict(op="addField", field=dict(id="job", label="职位", required=False)),
            dict(op="addBlock", block=dict(id="schedule", type="agenda", title="议程", body="10:00 入场")),
            dict(op="reorderBlocks", ids=["schedule", "intro"]),
            dict(op="updateField", field=dict(id="company", label="企业名称", required=True)),
            dict(op="reorderFields", ids=["job", "company"]),
            dict(op="updateBlock", block=dict(id="intro", type="notice", title="提示", body="凭码入场")),
        ])

    def test_changes_round_trip_and_isolation(self):
        files = [make_archive(self.changes, compress=flag) for flag in (False, True)]
        remove = dict(self.changes, changes=[dict(op="addField", field=dict(id="job", label="岗位", required=False)),
                                               dict(op="removeField", id="company"), dict(op="removeBlock", id="intro")])
        files.append(make_archive(remove))
        response = json.loads(run_node(dict(files=files, event=self.event)))
        self.assertEqual(response["event"], self.event)
        first, second, third = response["results"]
        self.assertEqual(first, second)
        self.assertTrue(first["ok"], first)
        self.assertEqual(first["candidate"]["blocks"][0]["id"], "schedule")
        self.assertEqual(first["candidate"]["fields"][0]["key"], "job")
        self.assertEqual(first["candidate"]["version"], 3)
        self.assertEqual(first["candidate"]["status"], "live")
        self.assertEqual(first["candidate"]["template"], "agenda")
        self.assertEqual(first["candidate"]["time"], "14:00")
        self.assertIn({"label":"开始时间", "before":"", "after":"14:00"}, first["diffs"])
        self.assertEqual(len(first["diffs"]), 9)
        self.assertTrue(third["ok"], third)
        self.assertEqual(third["candidate"]["blocks"], [])
        self.assertEqual([f["key"] for f in third["candidate"]["fields"]], ["job"])

    def test_rejects_stale_wrong_target_invalid_data_and_assets(self):
        cases = [
            (make_archive(dict(self.changes, baseVersion=2)), "版本冲突"),
            (make_archive(dict(self.changes, activityId="other")), "目标活动"),
            (make_archive(dict(self.changes, formatVersion=2)), "格式版本"),
            (make_archive(dict(self.changes, records=[])), "未支持的字段"),
            (make_archive(dict(self.changes, changes=[dict(op="set", field="status", value="live")])), "不允许修改"),
            (make_archive(dict(self.changes, changes=[dict(op="removeField", id="company")])), "保留"),
            (make_archive(dict(self.changes, changes=[dict(op="set", field="date", value="2026-02-30")])), "日期无效"),
            (make_archive(dict(self.changes, changes=[dict(op="set", field="time", value="24:00")])), "开始时间"),
            (make_archive(dict(self.changes, changes=[dict(op="cover", asset="assets/cover.png")])), "缺少文件"),
            (make_archive(dict(self.changes, changes=[dict(op="cover", asset="assets/cover.png")]),
                          extra={"assets/cover.png": b"poster"}), "实际图片格式"),
            (make_archive(self.changes, extra={"assets/new.png": b"unused"}), "未被使用"),
            (make_archive(self.changes, extra={"notes.txt": "extra"}), "不支持的文件"),
            (make_archive(self.changes, root="manifest.json"), "系统导出的活动包"),
        ]
        response = json.loads(run_node(dict(event=self.event, files=[file for file, _ in cases])))
        for result, (_, match) in zip(response["results"], cases):
            self.assertFalse(result["ok"])
            self.assertIn(match, result["message"])

    def test_export_readable_by_standard_zip_library_and_minimal_data(self):
        # A transparent 1px PNG represents an uploaded cover in the test event.
        pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2poAAAAASUVORK5CYII="
        self.event["cover"] = "data:image/png;base64," + pixel
        data = base64.b64decode(run_node(dict(export=True, event=self.event)))
        with zipfile.ZipFile(io.BytesIO(data)) as pkg:
            self.assertIsNone(pkg.testzip())
            self.assertEqual(set(pkg.namelist()), {"manifest.json", "invitation.json", "form.json", "assets/cover.png"})
            self.assertEqual(json.loads(pkg.read("manifest.json")), {"formatVersion":1, "activityId":"test", "draftVersion":3})
            self.assertEqual(json.loads(pkg.read("form.json")), {"fields":[{"id":"company", "label":"企业", "required":True}]})
            self.assertNotIn("rows", json.loads(pkg.read("invitation.json")))
            self.assertEqual(json.loads(pkg.read("invitation.json"))["time"], "")
            self.assertEqual(pkg.read("assets/cover.png"), base64.b64decode(pixel))


if __name__ == "__main__":
    unittest.main()
