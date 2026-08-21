# Room Scanner V30.35 · spherical RGB + layer-wise probabilistic Depth

V30.35 keeps the V30.34 RGB-only spherical panorama unchanged geometrically and redesigns how exact-frame Depth Anything maps are synchronized and fused.

## Measurement contract

- A photo enters the live graph only together with the Depth map inferred from that exact frozen RGB frame.
- RGB overlap is the only authority for panorama registration. AlvaAR is optional metadata and never places a photo.
- Panorama geometry is rigid spherical rotation; no projective warp may stretch an image.
- Small exposure/white-balance differences are compensated globally per RGB channel across the photographic overlap graph.

## Depth synchronization

The relative Depth Anything output is not treated as metric depth or as if one affine scale were sufficient. Every accepted RGB spherical overlap contributes a dense set of corresponding raw-depth samples. Samples near RGB/depth discontinuities are down-weighted. Broad depth bands in each overlap are summarized into robust layer anchors.

All connected frames are then optimized jointly with monotone piecewise-linear transfers `T_i`:

`T_i(D_i(p)) ~= T_j(D_j(q))`

The transfer has 16 robust quantile knots and is solved with IRLS plus slope regularization. This permits foreground/mid/background response to change non-linearly while preserving depth ordering and one common global gauge.

## Probabilistic atlas

The live depth atlas no longer averages all maps blindly. Each panorama pixel keeps at most two competing depth hypotheses. Compatible observations tighten a hypothesis; incompatible layers stay separate. The displayed value is the MAP hypothesis, so two different surfaces are not converted into an artificial intermediate depth.

Hann feathering is applied only where the RGB spherical masks really overlap. A non-overlapped photo keeps full weight to its border, so feathering cannot erase coverage. One shared global depth colour range is used for the entire atlas.

## Scope

The downstream 3-D reconstruction is intentionally unchanged in V30.35. This patch only improves the photographic/depth evidence delivered to it.
