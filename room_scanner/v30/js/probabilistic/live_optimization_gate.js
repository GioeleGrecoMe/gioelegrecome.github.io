// V30.39.2 OPT UNICO ESM closure: republished atomically with the single optimizer runtime.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=v=>Number.isFinite(Number(v));

/**
 * Conservative acceptance gate for live optimisation.
 *
 * The optimiser is allowed to explore a working state, but the measurement UI
 * only adopts candidates that are demonstrably sane relative to the last
 * accepted solution on the same evidence graph.  This prevents one bad RGB
 * edge / Deep frame from making the preview jump while still allowing small
 * corrections to accumulate over time.
 */
export function evaluateLiveCandidate({baselineStats=null,candidateStats=null,baselineSnapshot=null,candidateSnapshot=null,options={}}={}){
  const cfg={
    maxReprojectionPx:Number(options.maxReprojectionPx??3.2),
    maxReprojectionGrowth:Number(options.maxReprojectionGrowth??1.28),
    reprojectionSlackPx:Number(options.reprojectionSlackPx??0.18),
    maxCommonTranslationJump:Number(options.maxCommonTranslationJump??0.11),
    maxCommonRotationJumpRad:Number(options.maxCommonRotationJumpRad??(4*Math.PI/180)),
    maxMeanTranslationJump:Number(options.maxMeanTranslationJump??0.045),
    maxMeanRotationJumpRad:Number(options.maxMeanRotationJumpRad??(1.7*Math.PI/180)),
    maxDepthErrorGrowth:Number(options.maxDepthErrorGrowth??1.55),
    depthErrorSlack:Number(options.depthErrorSlack??0.025),
    maxRejectedEdgeGrowth:Number(options.maxRejectedEdgeGrowth??3),
    minObservations:Number(options.minObservations??10),
    minLandmarks:Number(options.minLandmarks??4)
  };
  const b=baselineStats||{},c=candidateStats||{},hard=[],warnings=[];
  if(!finite(c.reprojectionRmse))hard.push('non-finite-reprojection');
  if((c.observations||0)<cfg.minObservations||(c.landmarks||0)<cfg.minLandmarks)warnings.push('weak-scaffold');
  const bR=Number(b.reprojectionRmse),cR=Number(c.reprojectionRmse);
  if(finite(cR)&&cR>cfg.maxReprojectionPx){if(!finite(bR)||bR<=cfg.maxReprojectionPx||cR>=bR*.94)hard.push('reprojection-absolute');else warnings.push('reprojection-high-but-improving');}
  if(finite(bR)&&finite(cR)&&cR>bR*cfg.maxReprojectionGrowth+cfg.reprojectionSlackPx)hard.push('reprojection-regression');
  const pose=poseSnapshotDelta(baselineSnapshot,candidateSnapshot);
  if(pose.commonFrames>=2){
    if(pose.maxTranslation>cfg.maxCommonTranslationJump)hard.push('pose-translation-jump');
    if(pose.maxRotationRad>cfg.maxCommonRotationJumpRad)hard.push('pose-rotation-jump');
    if(pose.meanTranslation>cfg.maxMeanTranslationJump)warnings.push('pose-mean-translation-large');
    if(pose.meanRotationRad>cfg.maxMeanRotationJumpRad)warnings.push('pose-mean-rotation-large');
  }
  const bD=Number(b.deepRelativeError),cD=Number(c.deepRelativeError);
  if(finite(bD)&&finite(cD)&&cD>bD*cfg.maxDepthErrorGrowth+cfg.depthErrorSlack)hard.push('depth-calibration-regression');
  const br=Number(b.edgeSwitches?.rejected||0),cr=Number(c.edgeSwitches?.rejected||0);
  if(cr>br+cfg.maxRejectedEdgeGrowth)warnings.push('rgb-edge-rejection-spike');
  const ba=Number(b.alvaSwitches?.rejected||0),ca=Number(c.alvaSwitches?.rejected||0);
  if(ca>ba+4)warnings.push('alva-edge-rejection-spike');
  const reprojGain=finite(bR)&&finite(cR)?clamp((bR-cR)/Math.max(.25,bR),-.5,.5):0;
  const energyGain=normalizedEnergyGain(b,c);
  const depthGain=finite(bD)&&finite(cD)?clamp((bD-cD)/Math.max(.03,bD),-.5,.5):0;
  const switchPenalty=.025*Math.max(0,cr-br)+.012*Math.max(0,ca-ba);
  const jumpPenalty=pose.commonFrames?clamp(pose.meanTranslation/Math.max(1e-6,cfg.maxMeanTranslationJump),0,2)*.05+clamp(pose.meanRotationRad/Math.max(1e-6,cfg.maxMeanRotationJumpRad),0,2)*.05:0;
  const score=.64*reprojGain+.22*energyGain+.14*depthGain-switchPenalty-jumpPenalty;
  // A candidate need not improve every scalar: when new evidence arrives it is
  // acceptable to be nearly neutral.  Hard physical/visual sanity limits are
  // the decisive gate; the score is exposed for diagnostics and hysteresis.
  const accepted=hard.length===0 && (score>=-.12 || !baselineSnapshot);
  return {accepted,score,hardReasons:hard,warnings,poseDelta:pose,metrics:{baselineReprojectionPx:finite(bR)?bR:null,candidateReprojectionPx:finite(cR)?cR:null,baselineDeepError:finite(bD)?bD:null,candidateDeepError:finite(cD)?cD:null,baselineRejectedRgb:br,candidateRejectedRgb:cr,baselineRejectedAlva:ba,candidateRejectedAlva:ca,normalizedEnergyGain:energyGain,reprojectionGain:reprojGain,depthGain}};
}

export function poseSnapshotDelta(a,b){
  const am=new Map((a?.frames||[]).map(f=>[String(f.frameId),f.poseEstimate])),bm=new Map((b?.frames||[]).map(f=>[String(f.frameId),f.poseEstimate]));let n=0,st=0,sr=0,mt=0,mr=0;
  for(const [id,pa] of am){const pb=bm.get(id);if(!validPose(pa)||!validPose(pb))continue;const t=Math.hypot(pb.p[0]-pa.p[0],pb.p[1]-pa.p[1],pb.p[2]-pa.p[2]),r=quatAngle(pa.q,pb.q);n++;st+=t;sr+=r;mt=Math.max(mt,t);mr=Math.max(mr,r);}
  return {commonFrames:n,meanTranslation:n?st/n:0,maxTranslation:mt,meanRotationRad:n?sr/n:0,maxRotationRad:mr};
}
function normalizedEnergyGain(b,c){const be=Number(b.energy),ce=Number(c.energy),bn=Math.max(1,Number(b.observations)||1),cn=Math.max(1,Number(c.observations)||1);if(!finite(be)||!finite(ce))return 0;const x=be/bn,y=ce/cn;return clamp((x-y)/Math.max(.05,x),-.5,.5);}
function validPose(p){return Array.isArray(p?.p)&&p.p.length>=3&&p.p.every(Number.isFinite)&&Array.isArray(p?.q)&&p.q.length>=4&&p.q.every(Number.isFinite);}
function quatAngle(a,b){let d=Math.abs((+a[0]||0)*(+b[0]||0)+(+a[1]||0)*(+b[1]||0)+(+a[2]||0)*(+b[2]||0)+(+a[3]||0)*(+b[3]||0));d=clamp(d,0,1);return 2*Math.acos(d);}
