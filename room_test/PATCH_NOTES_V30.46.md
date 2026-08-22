# Room Scanner V30.46 - Canonical RGB scaffold + post-scan dense rebuild

Build: `30.46.0`  
ID: `v30.46.0-20260822-canonical-rgb-postscan-dense`

## Root cause fixed

The V30.45 real session contained 121 frames, 112 imported photo edges, 2,365 RGB landmarks, 32 late-bound Depth frames and 32,757 MVS samples, but final geometry was empty because the global RGB pose scaffold was declared unobserved.

A replay of the uploaded `.r30` isolated a convention mismatch in the direct photo correspondences: `rotationBToA` already has the correct B-to-A convention, while legacy `aU/aV` and `bU/bV` match coordinates are reversed relative to `aId/bId`. V30.46 canonicalizes the match coordinates and deliberately leaves `rotationBToA` unchanged.

On the real V30.45 `.r30`:

- before canonicalization: 1/112 usable RGB translation-line edges;
- after canonicalization: 72/112 usable RGB translation-line edges;
- median epipolar residual: 2.206 deg;
- median direct parallax: 20.325 deg;
- all 112 imported legacy edges were identified as `swapped-input` in this session.

## Global RGB recovery before dense geometry

V30.46 runs a full-graph RGB translation-line recovery after acquisition and before dense processing. A strong direct epipolar backbone can authorize the pose scaffold even when the older whole-edge switch metric is weak. The final reconcile no longer reverts to the weaker baseline merely because the legacy RGB consensus guard is the only hard reason: an observed `directLineBackbone` can explicitly preserve the recovered scaffold.

Diagnostics now expose the canonicalization audit and final scaffold state, including direct-line count, inlier fraction, epipolar residual and directional disagreement.

## MVS removed from the acquisition fast path

Plane-sweep MVS is now post-scan only. During acquisition the application performs only a throttled sparse geometric preparation pass and stores a bounded, novelty-selected reservoir of MVS payloads. After the camera/Alva/RGB fast lane is frozen:

1. solve the complete RGB/Alva scaffold;
2. rebind retained MVS payload poses to that solution;
3. execute plane-sweep MVS;
4. drain late Depth Anything;
5. run final joint rebuild.

`sparseFastLaneMinIntervalMs` is 4200 ms in V30.46. The post-scan MVS reservoir is bounded to 48 jobs and replaces redundant views using pose/time novelty rather than first-come-first-served accumulation.

## Better late-Depth distribution

Depth Anything remains completely post-scan. The survey reservation is reduced to 2 frames and depth planning is slowed so the queue spans more of the acquisition instead of filling immediately with the first views. Exact RGB/Depth identity by immutable `frameId` is preserved.

## Non-committed candidate geometry is now visible

A rejected dense reconstruction is no longer rendered as an empty Review screen. If the rebuild produces splats/mesh but fails the geometry policy:

- it is displayed as `CANDIDATO NON COMMITTED`;
- committed state remains empty;
- `window.__ROOMSCAN_METRIC_MESH` remains null;
- PLY/mesh export remains blocked;
- the rejection reason and candidate counts remain in diagnostics.

This separates "nothing was reconstructed" from "a reconstruction exists but is not safe to commit".

## Real-session regression result

Full replay of `roomscan-1787388793897.r30` after V30.46 fixes:

- RGB pose scaffold: observed;
- direct-line backbone: true;
- translation-direction edges: 72;
- mean direction residual: 20.060 deg;
- direct epipolar inlier fraction: 0.884;
- mean epipolar-plane residual: 2.088 deg;
- MVS tested: 25,000;
- MVS locally validated and committed: 8,841 (35.364%);
- output surfels/Gaussians: 1,921;
- output mesh faces: 9,213.

The same replay also shows that the candidate is not yet a valid room model:

- 115 connected mesh components;
- largest component fraction: 8.40%;
- fragmentation score: 0.916;
- dense diagonal: 22.38 m vs camera trajectory diagonal 8.10 m.

Therefore the final geometry policy correctly withholds commit with `mesh-catastrophically-fragmented`. V30.46 fixes the zero-model failure and makes the bad candidate inspectable; it does not hide the remaining geometric error by weakening the topology gate.
