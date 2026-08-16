#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

python3 tests/test_v10_geometry_journey.py
python3 tests/test_v10_deploy_contract.py
python3 tests/test_v9_mapping.py
python3 tests/test_v9_semantic_structural.py
python3 tests/test_v9_virtual_array.py
node tests/test_depthai_worker_shape.js
node tests/test_depthai_metric_alignment.js
awk '/<script type="module">/{p=1;next} p&&/<\/script>/{exit} p{print}' room_scanner_v10.html | node --input-type=module --check
python3 tools/check_deploy_bundle.py
