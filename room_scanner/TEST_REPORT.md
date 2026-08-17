# Test report - Room Scanner V15.1.0

Revision: `v15.1.0-wall-targets-recovery-20260817`
Date: 2026-08-17

## Automated suite

Command:

```sh
sh tests/run_all.sh
```

Result:

```text
PASS core_geometry
PASS photo_targets
PASS depth_fit
PASS object_voxels
PASS deep_worker_contract
PASS static_contract
PASS bootstrap
PASS workflow_state
PASS completion_guard
PASS coverage_guidance
PASS overlay_render
PASS navigation_recovery
PASS checkpoint_recovery
PASS http_smoke
PASS manifest_json
PASS build_info_json
ALL TESTS PASSED
```

## Covered behaviors

- measured footprint/model geometry;
- wall target subdivision and camera projection;
- red/yellow/green status using distinct spatial views;
- projected wall-target overlay rendering, counts and selected photo state;
- no all-green completion deadlock;
- capture/completion race guard;
- connected-room/portal workflow;
- Back-controlled XR shutdown and Review opening;
- IndexedDB checkpoint save and restore;
- object voxel persistence and Deep worker tensor contracts;
- one XR request, one Raw Camera call site and no second camera API;
- versioned assets, network-first service worker and HTTP delivery.

## Not validated in this environment

- physical Chrome Android/ARCore session;
- real Raw Camera texture reading;
- real CPU depth semantics and coverage;
- Android system Back animation/timing;
- hardware thermal/memory behavior during ONNX inference;
- metric error against tape or laser measurements.

These require `TEST_ON_PHONE.md`.
