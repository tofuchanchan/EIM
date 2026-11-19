"""Build a standalone HTML file with the current workspace styles and scripts."""
import argparse
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]


def build(output):
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    html = re.sub(r'<link rel="stylesheet" href="([\w.-]+)">',
                  lambda m: "<style>" + (ROOT / m[1]).read_text(encoding="utf-8") + "</style>", html)
    scripts = []
    for filename in re.findall(r'<script defer src="([\w.-]+)"></script>', html):
        body = (ROOT / filename).read_text(encoding="utf-8")
        scripts.append("<script>" + body.replace("</script", "<\\/script") + "</script>")
    html = re.sub(r'<script defer src="([\w.-]+)"></script>', "", html)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html.replace("</body>", "\n".join(scripts) + "\n</body>"), encoding="utf-8")
    print(f"{output} ({output.stat().st_size} bytes)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    build(parser.parse_args().output)
