#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
echo "== JavaScript syntax =="
find js workers -type f -name '*.js' -print | sort | while IFS= read -r f; do node --check "$f"; done
echo "PASS javascript_syntax"
node tests/test_static.mjs
node tests/test_bootstrap_contract.mjs
node tests/test_wasm.mjs
node tests/test_camera.mjs
node tests/test_math.mjs
node tests/test_formats.mjs
node tests/test_http.mjs
node -e "JSON.parse(require('fs').readFileSync('manifest.webmanifest'));JSON.parse(require('fs').readFileSync('build_info.json'));console.log('PASS json_contracts')"
echo "ALL TESTS PASSED"
