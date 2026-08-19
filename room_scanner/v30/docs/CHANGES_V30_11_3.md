# V30.11.3 — full-screen measurement preview

## Symptom fixed
On some mobile browsers the metric-lock camera preview was visible only as a very thin strip at the top while the remainder of the screen stayed black.

## Changes
- Removed the unused full-screen `bridgeMap` canvas from the measurement screen.
- Replaced the full-screen measurement guidance canvas with compositor-safe DOM pin rings.
- `#bridge` and `#scan` are now unpadded, non-scrollable, viewport-sized camera stages.
- `#bridgeCamera` and `#camera` are explicitly sized to `100dvh` in CSS.
- `MetricBridge` also writes the current `visualViewport` dimensions in pixels to the video and host element. This avoids mobile percentage-height/dynamic-toolbar layout collapse.
- Preview dimensions are refreshed on normal and `visualViewport` resize events.
- Camera-start diagnostics now record viewport size, intrinsic video size and rendered video rectangle.
- The scan camera uses the same explicit viewport sizing after the metric stream handoff.

No calibration thresholds or metric-lock matching thresholds were changed in this release.
