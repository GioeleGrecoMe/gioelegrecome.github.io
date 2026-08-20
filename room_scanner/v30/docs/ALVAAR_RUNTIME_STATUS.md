# AlvaAR runtime status

Expected official runtime: `dist/alva_ar.js` from `alanross/AlvaAR`.

Runtime validity requirements used by Room Scanner:

- source byte size: 3,500,000–6,500,000 bytes;
- source markers: `AlvaAR`, `Initialize`, `findCameraPose`, `getFramePoints`;
- imported module: `AlvaAR.Initialize` must be a function.

Source priority:

1. `vendor/alva_ar.js`;
2. CacheStorage `room-scanner-alvaar-official-v1`;
3. official GitHub raw source;
4. official GitHub Pages mirror;
5. jsDelivr mirror of the same GitHub repository.

Run `npm run vendor:alva` to make the project self-contained from the first offline launch.
Run `npm run check:alva` to validate the integration contract.
In the browser run Self-test and require `PASS alvaar-runtime-real` before evaluating tracking quality.
