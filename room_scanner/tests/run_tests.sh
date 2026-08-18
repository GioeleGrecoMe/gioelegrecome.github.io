#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
for file in js/*.js workers/*.js sw_v20_2_0.js; do
  node --check "$file"
done
node tests/run_tests.mjs
node tests/requirements_v20_2_0.mjs
node tests/requirements_v20_2_1.mjs
