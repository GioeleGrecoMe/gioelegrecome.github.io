# V30.41 validation report

Date: 2026-08-21

## Real failure fixture

The supplied V30.40 diagnostic confirms that the single optimizer was operational: 117 graph frames, 1379 landmarks, 52 Deep frames and 6476 MVS samples, with 23 accepted states. The accepted state reached ~0.99 px robust reprojection RMSE even though raw RMSE remained ~25.65 px because of gross outliers.

The supplied exported PLY was independently parsed and measured with `tools/analyze_ply_mesh.mjs`:

- 1443 vertices
- 1362 faces
- 133 connected components
- largest component: 60 vertices (~4.2%)
- fragmentation score: ~0.958
- status: `fragmented`

This fixture motivated the dense-surface corrections rather than another optimizer-gate retune.

## Dedicated V30.41 regression family

14/14 PASS. It verifies:

- Alva switches initialize from actual tracker confidence and legacy unit switches are repaired;
- a synthetic local Alva translation jump is falsified by RGB geometry without unnecessarily suppressing rotation authority;
- inverse-depth calibration error is dimensionless and stable under a global scale gauge change;
- committed rebuild recalibrates Depth across all current graph frames;
- sparse RGB landmarks cannot manufacture TSDF islands;
- dense evidence across multiple submaps is remeshed into one coherent global surface;
- two nearby parallel surfaces remain two layers with no phantom average sheet;
- an intentionally many-island mesh is detected as fragmented;
- MVS normals are stored camera-local;
- accepted local-window snapshots merge by persistent IDs rather than forgetting earlier accepted state;
- a commit-frame mask excludes raw/unaccepted pose frames from final dense geometry;
- local Depth updates freeze their normalization domain while the full commit may estimate a fresh global domain;
- opposite normal signs on one physical plane do not split the plane;
- perpendicular wall/floor layers weld into one connected corner with zero degenerate faces.

## Full automated suite

`npm test`: 193 total, 192 PASS, 1 FAIL.

The sole failure is the existing filesystem assertion for `models/model_q4.onnx`. The development/patch tree intentionally contains no `models/` directory. No optimizer, surface, boot, panorama, Alva, Depth or mesh regression failed.

## Project checks

- `npm run check:public`: PASS
- `npm run check:depth`: PASS
- `npm run check:layout`: PASS (249 files in the full work tree)
- `npm run check:deps`: PASS (51 local references resolved)
- `npm run check:constructors`: PASS (5/5)
- `npm run check:mock`: PASS
- `npm run check:alva`: PASS

Public TUM RGB-D fixture:

- 85 / 86 correct visual matches
- precision 0.9883720930
- recall 1.0
- factor reprojection: 2.2912042940 px -> 0.0306215231 px
- mean pose correction ~0.009718 m
- 6 / 6 photo frames connected
- 15 photo edges
- 6 loops
- live photo coverage 0.51
- live depth coverage 0.51419921875

## Surface stress test

A synthetic smooth surface with ~14k confirmed surfels was globally layered and meshed in ~1.3 s on the development container, producing one connected component and no fragmentation. A second regression with perpendicular wall/floor layers verifies that separate TSDF layers weld into one topological corner rather than remaining disconnected.

The user-supplied PLY and diagnostic are used only as external regression fixtures during development and are not included in the patch archive.
