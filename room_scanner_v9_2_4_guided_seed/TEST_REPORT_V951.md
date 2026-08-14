# Test report - Room Scanner v9.5.1

## Result

All current regression tests pass.

## Geometry

- Independent-view probability cap: PASS.
- One-view repeated hit evidence cannot exceed the one-view cap.
- Three independent supported views produce stable-level probability in the synthetic regression.
- Young mono-view surfels survive until they have a fair revisit opportunity.
- Stale unsupported mono-view surfels are removable online.
- Online maintenance runs at keyframe boundaries, in bounded realtime slices, and in chirp-packet safe windows.
- Final processing is cooperative residual validation rather than the first full cleanup.

## Semantic/object pipeline

- Active semantic backend: MobileSAM split encoder/decoder ONNX.
- No PicoSAM or EfficientSAM production path remains.
- One model-upload handler only.
- Metric reticle readiness uses local voxel evidence and does not scan the whole surfel map.
- Minimum multi-view object capture: 3 independent views for ordinary objects.
- Compact oriented proxy is generated and rendered in place of dense object surfels.
- Temporary RGB/mask/point buffers are explicitly released after proxy finalization.
- Raw object images/masks are not retained in the compact export.
- Manual boundaries and continuous floor/ceiling plane workflows are present.

## Acoustic/material prior

- Material prior confidence is capped at 0.28 for automatic visual inference.
- Manual material labels remain priors, not measurements.
- Acoustic prior provenance explicitly states that reliable measured RIR evidence overrides it.
- Compact oriented proxy faces are exported as simulator surfaces.

## Static audit

- DOM ids: 273 unique.
- Simple DOM references: 248, no missing targets.
- Event-handler targets: 98, no missing targets.
- Named functions: 593, no duplicate declarations.
- HTML module syntax: PASS with node --check.
- Service worker syntax: PASS with node --check.
- Button/fake-button dark background + white label rule: PASS.

## MobileSAM binary limitation in this build environment

The build environment can reach the remote MobileSAM ONNX URL and received an HTTP 200 response for the compact bundle, but the artifact-download policy prevents binary ZIP/ONNX payloads from being materialized into the build filesystem. Therefore this release does not claim to bundle a model binary it could not verify locally.

The application is local-first and accepts either:

- models/mobilesam.encoder.onnx + models/mobilesam.decoder.quant.onnx on the host, or
- an encoder+decoder ZIP/ONNX upload in the browser.

The target device must pass an actual encoder-to-decoder smoke inference before the optional object stage is enabled.
