#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
for f in js/*.js workers/*.js tests/*.mjs sw_v20_2_0.js; do node --check "$f" >/dev/null; done
node tests/dense_ray_v20_4_0.mjs
node tests/requirements_v20_4_0.mjs
printf '%s\n' 'PASS javascript_syntax_v20_4_0'
