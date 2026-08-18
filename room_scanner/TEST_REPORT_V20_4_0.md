# V20.4.0 test report

## Automated tests

- JavaScript syntax check for all V20.4 modified modules: PASS
- CPU depth raw-buffer / normalized-UV sampling: PASS
- RSRY v1 encode/decode metric round trip (<4 mm synthetic error): PASS
- synthetic GPU-downsample ray reconstruction orientation/depth: PASS
- GPU depth static contract (XRWebGLBinding + uv transform + scale): PASS
- V20.4 density/build/worker routing requirements: PASS
- legacy V20.2 geometry/grid/markpoint/RIR/raw-contract regression suite: PASS
- desktop RAW processor Python compile/help smoke: PASS

## Important hardware validation still required

The container cannot create a real Android WebXR session. Therefore the
following remain phone tests:

- XRWebGLDepthInformation opaque texture sampling on the target Chrome/ARCore
  implementation, including each negotiated data format/texture type;
- sustained GPU->CPU downsample readback cost and thermal behavior;
- Raw Camera + GPU depth in the same active XR frame;
- sustained IndexedDB write throughput for long high-density scans;
- actual Gaussian/ray counts over a multi-room walk;
- Deep model memory/temperature on the target device.

The implementation fails open: after three GPU-depth readback failures it logs
the errors and disables only that path; the rest of the capture continues.
