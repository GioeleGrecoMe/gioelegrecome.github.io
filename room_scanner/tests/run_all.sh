#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

# Syntax-check every executable source shipped by the package. Both canonical
# aliases and versioned files are checked because GitHub Pages may serve either
# path during an update or an offline recovery.
for file in \
  roomscan_core.js roomscan_core_v20_1_0.js \
  roomscan_signal.js roomscan_signal_v20_1_0.js \
  roomscan_geometry.js roomscan_geometry_v20_1_0.js \
  roomscan_acoustics.js roomscan_acoustics_v20_1_0.js \
  roomscan_audio.js roomscan_audio_v20_1_0.js \
  roomscan_audio_worklet.js roomscan_audio_worklet_v20_1_0.js \
  roomscan_diagnostics.js roomscan_diagnostics_v20_1_0.js \
  roomscan_app.js roomscan_app_v20_1_0.js \
  depth_ai_worker.js depth_ai_worker_v20_1_0.js \
  sw.js sw_v20_1_0.js
 do
  node --check "$ROOT/$file"
 done
printf '%s\n' 'PASS javascript_syntax'

# Numerical modules first, then application integration and delivery checks.
for test in \
  core_geometry.test.js \
  close_geometry_v20.test.js \
  photo_targets.test.js \
  depth_fit.test.js \
  deep_metric_scaling.test.js \
  geometry_hybrid_fit.test.js \
  object_voxels.test.js \
  rgb_object_points.test.js \
  acoustic_surfaces.test.js \
  signal_rir_latency.test.js \
  audio_serialization.test.js \
  audio_compatibility.test.js \
  acoustic_association.test.js \
  deep_worker_contract.test.js \
  bootstrap.test.js \
  workflow_state.test.js \
  completion_guard.test.js \
  coverage_guidance.test.js \
  overlay_render.test.js \
  checkpoint_clone.test.js \
  post_xr_cleanup.test.js \
  navigation_recovery.test.js \
  checkpoint_recovery.test.js \
  app_rir_pipeline.test.js \
  diagnostics_export.test.js \
  static_contract.test.js \
  http_smoke.test.js
 do
  node "$ROOT/tests/$test"
 done

python3 -m json.tool "$ROOT/manifest.webmanifest" >/dev/null
printf '%s\n' 'PASS manifest_json'
python3 -m json.tool "$ROOT/build_info.json" >/dev/null
printf '%s\n' 'PASS build_info_json'
printf '%s\n' 'ALL TESTS PASSED'
