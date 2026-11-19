"""Assemble an EIM v1 change archive. Only Python's standard library is required."""
import argparse
import io
import json
from pathlib import Path
import zipfile


MIB = 1024 * 1024


def source_manifest(path):
    with zipfile.ZipFile(path) as archive:
        if archive.namelist().count("manifest.json") != 1:
            raise ValueError("活动包必须包含一个根目录 manifest.json")
        info = archive.getinfo("manifest.json")
        if info.file_size > 64 * 1024:
            raise ValueError("manifest.json 体积异常")
        manifest = json.loads(archive.read(info).decode("utf-8-sig"))
    if not isinstance(manifest, dict) or type(manifest.get("formatVersion")) is not int or manifest["formatVersion"] != 1:
        raise ValueError("仅支持 v1 活动包")
    if not isinstance(manifest.get("activityId"), str) or not manifest["activityId"].strip():
        raise ValueError("活动包缺少有效的 activityId")
    if type(manifest.get("draftVersion")) is not int or manifest["draftVersion"] < 1:
        raise ValueError("活动包缺少有效的 draftVersion")
    return manifest


def image_entry(path):
    if path.stat().st_size > 2 * MIB:
        raise ValueError("封面超过 2 MiB")
    data = path.read_bytes()
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        suffix = "png"
    elif data.startswith(b"\xff\xd8\xff"):
        suffix = "jpg"
    elif data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        suffix = "webp"
    else:
        raise ValueError("封面应使用 PNG、JPEG 或 WebP")
    return "assets/cover." + suffix, data


def create(source, operations, output, cover=None):
    manifest = source_manifest(source)
    changes = json.loads(operations.read_text(encoding="utf-8-sig"))
    if not isinstance(changes, list) or any(not isinstance(op, dict) or not isinstance(op.get("op"), str) for op in changes):
        raise ValueError("操作文件须为包含 op 的 JSON 对象数组")
    if any(op["op"] == "cover" for op in changes):
        raise ValueError("使用脚本生成封面操作时，请从操作数组中移除 cover，并用 --cover 提供图片")
    assets = {}
    if cover:
        name, data = image_entry(cover)
        assets[name] = data
        changes.append({"op": "cover", "asset": name})
    if not changes:
        raise ValueError("未提供修改内容")
    doc = {"formatVersion": 1, "activityId": manifest["activityId"], "baseVersion": manifest["draftVersion"], "changes": changes}
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("changes.json", json.dumps(doc, ensure_ascii=False, indent=2).encode("utf-8"))
        for name, data in assets.items():
            archive.writestr(name, data)
    if payload.tell() > 8 * MIB:
        raise ValueError("修改包超过 8 MiB")
    payload.seek(0)
    with zipfile.ZipFile(payload) as check:
        if check.testzip() or json.loads(check.read("changes.json")) != doc:
            raise ValueError("生成的 ZIP 校验失败")
    with output.open("xb") as dest:
        dest.write(payload.getvalue())
    print(f"{output}  ({len(changes)} 项修改，草稿版本 {manifest['draftVersion']})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("operations", type=Path)
    parser.add_argument("output", type=Path, help="使用新的输出路径")
    parser.add_argument("--cover", type=Path)
    args = parser.parse_args()
    try:
        create(args.source, args.operations, args.output, args.cover)
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        parser.exit(1, str(error) + "\n")
