"""Ensure the V10 page, build manifest and service-worker cache deploy together."""
import json
import re
from pathlib import Path


root = Path(__file__).resolve().parents[1]
html = (root / "room_scanner_v10.html").read_text()
sw = (root / "sw.js").read_text()
info = json.loads((root / "build_info.json").read_text())

build = re.search(r"const APP_BUILD='([^']+)'", html).group(1)
rev = re.search(r"const DEPLOY_REV='([^']+)'", html).group(1)

assert build == "v10.0.8-depth-preflight-raw-room"
assert info["appBuild"] == build == info["app_build"]
assert info["deployRev"] == rev == info["deploy_rev"]
assert f"const BUILD_REV='{rev}'" in sw
assert f"const CACHE='room-acoustic-v{rev}'" in sw
assert "'./room_scanner_v10.html'" in sw
assert "scan -> model -> frame-quality" in info["architecture"]
assert "SAM is not loaded or used by V10" in info["architecture"]

print({"status": "PASS", "app_build": build, "deploy_rev": rev, "service_worker": "versioned"})
