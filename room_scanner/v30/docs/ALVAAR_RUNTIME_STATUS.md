# AlvaAR runtime status

V30.13.0 is wired to the real AlvaAR `AlvaAR.Initialize()` / `findCameraPose()` path.

The upstream `dist/alva_ar.js` file is not embedded in this generated archive because the execution environment could not download the 4.13 MB upstream file. The application therefore:

1. tries `v30/vendor/alva_ar.js`;
2. if absent, imports the configured jsDelivr mirror of the upstream repository;
3. caches a successful CDN module through the service worker for subsequent reuse;
4. uses the explicitly labelled `SLAM FALLBACK` path only if AlvaAR cannot be loaded.

For a fully self-contained deployment, place the official AlvaAR `dist/alva_ar.js` at exactly `v30/vendor/alva_ar.js` and preserve its GPLv3 license/notices.

During Scan, verify the HUD says `ALVA SLAM`. If it says `SLAM FALLBACK`, do not evaluate reconstruction quality as an AlvaAR run.
