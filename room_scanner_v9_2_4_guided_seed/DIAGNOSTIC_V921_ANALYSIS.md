# Diagnostic analysis — v9.2.1 capture

This report contains only aggregate diagnostic findings used to build the v9.2.2 regression fixes. The uploaded diagnostic archive itself is not redistributed.

## Geometry acquired correctly

The capture contained:

- 50,993 surfels
- 4,978 surfels above the live verified threshold
- 2,772 stable surfels
- 50,118 surfels with RGB support
- 28 RGB-D map keyframes
- 214 depth frames / 56,210 fused depth points
- 2,688 path poses, 9.12 m tracked path
- 7 native XR planes

The sparse preview was therefore not caused by missing geometry.

## Preview selection bug

At the end of the diagnostic timeline the preview displayed only 226 splats although the realtime cap at governor L2 was 2,800 and 4,978 points were verified.

The old selector computed a stride from all ~51k surfels and applied that stride before the probability/reliability filter. In the diagnostic proportions this reduces a 4,978-point verified set to roughly 276 points before spatial balancing.

v9.2.2 reverses the order:

1. cheap probability/free-space/native checks;
2. accept stable/verified plus a small recent provisional set;
3. spatial+normal binning;
4. score within bins;
5. only then apply the realtime cap.

This should fill surfaces much more continuously while preserving the same cap on rendered instances.

## Final processing freeze

The phase-3 finalizer in v9.2.1 forced `updateSurfelState(..., full=true)` synchronously over the entire map. With ~51k surfels this meant up to many hundreds of thousands of map-frame reprojections plus local manifold searches before the browser could repaint the progress UI.

v9.2.2 uses a cooperative finalizer. It yields regularly to the browser, updates progress from actual surfel progress, cheaply accepts already-supported/native points, cheaply rejects obviously weak single-view points, and performs full reprojection/manifold checks only on ambiguous candidates.

In the 3,200-point diagnostic sample, 891 points (27.84%) already satisfy the new conservative `obviouslyWeak` shortcut. Extrapolated only as a workload estimate, this is roughly 14k points that do not need the expensive full validation pass on a map of this size.

## Semantic/object pipeline

The snapshot recorded 98 semantic keyframes but 0 neural inference frames and no objects. The realtime governor skipped semantic work 41 times. The backend was eventually reported ready, but readable frames were discarded when the governor was above L0 instead of being retained for a later safe packet gap.

There were also local-file 404s for the old packaged model filenames. The official split EfficientSAM-Ti files now use `efficientsam_ti_encoder.onnx` and `efficientsam_ti_decoder.onnx`.

v9.2.2 therefore:

- keeps high-quality semantic keyframes at governor L0-L2;
- runs at most one neural inference in a packet-safe window;
- defers rather than discards at L3;
- uses current EfficientSAM-Ti filenames and remote fallback URLs;
- tracks coarse compact RGB-D regions as explicitly lower-confidence object priors if no neural result exists;
- overlays those tracked regions on the live Gaussian cloud without an O(N) reassignment of every surfel.

## Audio and XR integrity

The diagnostic did not indicate an XR renderer failure: the scene continued to acquire path/depth and no geometry allocation drop was recorded. Audio calibration was valid and the snapshot already contained many accepted/usable RIRs. These observations were used to focus the fix on preview selection, semantic scheduling, and finalization rather than reducing the metric acquisition quality further.
