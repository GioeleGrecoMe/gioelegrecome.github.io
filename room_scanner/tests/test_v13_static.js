'use strict';
const fs=require('fs'),assert=require('assert'),path=require('path');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'room_scanner_v12.html'),'utf8'),geo=fs.readFileSync(path.join(root,'v13_geometry.js'),'utf8');
assert.match(html,/V13\.0\.0/);assert.match(html,/__ROOM_SCANNER_V13__/);assert.match(html,/v13_geometry\.js/);
assert.equal((html.match(/navigator\.xr\.requestSession\(/g)||[]).length,1,'must request exactly one immersive session per tap');
assert.equal((html.match(/getUserMedia/g)||[]).length,0);assert.equal((html.match(/ImageCapture/g)||[]).length,0);assert.equal((html.match(/setInterval\(/g)||[]).length,0);
assert.equal((html.match(/RayEvidenceVolume/g)||[]).length,0,'legacy TSDF/ray volume must be gone');
assert.equal((html.match(/rebuildStructure/g)||[]).length,0,'legacy autonomous structural rebuild must be gone');
assert.match(html,/optionalFeatures:\['depth-sensing','mesh-detection','anchors'\]/);
assert.match(html,/frame\.createAnchor/);assert.match(html,/applyParallelWallRefinement/);assert.match(html,/solveAllCorners/);
assert.match(html,/metricCoverageSummary/,'metric confirmation must inspect XR coverage');
assert.match(html,/ceilingAnchorStatus/,'closed volume must require measured ceiling anchors');
assert.match(html,/cell\.offsets=cell\.offsets\.map\(v=>v-shift\)/,'wall residuals must be rebased after refinement');
assert.match(html,/objectMaxVoxels:42000/,'object evidence must stay memory bounded');
assert.match(html,/k\.deep=null/,'full Deep maps must be discarded after classification');
assert.match(html,/shellPointOccludedInFrame/,'Deep shell anchors must reject same-frame foreground occlusion');
assert.ok(!/plane-detection/.test(html),'unused plane detection should not be requested');
// Deep must never run from the XR frame loop.
const xr=html.slice(html.indexOf('function onXRFrame'),html.indexOf('/* ---------------- guided topology'));
assert.ok(!/ensureDepth|inferDepth|workerRequest/.test(xr),'Deep inference leaked into live XR loop');
// DOM IDs are unique and every literal $(id) reference exists.
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]),idSet=new Set(ids);assert.equal(ids.length,idSet.size,'duplicate DOM ids');
const refs=[...html.matchAll(/\$\('([^']+)'\)/g)].map(m=>m[1]);for(const r of refs)assert.ok(idSet.has(r),`missing DOM id ${r}`);
// Function declarations must be unique in each source.
for(const [name,src] of [['html',html],['geometry',geo]]){const f=[...src.matchAll(/function\s+([A-Za-z0-9_$]+)\s*\(/g)].map(m=>m[1]),seen=new Set();for(const x of f){assert.ok(!seen.has(x),`${name}: duplicate function ${x}`);seen.add(x)}}
// Geometry authority: no per-wall free rotation/normal optimizer state in app state.
assert.ok(!/wallRotation|freeWallNormal|optimizePlaneNormal/.test(html));
console.log(`V13 static tests: PASS · ${ids.length} DOM IDs`);
