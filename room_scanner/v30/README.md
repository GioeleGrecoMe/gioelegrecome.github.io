# Room Scanner V30.15.0

Room Scanner uses **AlvaAR as the autonomous persistent visual SLAM tracker**.
Calibration is optional and only fixes a one-shot metric transform. It never
steers Alva after scanning starts.

## Reconstruction pipeline

```text
camera -> AlvaAR pose/world tracking
              |
              v
       local keyframe graph
              |
              v
  multi-view plane-sweep depth
              |
              v
    surfel + sparse TSDF fusion
          |             |
          v             v
   live surface splats  TSDF mesh
```

Sparse Alva feature points are used for tracking/debugging, not directly turned
into Gaussian geometry. The live splats are derived from multi-view-confirmed
surfels; the mesh is derived from the TSDF.

## Scan behaviour

- `ALVA TRACKING`: tracking valid; keyframes/dense mapping may advance.
- `ALVA LOST`: world is frozen and dense mapping pauses.
- `ALVA RELOCALIZED`: Alva resumes in the same persistent world.
- `DEPTH`: accepted dense depth samples from multi-view plane sweep.
- `surf`: confirmed surface splats with multi-view support.
- The live mesh is shown over the camera after enough TSDF observations.

Move laterally and retain image overlap. Pure rotation gives little/no depth.
Textureless areas are rejected rather than hallucinated.

## Mobile resource budget

Dense reconstruction runs separately from Alva in module workers. It keeps at
most 8 downsampled 160x240 keyframes, processes one dense job at a time, uses
2–4 source views, and automatically reduces sampling density/source count if a
job is slow. Sparse surfel/TSDF maps have hard memory caps.

## Depth Anything

Depth Anything is not active in V30.15. The planned fallback is deliberately
small: infer depth only on a few selected difficult keyframes and use it as a
search prior for plane sweep. Alva remains the tracker and multi-view geometry
remains the final consistency test. See `docs/CHANGES_V30_15_0.md`.

## AlvaAR runtime

The application uses `vendor/alva_ar.js` when available, otherwise the validated
official runtime loader/cache path from V30.14.x. For a fully offline first
launch, vendor the official AlvaAR distribution in that location.

## Verification

```bash
npm run verify
```

See `docs/DENSE_MAPPING_GUIDE.md` for scan instructions.
