import fs from 'node:fs';
import {ProbabilisticJointOptimizer} from './js/probabilistic/joint_optimizer.js';
function revive(x){
 if(!x||typeof x!=='object') return x;
 if(x.__r30Typed && Array.isArray(x.data)){
  const C=globalThis[x.__r30Typed]; return C?new C(x.data):x.data;
 }
 if(Array.isArray(x)) return x.map(revive);
 for(const k of Object.keys(x)) x[k]=revive(x[k]);
 return x;
}
const d=revive(JSON.parse(fs.readFileSync('/mnt/data/roomscan-1787408462091.r30','utf8')));
const graph=d.evidence.factorGraph;
const initial=d.evidence.probOptimization;
const opt=new ProbabilisticJointOptimizer(graph,{initial});
console.log('edge init',opt.edgeModel.stats());
console.time('rebuild');
const out=opt.rebuild({voxel:.03,hashVoxel:.018,maxSurfels:90000,maxTriangles:90000,meshMinConfidence:.30});
console.timeEnd('rebuild');
console.log(JSON.stringify({global:out.stats.globalSurfaceConsensus, mesh:out.stats.meshQuality, raw:out.stats.rawMeshQuality, clean:out.stats.meshCleanup, mvs:out.stats.mvsValidation, submap:out.stats.submapPoseGraph, poseScaffold:out.stats.poseScaffoldPolicy, policy:out.stats.geometryPolicy},null,2));
