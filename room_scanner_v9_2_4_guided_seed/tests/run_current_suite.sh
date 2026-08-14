#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
for t in \
  tests/test_v9_mapping.py \
  tests/test_v9_semantic_structural.py \
  tests/test_v9_virtual_array.py \
  tests/test_v924_seed_geometry_logic.py \
  tests/test_v951_geometry_pruning.py \
  tests/test_v951_mobilesam_browser.py \
  tests/test_v951_bootstrap_regression.py \
  tests/test_v951_hotfix2_step3_finalviewer.py \
  tests/test_v951_hotfix3_depthai.py \
  tests/test_v951_hotfix4_model_gaussian.py \
  tests/test_v951_hotfix5_deploy_integrity.py \
  tests/test_v951_hotfix5_warm_ai.py \
  tests/test_v951_compact_object_material.py \
  tests/test_v951_model_metadata.py \
  tests/test_v951_hotfix5w2_ort_metadata.py \
  tests/test_deep_audit_v951.py
do
  echo "=== $t"
  python3 "$t"
done
echo "=== tests/test_depthai_metric_alignment.js"
node tests/test_depthai_metric_alignment.js
echo "=== tests/test_depthai_worker_shape.js"
node tests/test_depthai_worker_shape.js

python3 tests/test_v951_hotfix5w3_decoder_contract.py
