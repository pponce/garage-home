"""Build an unsigned Garage Home widget for manual use. Requires Python 3.10+."""

import argparse
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILES = ("config.xml", "index.html", "style.css", "app.js", "qrcode.js", "app-icon.png", "logo.png")
NS = {"t": "http://tizen.org/ns/widgets", "w": "http://www.w3.org/ns/widgets"}


def validate_manifest(data):
    config = ET.fromstring(data)
    app = config.find("t:application", NS)
    if app is None or app.get("id") != "GarageHome.launcher":
        raise ValueError("Expected the selectable Garage Home app")
    if config.findall("t:service", NS):
        raise ValueError("A manual widget must not register a service")
    for element in config.iter():
        if element.get("on-boot") == "true" or element.get("auto-restart") == "true":
            raise ValueError("Automatic startup is not allowed")
        if any(word in element.get("key", "") for word in ("appbootingsupport", "prelaunch.support")):
            raise ValueError("Startup metadata is not allowed")
    if config.find("t:setting", NS).get("background-support") != "disable":
        raise ValueError("Background support must be disabled")
    return config


def build(output, tv_ip=""):
    source = ROOT / "launcher"
    config = validate_manifest((source / "config.xml").read_bytes())
    output.mkdir(parents=True, exist_ok=True)
    widget = output / ("GarageHome-manual-" + config.get("version") + "-unsigned.wgt")
    contents = {name: (source / name).read_bytes() for name in FILES}
    contents["index.html"] = contents["index.html"].replace(b'<script src="preview-apps.js"></script>\n', b"")
    contents["garage-config.js"] = ("window.GARAGE_CONFIG = " + json.dumps({"tvIp": tv_ip}) + ";\n").encode()
    with zipfile.ZipFile(widget, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, content in sorted(contents.items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, content)
    (output / "SHA256SUMS").write_text(hashlib.sha256(widget.read_bytes()).hexdigest() + "  " + widget.name + "\n")
    return widget


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    parser.add_argument("--tv-ip", default="", help="Optional fallback TV address for phone QR links")
    args = parser.parse_args()
    print(build(args.output, args.tv_ip))
