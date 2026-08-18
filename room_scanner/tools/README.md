# External RAW processing

The browser exports a standard ZIP file with the suffix `.rscan.zip`. The basic converter has no third-party dependencies:

```bash
python3 tools/process_rscan.py capture.rscan.zip --out recovered --extract-images
```

It validates ZIP CRCs and the `RSCAN-ZIP-1` manifest, replays compact metric point batches, applies markpoint-based yaw/translation registration without changing scale, performs voxel fusion, and writes:

- `metric_surfels.ply` — decimated metric RGB point cloud;
- `trajectory.csv` — registered WebXR trajectory;
- `microphone_continuous.wav` — concatenated PCM chunks, when audio was enabled;
- `registration.json` — segment transforms and residuals;
- `diagnostics_summary.json` — session, error tail, counts and recovery information;
- `frames/` — JPEG keyframes when `--extract-images` is used.

Segments without at least two compatible persistent markpoints are not merged. Their bytes remain in the archive for a more advanced registration pipeline.
