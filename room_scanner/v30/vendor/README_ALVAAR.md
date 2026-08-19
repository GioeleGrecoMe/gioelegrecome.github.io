# AlvaAR runtime dependency

Room Scanner V30.13 tries `vendor/alva_ar.js` first. For a fully self-contained/offline deployment, copy the **official** AlvaAR `dist/alva_ar.js` file here with exactly that name.

Upstream: `alanross/AlvaAR`, `dist/alva_ar.js` (GPL-3.0).

If the local file is absent, Room Scanner attempts the configured jsDelivr URL. If that also fails, scanning continues with the explicitly labelled low-quality JavaScript optical-flow fallback rather than pretending that the 34-byte sentinel WASM is SLAM.

AlvaAR and its OV2SLAM / ORB-SLAM2-derived components are GPLv3; preserve the upstream license and notices when vendoring/distributing the file.
