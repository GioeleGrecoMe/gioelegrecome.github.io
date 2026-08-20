# Room Scanner V30.14.2 — official AlvaAR runtime integration

## Fixed root cause

V30.14.0 could require AlvaAR semantically while still shipping without the official distribution bundle. The tiny local `wasm/slam_core.wasm` is only a deployment sentinel and is **not** accepted as SLAM.

V30.14.2 integrates the official AlvaAR distribution contract as a mandatory runtime dependency.

## Runtime loading order

1. `v30/vendor/alva_ar.js` — preferred fully offline physical copy.
2. Dedicated browser CacheStorage (`room-scanner-alvaar-official-v1`) — enables offline launches after one successful bootstrap.
3. Official upstream/mirrors configured in `js/config.js` — used only when the physical vendor file and validated cache are absent.

Every source is loaded as text first and rejected unless it has a realistic official-bundle size and the public API markers `AlvaAR`, `Initialize`, `findCameraPose`, and `getFramePoints`. The module itself must then export `AlvaAR.Initialize`.

The application initializes the tracker using the upstream API contract:

```js
const alva = await AlvaAR.Initialize(width, height);
const pose = alva.findCameraPose(frame);
const points = alva.getFramePoints();
```

There is no optical-motion substitute and no acceptance of the local sentinel as an Alva implementation.

## Offline behavior

The official upstream `dist/alva_ar.js` is approximately 4.13 MB. This build environment could inspect the upstream repository and file metadata but could not retrieve that large raw blob into the generated archive. Therefore the release contains the complete integration/validator/cache path but not the upstream 4.13 MB blob itself.

For a completely offline **first** launch, run from `v30/` on any network-enabled development machine:

```bash
npm run vendor:alva
```

The command downloads the official distribution, validates it, writes `vendor/alva_ar.js`, and prints its SHA-256. Commit that file together with the rest of `v30/`.

Without physical vendoring, the first successful online launch downloads and validates AlvaAR once and subsequent launches use the dedicated CacheStorage copy offline.

## Diagnostics

The browser self-test now includes `alvaar-runtime-real`. It fails unless the runtime is a realistic full distribution and exports `AlvaAR.Initialize`.

During Scan the application only enters the Alva tracking path after real runtime initialization. Loader status records whether the source was `vendor`, `cache`, or `remote`, together with the byte count.

## Licensing

AlvaAR is GPL-3.0. A copy of GPL-3.0 is included at `vendor/ALVAAR_GPL-3.0.txt`; `vendor/README.md` records the upstream source and vendoring procedure.
