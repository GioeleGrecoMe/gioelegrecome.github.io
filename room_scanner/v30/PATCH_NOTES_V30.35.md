# V30.35 patch notes

## Why

V30.34 fixed the RGB geometry, but the live Depth preview could still show large frame-shaped colour blocks. The cause was structural: a single global affine relation between monocular maps is too rigid, and direct averaging creates false intermediate depth at occlusions or mis-calibrated layers.

## Changes

- global per-channel RGB exposure compensation over all accepted overlap edges and loops;
- dense depth references come only from the RGB-verified spherical overlap masks;
- unstable RGB/depth discontinuities receive lower calibration weight;
- robust foreground/mid/background overlap anchors are extracted automatically;
- affine per-frame Depth transforms replaced by 16-knot monotone nonlinear layer transfers;
- full connected overlap graph solved jointly with IRLS and regularized layer slopes;
- live atlas keeps two probabilistic depth hypotheses per panorama pixel;
- incompatible surfaces are never arithmetic-averaged;
- Hann feathering is enabled only inside true RGB overlap;
- one global relative-depth colour scale is used for all connected maps;
- extra live diagnostics: number of layer references and ambiguous fused area;
- `.r30`/live graph persists full nonlinear Depth transfer knots and confidence;
- 3-D reconstruction unchanged.

## Literature used as design guidance

- Kopf et al., CVPR 2021, *Robust Consistent Video Depth Estimation*: flexible low-frequency depth deformations plus geometry-aware filtering for temporal consistency.
- Peng & Zhang, WACV 2023, *High-Resolution Depth Estimation for 360° Panoramas through Perspective and Panoramic Depth Images Registration*: register perspective depth maps to a common panoramic depth domain before blending.
- Burgdorfer & Mordohai, ICCV 2023, *V-FUSE*: confidence/visibility-aware depth consensus instead of blind averaging.
- Ding et al., CVPR 2026, *LASER*: a single global scale can fail because scene depth layers drift differently; layer-wise scale alignment addresses that failure mode.
- Pielawski & Wählby, PLOS ONE 2020: Hann weighting of overlapping patches reduces edge artefacts while preserving smooth reconstruction.

The browser implementation is intentionally lighter than these full research systems: monotone 1-D layer transfers plus a two-hypothesis atlas provide the useful consistency mechanisms without adding another neural model or heavy volumetric optimization on the phone.
