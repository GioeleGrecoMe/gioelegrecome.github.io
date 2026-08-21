# V30.27 EXP-4 verification

Base: V30.27 EXP-3.

## Regression fixed

- Atomic HTML/CSS/JS/service-worker build handshake before `app.js` starts.
- No `controllerchange` reload racing UI binding.
- Service-worker install no longer precaches every optional asset, so an optional/lazy missing file cannot brick shell activation.
- Inline boot recovery remains clickable even when ES modules fail.
- Shell-only reset preserves IndexedDB sessions, Depth Anything CacheStorage and Alva runtime cache.
- Successful boot records the actual controlling service-worker version; a preceding failed boot is persisted and logged on recovery.
- Self-tests for lost Alva tracking and proxy-depth wiring now test the current runtime contract instead of stale source tokens.
- Deep metric calibration restores direct, inverse-raw and inverse-depth projective models.

## Automated verification

`npm run verify`: PASS

- Node regression suite: 106/106 PASS.
- Depth diagnostics: PASS.
- V30 layout: PASS (single v30 root).
- Dependency closure: PASS.
- EventTarget constructors: PASS 5/5.
- Mock UI boot: PASS; controls remain bound after expected WebXR failure.
- Alva runtime contract: PASS.

The Android/GitHub Pages controller-handover race itself still needs the real-device repeated-reload check described in `TEST_ON_PHONE.md`.
