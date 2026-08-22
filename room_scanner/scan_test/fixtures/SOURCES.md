# Public debug fixtures

## TUM RGB-D Benchmark — Freiburg1

The fixture `tum_freiburg1_xyz_rgb_preview.png` is the official RGB preview image published by the Technical University of Munich RGB-D SLAM Dataset and Benchmark.

- Dataset page: https://cvg.cit.tum.de/data/datasets/rgbd-dataset
- Download/debugging page: https://cvg.cit.tum.de/data/datasets/rgbd-dataset/download
- File formats/intrinsics: https://cvg.cit.tum.de/data/datasets/rgbd-dataset/file_formats
- Preview source: https://cvg.cit.tum.de/rgbd/dataset/freiburg1/rgbd_dataset_freiburg1_xyz-rgb.png

The benchmark states that its data is CC BY 4.0 unless otherwise noted. The tests also use a short numeric excerpt from the public `freiburg1_rpy` ground-truth trajectory and the published Freiburg1 RGB intrinsics (fx=517.3, fy=516.5, cx=318.6, cy=255.3).

`tum_freiburg1_xyz_debug_replay.mp4` is generated locally from the official preview image only. It is a deterministic media-decoder fixture, not a claim that the original TUM AVI was redistributed in this package.

V30.28 additionally includes the complete official `freiburg1_xyz` ground-truth text file downloaded from
`https://cvg.cit.tum.de/rgbd/dataset/freiburg1/rgbd_dataset_freiburg1_xyz-groundtruth.txt`.
`tum_freiburg1_xyz_rgb_preview_gray.pgm` is a deterministic 320x240 grayscale derivative of the official RGB preview used only for dependency-free real-texture association tests.
