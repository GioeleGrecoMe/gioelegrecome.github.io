# Room Scanner V30.3.0 — Standalone resilient capture

V30.3.0 is a self-contained GitHub Pages application. It does not import or
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
- recoverable local sessions with Gaussian checkpoints and keyframes;
- binary RGB/Gaussian PLY import/export;
- `.r30` raw container using binary Gaussian payloads;
- persistent diagnostics UI and downloadable logs.

Depth is deliberately deferred by default. Camera capture, WASM feature tracking,
keyframe storage, IMU collection, visual markpoints and diagnostics never wait
for the neural model. The review screen can run `Elabora Deep dopo la scansione`
on saved keyframes; the optional `Deep live` switch is retained for experiments.

When a scan finishes, the app stops the Depth worker first, drains all accepted
Gaussian work, persists the final snapshot, then opens review. Saved local
sessions can be reopened after a reload and exported again; a new segment always
starts with clean worker, IMU and map state.

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

Metric reconstruction remains an estimate on ordinary cameras: the application
uses the supplied camera-height/floor bootstrap and refuses to fuse nominal
low-confidence depth into the persistent Gaussian map. Validate a known
distance in the exported model before using it for dimensional work.

The browser's default rear camera is intentionally retained. A browser does not
provide calibrated intrinsics for an automatically selected ultra-wide lens, so
V30 records lens/zoom capabilities in diagnostics but never silently switches
to a wide camera with the fixed 62° calibration.

## Tests

Run from the V30 folder:

```
./tests/run_tests.sh
```

See `TEST_REPORT.md` for the exact verified contracts and `TEST_ON_PHONE.md` for
the hardware protocol.
