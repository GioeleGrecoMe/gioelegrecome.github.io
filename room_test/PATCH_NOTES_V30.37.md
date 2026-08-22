# V30.37.0 patch notes

## Causal feedback added

- switchable **relative Alva** edges with separate translation/rotation authority;
- absolute Alva pose reduced to a weak gauge prior;
- frame/region/derived-pixel reliability feedback;
- residual cause classifier: pose / global Depth / local Depth / bad match / occlusion / dynamic;
- E-step reliability reweights the next Depth calibration cycle;
- fast RGB/pose loop and slower Depth feedback loop;
- exact persistence/restoration of RGB and Alva switch posteriors.

## Candidate / confirmed surface split

- leave-one-view-out Depth checking never uses the source view as its own support;
- support IDs and triangulation angles are tracked explicitly;
- Deep commits only after independent support (or support + sparse RGB anchor);
- unconfirmed Deep remains candidate and cannot enter TSDF/mesh;
- final splats expose evidence class: `strong`, `confirmed`, `weak`;
- dynamic-suspect frames are prevented from directly committing dense geometry.

## Submap global feedback

- late loop closure uses a rigid submap pose graph;
- submap transforms move globally without re-integrating millions of dense pixels;
- each dense frame has one primary submap assignment and one information budget.

## Acquisition diagnostics

- image-only blur/texture/exposure/clipping quality is stored with each exact RGB frame;
- quality changes authority only; it never aligns the panorama and never substitutes Alva for RGB.

## Compatibility

The patch does not ship or modify `models/`. The existing spherical live RGB+Depth panorama and its one-RGB/one-Depth admission rule are preserved.
