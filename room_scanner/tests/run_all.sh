#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
node --check "$ROOT/roomscan_core.js"
node --check "$ROOT/roomscan_app.js"
node --check "$ROOT/depth_ai_worker.js"
node --check "$ROOT/sw.js"
node "$ROOT/tests/core_geometry.test.js"
node "$ROOT/tests/depth_fit.test.js"
node "$ROOT/tests/object_voxels.test.js"
node "$ROOT/tests/deep_worker_contract.test.js"
node "$ROOT/tests/static_contract.test.js"
node "$ROOT/tests/bootstrap.test.js"
node "$ROOT/tests/workflow_state.test.js"
node "$ROOT/tests/http_smoke.test.js"
python3 -m json.tool "$ROOT/manifest.webmanifest" >/dev/null
printf '%s\n' 'PASS manifest_json'
python3 -m json.tool "$ROOT/build_info.json" >/dev/null
printf '%s\n' 'PASS build_info_json'
printf '%s\n' 'ALL TESTS PASSED'
