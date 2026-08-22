import fs from 'node:fs';
import {ProbabilisticFactorGraph} from '../js/probabilistic/factor_graph.js';
import {ProbabilisticJointOptimizer} from '../js/probabilistic/joint_optimizer.js';
import {evaluatePoseScaffoldPolicy} from '../js/probabilistic/pose_scaffold_policy.js';
const x=JSON.parse(fs.readFileSync(process.argv[2]||'/mnt/data/roomscan-1787388793897.r30','utf8'));
const g=ProbabilisticFactorGraph.fromState(x.evidence.factorGraph);const opt=new ProbabilisticJointOptimizer(g.exportState(),{});const all=new Set(opt.frames.map((_,i)=>i));
const report=(label)=>{const s=opt.computeStats(),p=evaluatePoseScaffoldPolicy({edgeStats:s.edgeSwitches,photoAudit:g.photoEdgeAudit,frameCount:g.frames.length}); console.log(label,JSON.stringify({reproj:s.reprojectionRobustRmse,med:s.reprojectionMedianPx,edge:s.edgeSwitches,alva:s.alvaSwitches,policy:p},null,2));};
opt.edgeModel.update(opt.frames,opt.landmarks,{bootstrap:true});report('seed');
for(let i=0;i<40;i++){
  opt.refineRgbTranslationLines(all,{gain:.55,maxStep:.14});
  if(i%2===1) opt.refineLandmarks(all);
  opt.edgeModel.update(opt.frames,opt.landmarks,{bootstrap:true});
  const c=opt.edgeModel.translationContradictionMap?.()||null; opt.alvaModel.update(opt.frames,{translationContradiction:c});
}
report('after-global-40');
