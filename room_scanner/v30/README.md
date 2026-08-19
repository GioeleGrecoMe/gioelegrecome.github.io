# Room Scanner V30.1.0 — Standalone Debug Bootstrap

V30.1.0 is a self-contained GitHub Pages application. It does not import or
require any Room Scanner V20 HTML, JavaScript, worker, stylesheet, cache name or
database.

## Why V30.0.0 showed a dead UI

The first V30 package contained the experimental WASM/SLAM modules but omitted
runtime files referenced by the HTML, including `js/app.js`, `styles.css`,
`manifest.webmanifest` and `js/slam/math.js`. Because the module graph failed
before bootstrap, no button or range input event handler could be installed.

V30.1.0 turns the prototype into an actual application shell and adds a
pre-bootstrap fallback that still operates the camera-height range control and
can download an early diagnostics JSON even if the main ES module fails.

## Runtime architecture

- `getUserMedia()` rear camera capture; no WebXR dependency.
- freestanding `wasm/slam_core.wasm` for FAST-like features, BRIEF descriptors,
  matching and robust metric PnP;
- JS keyframe/landmark SLAM graph with loop-closure candidates and markpoints;
- optional Depth Anything V2 Small in an isolated Worker;
- incremental 3D Gaussian map in an isolated Worker;
- dependency-free WebGL2 Gaussian viewer, initialized lazily only when needed;
- incremental IndexedDB storage;
- binary RGB/Gaussian PLY import/export;
- `.r30` raw container using binary Gaussian payloads;
- persistent diagnostics UI and downloadable logs.

Depth failure is deliberately non-fatal. Camera capture, WASM feature tracking,
keyframe storage, IMU collection and diagnostics continue if the neural model or
runtime cannot load.

## Deploy

Upload the **contents** of this directory to a new GitHub Pages folder, for
example:

```
room_scanner/v30/
```

Open either:

```
/v30/
/v30/room_scanner_v30.html
```

Both entry points are identical.

## Diagnostics

The `Diagnostica / debug` drawer is available on every screen. It contains:

- live recent events;
- `Scarica log`;
- `Copia log`;
- `Esegui self-test`.

The diagnostics export includes build identity, browser/device capabilities,
screen properties, current session metadata, SLAM counters, Gaussian counters,
Deep state and event history. Severe bootstrap errors are also mirrored to a
small localStorage emergency record.

## Deep Anything

The application first attempts a local Transformers.js ES module at:

```
vendor/transformers/transformers.min.js
```

If absent it tries the configured CDN module. The model ID is configured in
`js/config.js` and the neural path runs in `workers/depth_worker.js`.

A fully offline deployment can populate the local runtime/model assets later;
they are not required for the UI, WASM SLAM, storage, diagnostics or PLY/R30
viewer to bootstrap.

## Tests

Run from the V30 folder:

```
./tests/run_tests.sh
```

See `TEST_REPORT.md` for the exact verified contracts and `TEST_ON_PHONE.md` for
the hardware protocol.
