# Audit V12.2.1

## Scope

Audit of the V12.2.0 guided reconstruction pipeline after the request to prioritize a compact textured surface model over dense evidence clouds.

## Main risks addressed

### Perspective distortion in the review viewer

**Previous risk:** a perspective viewer visually exaggerated near/far geometry and made metric inspection harder.

**Fix:** orthographic projection. Screen scale is independent of view depth. Default camera is isometric-like (45° yaw, -35.264° pitch).

### Wall photos captured from poor poses

**Previous risk:** the user could capture an extremely grazing or poorly centered view without feedback.

**Fix:** live wall-view metric computed from WebXR pose and the already-confirmed wall geometry. Full-screen translucent red/yellow/green feedback plus explicit text hint.

### Occluded corners and furniture in front of walls

**Previous risk:** Deep foreground could be fused into the wall or force a distorted plane.

**Fix:** the confirmed wall plane is immutable in orientation. Foreground relative to analytic wall depth becomes residual/object. Structural Deep points are snapped to the wall intersection.

### Windows/mirrors/transparent surfaces exploding depth

**Previous risk:** a depth estimate behind the wall could create impossible geometry.

**Fix:** depth significantly behind the confirmed shell is classified as optical/opening evidence and cannot alter shell geometry. Persistent regions are summarized as finite wall features.

### Texture copying furniture onto the wall

**Previous risk:** direct RGB projection could bake foreground furniture into the wall texture.

**Fix:** per-texel foreground masking using synchronized XR depth and/or metric Deep. Texture source selection is multi-view and prefers frontal, centered, high-quality frames.

### Losing useful RGB when Deep fitting fails

**Previous risk:** difficult optical/low-texture wall photos might be discarded completely.

**Fix:** dedicated wall captures remain eligible as texture-only evidence. They cannot alter geometry without a valid metric Deep result.

### Model size

**Previous risk:** storing dense structural Deep point clouds makes the visual model heavy without adding independent geometric degrees of freedom.

**Fix:** primary room geometry is only floor/ceiling/wall surfaces. Structural Deep is diagnostic and coarsely voxelized. Surface appearance lives in JPEG atlases.

## Invariants enforced

1. User-confirmed floor footprint is structural authority.
2. Wall orientation/position derives from footprint edges.
3. Deep cannot create a second version of an already confirmed wall.
4. Foreground can become an object but cannot move the wall behind it.
5. Behind-shell optical evidence cannot enlarge the room.
6. Texture evidence and geometry evidence have separate admission rules.
7. Final clean viewer defaults to shell/textures/objects, not raw point clouds.
8. Deep inference remains batch-only outside the live WebXR acquisition session.

## Automated validation

The V12.2.1 suite includes static DOM/lifecycle checks and synthetic geometry tests. In addition to earlier V12.2.0 cases it verifies:

- true orthographic depth invariance;
- frontal wall guidance;
- foreground masking for texture;
- coherent wall RGB admission;
- behind-shell optical classification;
- wall snapping despite optical anomalies;
- persistent opening/optical feature extraction.

## Remaining device-only validation

The following cannot be proven in Node:

- WebXR Raw Camera Access availability on the target Chrome/ARCore build;
- vendor plane/depth behavior on mirrors/windows;
- visual quality of JPEG wall atlases on real lighting/exposure changes;
- actual thermal/memory behavior during long Android sessions.
