# Room Scanner V30.39.2 — atomic ESM closure for OPT UNICO

This hotfix does not change the optimization mathematics. It fixes deployment/loading of the only active optimizer.

## Root cause seen on phone
`single_optimizer_runtime.js` was HTTP 200 with JavaScript MIME, but its dynamic import still failed. That means the top-level asset existed while at least one static dependency in its ESM graph was stale/missing/incoherent. V30.39 published the new runtime without republishing the complete transitive closure.

## Fix
- Republish the complete static dependency closure of `single_optimizer_runtime.js`.
- Every static import in that closure is tagged with `?v=30.39.2`.
- The service-worker/build/HTML/app identities are all `30.39.2`.
- A rejected lazy import is removed from `moduleCache`; the next user action performs a real retry instead of replaying the same rejected Promise forever.
- On a critical optimizer import failure, diagnostics probe every closure asset and report HTTP status, MIME and byte count.
- No second/fallback optimizer is added.

## Operational closure
`single_optimizer_runtime -> joint_optimizer -> {switches, depth hierarchy, consistency, reliability, submap graph, submap fusion} -> {fusion_core, math}`.
