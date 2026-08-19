# V30.10.1 boot fix

The previous `single_v30` archive was an overlay incorrectly packaged as if it were a complete replacement. It omitted original runtime files such as `js/app.js`, SLAM modules, workers, WASM, CSS and manifest. Replacing the entire repository folder with it causes an endless BOOT / crash.

## Correct deployment

Merge this `v30/` directory **into the existing full `room_scanner/v30/` directory from the repository**. Do not delete original files first.

Before publishing, run from `v30/`:

```bash
npm run verify
```

Then check `boot_diagnostic.html`; every required asset must be PASS.

V30.10.1 also changes the browser bootstrap itself: missing assets now produce an explicit `BOOT ERROR` naming each missing path, and the service worker install is atomic so an incomplete shell cannot become the offline build.
