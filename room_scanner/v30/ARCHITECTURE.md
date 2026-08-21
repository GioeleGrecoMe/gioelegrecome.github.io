# Room Scanner V30.32 architecture

## 1. Photo mosaic is an independent sensor layer

A photo node contains the frozen RGB/gray image, its image dimensions/intrinsics and features detected directly from that image. `pose` is nullable.

The image graph has no dependency on AlvaAR. Candidate long-range links are proposed from image appearance. Links survive only after photo descriptor/ZNCC matching and homography RANSAC.

## 2. Global 2-D mosaic

The first frame of the largest connected photographic component is assigned the identity transform solely to choose a coordinate origin. Pairwise homographies propagate transforms to other frames. A correspondence-bundle coordinate descent then refits each non-root transform against all incident neighbouring and loop correspondences, distributing drift from photo evidence alone.

## 3. Parallax

A single projective transform cannot model general translated-camera indoor scenes. Residual correspondence errors therefore drive a spatially varying grid warp per frame. This correction also contains no Alva terms.

## 4. Deep layer

Raw Depth Anything maps remain attached to the exact photo nodes. Relative depth transforms are estimated robustly over verified RGB overlap pairs. Depth is rendered through the exact same photo mosaic transform and local warp.

## 5. Alva/metric layer

If a valid Alva pose exists at photo capture time it is retained as optional metadata and can still support the existing metric/3-D pipeline. If it does not exist, the photo node remains valid. No Alva quantity can change the photographic mosaic.

## 6. 3-D reconstruction

Unchanged in V30.32. This patch deliberately stops after improving the reliability of the photo/depth evidence layer.
