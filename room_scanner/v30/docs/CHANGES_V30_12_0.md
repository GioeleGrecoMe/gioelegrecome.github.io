# Room Scanner V30.12.0 - live MVS -> Gaussian -> metric mesh

## Root cause fixed

V30.11.4 created `mvs_worker.js` and `gaussian_worker.js`, but the Scan loop only ran `state.slam.process(frame)`. No keyframe pair was ever sent to MVS. Because MVS never emitted 3-D points, the Gaussian accumulator never received `type:'add'`, so GS stayed at zero and Review had no samples from which to build a mesh.

## V30.12 pipeline

1. Metric bridge locks the normal camera to the saved WebXR common view.
2. `SlamEngine.setMetricReference()` starts tracking from the calibrated camera pose and derives a reference depth from the real XRAnchor pin positions.
3. Optical-flow translation is converted to metres with that calibrated depth instead of the old fixed arbitrary coefficient.
4. Each useful SLAM keyframe carries pose, feature coordinates and descriptors.
5. The Scan loop selects metric keyframe pairs with sufficient lateral baseline and sends them to `mvs_worker.js` off the main thread.
6. MVS performs mutual descriptor matching and two-view ray triangulation. It rejects weak geometry instead of inventing depth.
7. Accepted metric 3-D points, sampled RGB and local scale are sent to `gaussian_worker.js`.
8. Gaussian snapshots update the live GS counter and metric surface diagnostics.
9. Review automatically builds a conservative metric occupancy mesh in `metric_mesh_worker.js` and reports vertices/faces. The mesh can be downloaded as PLY.

## Geometry conventions corrected

The camera/world convention is +X right, +Y up, +Z forward, while image v increases downward. `pixelRay()` and `projectPoint()` now use the same Y sign as WebXR calibration. This matters for vertical triangulation.

## User guidance during Scan

For best camera-only triangulation, move slowly sideways by a few centimetres while keeping the same textured surfaces in view. Avoid pure rotation during the first MVS pairs. The HUD now reports baseline, accepted pair count, triangulated points and GS count. Empty MVS results include a reason instead of silently leaving GS at zero.
