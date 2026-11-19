"""Validation and review for EIM activity documents and v1 amendment ZIPs."""
import base64
import binascii
import copy
from datetime import date, datetime
import io
import json
import re
import stat
import zipfile
import zlib
from urllib.parse import urlsplit

from PIL import Image


MIB = 1024 * 1024
MAX_ARCHIVE = 8 * MIB
MAX_IMAGE = 2 * MIB
MAX_JSON = 256 * 1024
MAX_PIXELS = 16_777_216
SCALARS = {"title": "活动标题", "date": "活动日期", "time": "开始时间", "place": "活动地点",
           "detail": "活动介绍", "template": "内容模板"}
TEMPLATES = {"classic": "经典邀请", "agenda": "议程导览", "editorial": "海报特刊",
             "summit": "大会邀请", "salon": "私享会邀请", "invitation": "邀请函"}
STORY_PAGES = ("cover", "letter", "highlights", "organizers", "about", "agenda", "location", "rsvp", "follow")
BLOCK_TYPES = {"text": "正文", "agenda": "议程", "notice": "须知"}
THEMES = ("violet", "orange", "teal")
IMAGE_FORMATS = {"png": "PNG", "jpg": "JPEG", "jpeg": "JPEG", "webp": "WEBP"}
IMAGE_PATH = re.compile(r"assets/[A-Za-z0-9][A-Za-z0-9_-]{0,71}\.(png|jpe?g|webp)", re.ASCII | re.I)
ID_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,63}")
RESERVED = {"constructor", "prototype", "toString", "valueOf", "toLocaleString", "hasOwnProperty",
            "isPrototypeOf", "propertyIsEnumerable", "elements", "submit", "reset", "action",
            "method", "target", "length"}
CONTROLS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff]")
EVENT_KEYS = {"id", "version", "status", "title", "theme", "template", "date", "time",
              "place", "detail", "blocks", "fields", "cover"}


class ValidationError(ValueError):
    """A submitted draft or modification violates the v1 contract."""


class VersionConflict(ValidationError):
    """An amendment belongs to a different revision of this activity."""


def require(condition, message):
    if not condition:
        raise ValidationError(message)


def shape(obj, keys, label):
    require(isinstance(obj, dict) and obj.keys() == set(keys), f"{label}包含缺失或未支持的字段。")


def text(value, limit, label, required=False):
    require(isinstance(value, str) and len(value) <= limit and not CONTROLS.search(value)
            and len(value.encode("utf-16-le")) <= 2 * limit and (not required or value.strip()),
            f"{label}为空、过长或含有无效字符。")


def identifier(value):
    require(isinstance(value, str) and ID_PATTERN.fullmatch(value) and value not in RESERVED,
            "活动、字段或区块 ID 无效。")


def scalar(name, value):
    require(isinstance(name, str) and name in SCALARS, "不允许修改此活动属性。")
    if name == "date" and value != "":
        require(isinstance(value, str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value),
                "日期应为 YYYY-MM-DD。")
        try:
            date.fromisoformat(value)
        except ValueError as exc:
            raise ValidationError("日期无效。") from exc
    elif name == "time" and value != "":
        require(isinstance(value, str) and re.fullmatch(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", value),
                "开始时间应为 24 小时制 HH:mm。")
    elif name == "template":
        require(isinstance(value, str) and value in TEMPLATES, "未知内容模板。")
    else:
        text(value, 2000 if name == "detail" else 100, SCALARS[name], required=name == "title")


def field_entry(field, id_key):
    shape(field, (id_key, "label", "required"), "报名字段")
    identifier(field[id_key])
    text(field["label"], 30, "字段名称", required=True)
    require(type(field["required"]) is bool, "报名字段 required 应为布尔值。")


def block_entry(block):
    shape(block, ("id", "type", "title", "body"), "页面区块")
    identifier(block["id"])
    require(isinstance(block["type"], str) and block["type"] in BLOCK_TYPES, "不支持的页面区块类型。")
    text(block["title"], 100, "区块标题", required=True)
    text(block["body"], 2000, "区块正文")


def validate_image(data, expected_format):
    require(0 < len(data) <= MAX_IMAGE, "海报图片须在 2 MiB 以内。")
    try:
        with Image.open(io.BytesIO(data), formats=[expected_format]) as image:
            width, height = image.size
            require(max(width, height) <= 8192 and width * height <= MAX_PIXELS, "海报像素尺寸过大。")
            image.verify()
        # verify() checks file structure; loading also checks the actual compressed image data.
        with Image.open(io.BytesIO(data), formats=[expected_format]) as image:
            for frame in range(getattr(image, "n_frames", 1)):
                require(frame < 250 and (frame + 1) * width * height <= MAX_PIXELS,
                        "动画海报解码后超出大小限制。")
                image.seek(frame)
                image.load()
    except ValidationError:
        raise
    except (OSError, ValueError, SyntaxError, EOFError, Image.DecompressionBombError) as exc:
        raise ValidationError("海报格式不匹配或无法解码，请使用有效的 PNG、JPEG 或 WebP。") from exc


def validate_cover(value, size_limit=MAX_IMAGE):
    if value == "":
        return 0
    require(isinstance(value, str) and len(value) <= ((size_limit + 2) // 3) * 4 + 32,
            f"图片内容无效或超过 {size_limit // 1024} KiB。")
    header, separator, encoded = value.partition(",")
    match = re.fullmatch(r"data:image/(png|jpeg|webp);base64", header)
    require(separator and match, "海报仅支持 PNG、JPEG 或 WebP 图片数据。")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValidationError("海报图片编码无效。") from exc
    require(len(raw) <= size_limit, f"图片超过 {size_limit // 1024} KiB。")
    validate_image(raw, IMAGE_FORMATS[match[1]])
    return len(raw)


def http_link(link):
    text(link, 2048, "页面链接")
    if not link:
        return
    try:
        url = urlsplit(link)
        valid = url.scheme in ("http", "https") and url.hostname and url.username is None
        if valid:
            _ = url.port  # urlsplit parses and validates the port lazily.
    except ValueError:
        valid = False
    require(valid and not re.search(r"[\s\\]", link), "页面链接须为完整的 HTTP 或 HTTPS 地址。")


def validate_story(story):
    shape(story, ("accent", "background", "font", "pages", "mapUrl", "followUrl", "followImage"), "逐屏邀请函")
    for key in ("accent", "background"):
        require(isinstance(story[key], str) and re.fullmatch(r"#[a-fA-F0-9]{6}", story[key]), "主题颜色无效。")
    require(story["font"] in ("sans", "serif"), "字体样式无效。")
    pages = story["pages"]
    require(isinstance(pages, list) and 2 <= len(pages) <= len(STORY_PAGES), "邀请函须有 2 至 9 屏。")
    types = []
    for page in pages:
        shape(page, ("type", "title", "body"), "邀请函页面")
        require(page["type"] in STORY_PAGES and page["type"] not in types, "页面类型重复或不受支持。")
        types.append(page["type"])
        text(page["title"], 100, "页面标题", required=True)
        text(page["body"], 2000, "页面正文")
    require(types[0] == "cover" and "rsvp" in types, "封面须为第一屏，邀请函须保留报名页。")
    for key in ("mapUrl", "followUrl"):
        http_link(story[key])
    validate_cover(story["followImage"], 512 * 1024)


def validate_unique_fields(rules, fields):
    shape(rules, ("phone", "wechat"), "报名去重规则")
    field_keys = [field["key"] for field in fields]
    for key in rules.values():
        require(isinstance(key, str) and (not key or key in field_keys), "去重规则须选择现有报名字段。")
    require(not rules["phone"] or rules["phone"] != rules["wechat"], "手机号和微信号须使用不同的字段。")


def color(value, allow_transparent=False):
    require(isinstance(value, str) and (re.fullmatch(r"#[0-9a-fA-F]{6}", value)
            or (allow_transparent and value == "transparent")), "组件或页面颜色无效。")


def validate_design_component(item):
    shape(item, ("id", "type", "x", "y", "w", "h", "content", "style", "animation"), "组件")
    identifier(item["id"])
    for key in ("x", "y", "w", "h"):
        value = item[key]
        require(type(value) in (int, float) and 0 <= value <= 100, "组件坐标或尺寸无效。")
    require(item["w"] > 0 and item["h"] > 0 and item["x"] + item["w"] <= 100.00001
            and item["y"] + item["h"] <= 100.00001, "组件须在画布范围内。")

    style = item["style"]
    style_keys = {"color", "background", "fontSize", "align", "bold", "radius"}
    if isinstance(style, dict) and "font" in style:
        style_keys.add("font")
        require(style["font"] in ("sans", "serif"), "组件字体无效。")
    shape(style, style_keys, "组件样式")
    color(style["color"])
    color(style["background"], allow_transparent=True)
    require(style["align"] in ("left", "center", "right") and type(style["bold"]) is bool, "文字样式无效。")
    require(type(style["fontSize"]) in (int, float) and 8 <= style["fontSize"] <= 120, "字号须在 8 到 120 范围内。")
    require(type(style["radius"]) in (int, float) and 0 <= style["radius"] <= 128, "圆角须在 0 到 128 范围内。")
    animation = item["animation"]
    shape(animation, ("type", "duration", "delay"), "组件入场动画")
    require(animation["type"] in ("none", "fade", "rise", "zoom", "slide"), "未知组件入场动画。")
    for key in ("duration", "delay"):
        require(type(animation[key]) is int and 0 <= animation[key] <= 5000, "动画时间须在 0 到 5000 毫秒之间。")

    kind, content = item["type"], item["content"]
    if kind in ("title", "paragraph", "textbox"):
        shape(content, ("text",), "文字组件")
        text(content["text"], 8000, "文字组件")
    elif kind == "image":
        shape(content, ("src", "alt", "fit"), "图片组件")
        text(content["alt"], 200, "图片描述")
        require(content["fit"] in ("cover", "contain"), "图片显示方式无效。")
        if content["src"] != "@cover":
            return validate_cover(content["src"])
    elif kind == "table":
        if isinstance(content, dict) and "lines" in content:
            shape(content, ("rows", "lines"), "表格")
            require(content["lines"] in ("grid", "ruled"), "表格线样式无效。")
        else:
            shape(content, ("rows",), "表格")
        rows = content["rows"]
        require(isinstance(rows, list) and 1 <= len(rows) <= 50, "表格须有 1 至 50 行。")
        require(isinstance(rows[0], list) and 1 <= len(rows[0]) <= 12, "表格须有 1 至 12 列。")
        for row in rows:
            require(isinstance(row, list) and len(row) == len(rows[0]), "表格各行的列数须相同。")
            for cell in row:
                text(cell, 2000, "单元格")
    elif kind == "divider":
        shape(content, (), "分割线")
    elif kind == "button":
        shape(content, ("text", "action", "url"), "按钮")
        text(content["text"], 200, "按钮文字")
        require(content["action"] in ("register", "inline-register", "link"), "按钮动作无效。")
        http_link(content["url"])
    else:
        raise ValidationError("未知邀请函组件类型。")
    return 0


def validate_design(design, cover_bytes):
    shape(design, ("pages",), "邀请函设计")
    pages = design["pages"]
    require(isinstance(pages, list) and 1 <= len(pages) <= 80, "邀请函须有 1 至 80 页。")
    page_ids, count, image_bytes = set(), 0, cover_bytes
    for page in pages:
        shape(page, ("id", "name", "background", "transition", "elements"), "设计页面")
        identifier(page["id"])
        require(page["id"] not in page_ids, "设计页面 ID 重复。")
        page_ids.add(page["id"])
        text(page["name"], 100, "页面名称", required=True)
        color(page["background"])
        require(page["transition"] in ("slide", "fade", "zoom", "none"), "未知页面切换动画。")
        elements = page["elements"]
        require(isinstance(elements, list) and len(elements) <= 64, "每页最多支持 64 个组件。")
        count += len(elements)
        require(count <= 1200, "邀请函最多支持 1200 个组件。")
        ids = set()
        for item in elements:
            image_bytes += validate_design_component(item)
            require(image_bytes <= 8 * MIB, "封面与组件图片合计超过 8 MiB。")
            require(item["id"] not in ids, "同页组件 ID 重复。")
            ids.add(item["id"])


def validate_registration_schedule(schedule):
    shape(schedule, ("start", "end"), "报名时间")
    for key, label in (("start", "报名开始时间"), ("end", "报名截止时间")):
        value = schedule[key]
        if value == "":
            continue
        require(isinstance(value, str) and re.fullmatch(
            r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}", value), f"{label}格式无效。")
        try:
            datetime.fromisoformat(value)
        except ValueError as exc:
            raise ValidationError(f"{label}无效。") from exc
    require(not schedule["start"] or not schedule["end"] or schedule["start"] < schedule["end"],
            "报名截止时间须晚于开始时间。")


def validate_event(event):
    """Validate a draft without changing its data or requiring newer optional features."""
    optional = {"time", "story", "registrationUnique", "registrationSchedule", "design"}
    keys = (EVENT_KEYS - {"time"}) | (optional.intersection(event) if isinstance(event, dict) else set())
    shape(event, keys, "活动")
    identifier(event["id"])
    require(type(event["version"]) is int and 0 <= event["version"] <= 2**53 - 1, "草稿版本无效。")
    require(event["status"] in ("draft", "live", "ended"), "活动状态无效。")
    require(event["theme"] in THEMES, "未知海报样式。")
    for name in SCALARS:
        scalar(name, event.get(name, ""))
    fields, blocks = event["fields"], event["blocks"]
    require(isinstance(fields, list) and 1 <= len(fields) <= 30, "活动须保留 1 至 30 个报名字段。")
    require(isinstance(blocks, list) and len(blocks) <= 30, "每场活动最多支持 30 个区块。")
    for field in fields:
        field_entry(field, "key")
    for block in blocks:
        block_entry(block)
    require(len({f["key"] for f in fields}) == len(fields) and
            len({f["label"].strip() for f in fields}) == len(fields), "报名字段 ID 或名称重复。")
    require(len({b["id"] for b in blocks}) == len(blocks), "页面区块 ID 重复。")
    if "story" in event:
        validate_story(event["story"])
    if "registrationUnique" in event:
        validate_unique_fields(event["registrationUnique"], fields)
    if "registrationSchedule" in event:
        validate_registration_schedule(event["registrationSchedule"])
    cover_bytes = validate_cover(event["cover"])
    if "design" in event:
        require(event["template"] == "invitation", "组件设计须使用邀请函模板。")
        validate_design(event["design"], cover_bytes)


def archive_files(raw):
    require(isinstance(raw, (bytes, bytearray)) and 22 <= len(raw) <= MAX_ARCHIVE,
            "请选择 8 MiB 以内的修改稿 ZIP。")
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            require(0 < len(zf.infolist()) <= 24, "修改包文件数量超限。")
            files = {}
            expanded = 0
            for info in zf.infolist():
                name = info.orig_filename
                require(name != "manifest.json", "请选择修改稿 ZIP，而非系统导出的活动包。")
                require(name == info.filename and (name in ("changes.json", "assets/") or IMAGE_PATH.fullmatch(name)),
                        "修改包包含未支持的文件或路径。")
                require(name not in files, "修改包包含重复的文件名。")
                require(info.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED) and
                        not info.flag_bits & ~0x80e and not stat.S_ISLNK(info.external_attr >> 16),
                        "仅支持普通存储或 Deflate 压缩的未加密文件。")
                limit = MAX_JSON if name == "changes.json" else (0 if name == "assets/" else MAX_IMAGE)
                expanded += info.file_size
                require(info.file_size <= limit and expanded <= MAX_ARCHIVE, "修改包解压后超出大小限制。")
                with zf.open(info) as member:
                    contents = member.read(limit + 1)
                require(len(contents) == info.file_size, "ZIP 文件大小不符。")
                files[name] = contents
            return files
    except (OSError, zipfile.BadZipFile, EOFError, zlib.error, NotImplementedError, UnicodeError) as exc:
        raise ValidationError("修改包 ZIP 无法读取或已损坏。") from exc


def json_object(pairs):
    obj = dict(pairs)
    require(len(obj) == len(pairs), "JSON 包含重复字段。")
    return obj


def change_collection(event, operation, action, is_field):
    prop, collection, key = ("field", "fields", "key") if is_field else ("block", "blocks", "id")
    items = event[collection]
    by_id = {item[key]: item for item in items}
    if action == "reorder":
        shape(operation, ("op", "ids"), "排序操作")
        ids = operation["ids"]
        require(isinstance(ids, list) and len(ids) == len(items) and all(isinstance(x, str) for x in ids)
                and set(ids) == set(by_id), "排序须完整列出现有 ID 各一次。")
        event[collection] = [by_id[item_id] for item_id in ids]
        return
    if action == "remove":
        shape(operation, ("op", "id"), "移除操作")
        identifier(operation["id"])
        require(operation["id"] in by_id, "要移除的 ID 不存在。")
        items.remove(by_id[operation["id"]])
        return
    shape(operation, ("op", prop), "修改操作")
    value = operation[prop]
    if is_field:
        field_entry(value, "id")
        entry = {"key": value["id"], "label": value["label"], "required": value["required"]}
    else:
        block_entry(value)
        entry = value.copy()
    previous = by_id.get(entry[key])
    if action == "add":
        require(previous is None, "新增 ID 已经存在。")
        items.append(entry)
    else:
        require(previous is not None, "要修改的 ID 不存在。")
        items[items.index(previous)] = entry


def differences(before, after):
    changes = []

    def add(label, old, new):
        changes.append({"label": label, "before": old, "after": new})

    for key, label in SCALARS.items():
        old, new = before.get(key, ""), after.get(key, "")
        if old != new:
            add(label, TEMPLATES[old] if key == "template" else old, TEMPLATES[new] if key == "template" else new)
    if before["cover"] != after["cover"]:
        add("封面已替换", "原海报" if before["cover"] else "模板海报", "新海报")
    for group, id_key, label in (("fields", "key", "报名字段"), ("blocks", "id", "页面区块")):
        old = {x[id_key]: x for x in before[group]}
        new = {x[id_key]: x for x in after[group]}

        def description(item):
            if group == "fields":
                return item["label"] + ("（必填）" if item["required"] else "（选填）")
            return f"[{BLOCK_TYPES[item['type']]}] {item['title']}\n{item['body']}"

        for item_id, item in old.items():
            if item_id not in new:
                add("移除" + label, description(item), "已移除")
        for item_id, item in new.items():
            if item_id not in old:
                add("新增" + label, "无", description(item))
            elif old[item_id] != item:
                add("修改" + label, description(old[item_id]), description(item))
        expected = [i for i in old if i in new] + [i for i in new if i not in old]
        if expected != list(new):
            title_key = "label" if group == "fields" else "title"
            add(label + "顺序", " → ".join(i[title_key] for i in old.values()),
                " → ".join(i[title_key] for i in new.values()))
    return changes


def inspect_changes(raw_zip, event):
    """Build a candidate from the current server draft and the submitted ZIP. No writes."""
    files = archive_files(raw_zip)
    require("changes.json" in files, "修改包缺少根目录 changes.json。")
    try:
        document = json.loads(files["changes.json"].decode("utf-8"), object_pairs_hook=json_object)
    except ValidationError:
        raise
    except (ValueError, RecursionError) as exc:
        raise ValidationError("changes.json 不是有效的 UTF-8 JSON。") from exc
    shape(document, ("formatVersion", "activityId", "baseVersion", "changes"), "changes.json")
    require(type(document["formatVersion"]) is int and document["formatVersion"] == 1, "修改包格式版本须为 1。")
    require(document["activityId"] == event["id"], "目标活动不匹配，请从当前活动重新导出。")
    require(type(document["baseVersion"]) is int and document["baseVersion"] > 0, "草稿版本无效。")
    if document["baseVersion"] != event["version"]:
        raise VersionConflict("草稿版本冲突，请重新导出最新活动包，再让 AI 生成修改稿。")
    operations = document["changes"]
    require(isinstance(operations, list) and 1 <= len(operations) <= 150, "修改稿须包含 1 至 150 项操作。")
    candidate = copy.deepcopy(event)
    candidate.setdefault("time", "")
    used = {"changes.json", "assets/"}
    for op in operations:
        require(isinstance(op, dict) and isinstance(op.get("op"), str), "修改操作格式无效。")
        code = op["op"]
        if code == "set":
            shape(op, ("op", "field", "value"), "set 操作")
            scalar(op["field"], op["value"])
            candidate[op["field"]] = op["value"]
        elif code == "cover":
            shape(op, ("op", "asset"), "封面操作")
            name = op["asset"]
            match = IMAGE_PATH.fullmatch(name) if isinstance(name, str) else None
            require(match, "海报路径无效。")
            require(len(used) == 2, "每份修改包仅可替换一张封面。")
            require(name in files, f"修改包缺少文件：{name}")
            mime = IMAGE_FORMATS[match[1].lower()].lower()
            candidate["cover"] = f"data:image/{mime};base64," + base64.b64encode(files[name]).decode("ascii")
            used.add(name)
        else:
            action = re.fullmatch(r"(add|update|remove)(Field|Block)|(?:(reorder)(Field|Block)s)", code)
            require(action, "不支持的修改操作。")
            change_collection(candidate, op, action[1] or action[3], (action[2] or action[4]) == "Field")
    require(not files.keys() - used, "修改包包含未被使用的文件。")
    validate_event(candidate)
    diffs = differences(event, candidate)
    require(diffs, "修改稿与当前草稿完全相同。")
    return {"candidate": candidate, "diffs": diffs, "baseVersion": event["version"]}
