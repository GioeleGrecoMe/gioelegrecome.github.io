# Changelog V15.1.0 - Wall Targets + Recovery

Build: `v15.1.0-wall-targets-recovery-20260817`

## Coverage system replaced

- Removed the yaw-sector circle from the live workflow.
- Added metric wall targets generated after footprint and height confirmation.
- Split each wall into bounded horizontal columns and lower/upper bands.
- Added projected red/yellow/green quadrilaterals on the real wall surfaces.
- Added horizontal and vertical target arrows.
- Added per-target `FOTO n/m` and `ALTRA VISTA n/m` labels.
- A single keyframe can satisfy all qualifying visible targets.
- Duplicate photographs from the same view cluster do not advance a two-view target.
- All-green coverage is no longer required to complete a room; three frames from two positions are the hard minimum.
- Stored unresolved target counts in each room `captureSummary` and exposed them in Review.

## Navigation and persistence

- Added same-document browser-history guard during WebXR.
- Browser Back now invokes controlled `saveAndCloseXR()` instead of allowing an uncontrolled page/session teardown.
- Added active-capture settlement before XR shutdown.
- Added compact IndexedDB checkpoints and restoration from the landing page.
- Added checkpoint writes for rooms, frames, transitions, portals and object edits/removal/restoration.
- Unexpected XR end now preserves partial measured rooms and opens Review.

## Reliability and packaging

- Versioned all executable assets as V15.1.0.
- Updated network-first service worker cache version and critical-path matching.
- Added tests for target generation/projection, status transitions, completion without all-green coverage, browser Back recovery and IndexedDB restoration.
