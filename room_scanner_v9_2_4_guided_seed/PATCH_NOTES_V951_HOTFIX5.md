# v9.5.1 Hotfix5 — deploy integrity

## Why
The public GitHub Pages deployment was mixed: `room_scanner_v9.html` was still Hotfix3 (`951h3`) while `sw.js` was Hotfix4 (`951h4`). This allowed old HTML to remain cache-first and kept the old MobileSAM quant-only preflight active.

## Changes
- One revision id (`951h5`) across HTML, model caches, service worker and local model cache-busters.
- Navigation and `room_scanner_v9.html` are network-first; cached HTML is fallback only.
- Startup probes the server service-worker bytes with `cache: no-store` and records a deploy mismatch.
- `Precarica AI` exposes the exact MobileSAM error in the UI/title/status.
- Step 3 failure wording no longer incorrectly says it was skipped.
- Hotfix4 behavior is retained: FP32 decoder preferred, quant decoder fallback, remote fallbacks, model byte sanity checks, network-first local model loading, and visual-only WebXR Gaussian fallback.

## Deployment
Upload the entire project folder. The public `room_scanner_v9.html`, `sw.js` and `build_info.json` must all be from this Hotfix5. A hard refresh is still recommended once after deployment, but subsequent deploys no longer depend on it because documents are network-first.
