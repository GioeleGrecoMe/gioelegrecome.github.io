#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
find "$ROOT/js" "$ROOT/workers" -name '*.js' -type f | while read -r f; do node --check "$f" >/dev/null; done
node --check "$ROOT/sw.js" >/dev/null
echo 'PASS javascript_syntax'
node "$ROOT/tests/test_wasm_frontend.mjs"
node "$ROOT/tests/test_wasm_pnp.mjs"
node "$ROOT/tests/test_depth_calibration.mjs"
node "$ROOT/tests/test_static.mjs"
python3 "$ROOT/tests/test_http.py"
python3 - <<PY
import json, pathlib
root=pathlib.Path(r"$ROOT")
json.loads((root/'manifest.webmanifest').read_text())
json.loads((root/'build_info.json').read_text())
print('PASS json_contracts')
PY
printf 'ALL TESTS PASSED\n'
