# Room Scanner V30.14.0 — AlvaAR autonomous world tracking

## Architectural correction

V30.14.0 restores a strict separation between **tracking** and **metric calibration**.

- **AlvaAR owns the camera trajectory and persistent world for the whole session.**
- WebXR calibration, when available, is used only during a short bootstrap to estimate a fixed similarity transform from the Alva world to metric room coordinates.
- After that transform is locked, calibration pins/templates no longer correct or steer the camera pose.
- If AlvaAR loses tracking, the last world pose is frozen and no MVS keyframes are emitted. When AlvaAR returns a pose, the map resumes in the same Alva world and the UI reports `ALVA RELOCALIZED`.
- There is no optical-flow pose fallback that silently moves the world while Alva is lost.

This design is intended to preserve the main strength of AlvaAR: a coherent world coordinate system with relocalization, while treating metric scale as metadata layered on top of that world.

## Metric bootstrap

With a valid WebXR pin calibration, the measurement screen is temporary. It matches at least three known metric pin positions, estimates a metric camera pose with PnP, pairs that pose with the temporally corresponding raw Alva pose, and accumulates a small set of samples. `AlvaMetricBootstrap` then solves a one-shot Sim(3):

`p_metric = scale * R_align * p_alva + translation`

The resulting transform is fixed for Scan. It is not recomputed frame-by-frame.

Without WebXR calibration the application can start immediately in **ALVA WORLD · scala libera** mode. Alva tracking and AR persistence remain available, but metric MVS/mesh stages that rely on metre-based thresholds are intentionally not labelled metric.

A future non-WebXR metric bootstrap can use a measured distance between two already reconstructed Alva map points or a known planar target. A raw 2D segment in a single monocular frame is not treated as sufficient 3D scale evidence by this release.

## AlvaAR feature feed for MVS

Alva remains the only pose authority. Its tracked frame points are also used as the preferred locations for descriptor extraction in the MVS frontend. Local detector features only fill the remaining feature budget. This keeps the densification stage focused on image locations already considered stable by the SLAM tracker without allowing MVS or local optical flow to alter the camera trajectory.

## Tracking states

Scan exposes explicit states:

- `ALVA TRACKING`: current Alva pose is valid.
- `ALVA LOST`: pose unavailable; world is frozen and no keyframe/MVS update is produced.
- `ALVA RELOCALIZED`: first valid Alva pose after a loss; reconstruction resumes from the same fixed Alva→metric transform.

There is deliberately no `SLAM FALLBACK` tracking state.

## Runtime lifetime

The same Alva frontend instance is preserved from the metric bootstrap into Scan and is not reset when leaving Scan for Review/Resume inside the same page session. This allows Alva's own world/relocalization state to survive those UI transitions.

Reloading the page still creates a new Alva session; persistent serialization of the internal Alva world map is not implemented in V30.14.0.

## Offline Alva runtime

The application first tries `v30/vendor/alva_ar.js`. If that file is absent, it tries the configured AlvaAR CDN URL. The official Alva runtime itself is **not bundled in this release archive**, because it could not be fetched into the build environment. For a fully self-contained/offline deployment, place the official `dist/alva_ar.js` from AlvaAR in:

`v30/vendor/alva_ar.js`

The rest of the V30 shell remains local/offline-capable.

## Verification added

V30.14.0 adds deterministic regression coverage for:

- raw Alva matrix → camera pose convention;
- one-shot Alva→metric Sim(3) recovery;
- PnP metric bootstrap from known 3D pins;
- freeze-on-loss and relocalization without world drift;
- suppression of keyframes/MVS while Alva is lost;
- use of Alva tracked frame points as preferred MVS feature locations;
- fixed metric world transform through MVS → Gaussian → mesh;
- previous WebXR anchor, IndexedDB, UI bootstrap and scan constructor regressions.
