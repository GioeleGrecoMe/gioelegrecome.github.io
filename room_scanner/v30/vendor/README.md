# AlvaAR runtime

Room Scanner V30.16.0 uses the official AlvaAR `dist/alva_ar.js` distribution.

Preferred fully-offline layout:

    v30/vendor/alva_ar.js

Official upstream:
https://github.com/alanross/AlvaAR/blob/main/dist/alva_ar.js

The upstream file is approximately 4.13 MB and is GPL-3.0 licensed. If the
physical file is absent, Room Scanner downloads the official bundle once from
one of the configured upstream mirrors, validates the public AlvaAR API, stores
it in CacheStorage, and uses that cached copy on later/offline sessions.

The tiny `v30/wasm/slam_core.wasm` file is only a deployment sentinel and is
never accepted as the AlvaAR SLAM runtime.
