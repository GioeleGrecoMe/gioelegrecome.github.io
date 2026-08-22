/**
 * Build the dense post-scan plan from the complete sharp-photo archive.
 *
 * Acquisition intentionally keeps plane sweep off the camera/Alva lane.  The
 * old implementation retained only the handful of sparse jobs that happened
 * to fit in that lane, which made a 50-photo scan look like a five-view scan.
 * This planner is deliberately deterministic and records why a photo was not
 * eligible, so the wall baseline can be diagnosed from the exported log.
 */
const finite=v=>Number.isFinite(Number(v));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function poseOk(f){return !!(f?.pose?.p?.length>=3&&f?.pose?.q?.length>=4);}
function distance(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);}
function quaternionAngle(a,b){
  const d=Math.abs(Number(a[0])*Number(b[0])+Number(a[1])*Number(b[1])+Number(a[2])*Number(b[2])+Number(a[3])*Number(b[3]));
  return 2*Math.acos(clamp(d,-1,1));
}
function quality(f){
  const q=f?.photoQuality||{};
  return (Number(q.stableQuality)||0)*3+(Number(q.detail)||0)*.04+(Array.isArray(f?.features)?f.features.length:0)*.002;
}
function cloneFrame(f){
  return {...f,pose:{p:[...f.pose.p],q:[...f.pose.q]},poseCov:f.poseCov?{...f.poseCov,diag:Array.isArray(f.poseCov.diag)?[...f.poseCov.diag]:f.poseCov.diag}:null,K:{...f.K},gray:new Uint8Array(f.gray),rgba:new Uint8ClampedArray(f.rgba),features:(f.features||[]).map(x=>({...x,desc:Array.from(x.desc||[]),referenceDesc:Array.from(x.referenceDesc||x.desc||[])}))};
}

function chooseReferences(frames,maxJobs){
  if(frames.length<=maxJobs)return frames.slice();
  const out=[],used=new Set();
  for(let i=0;i<maxJobs;i++){
    const lo=Math.floor(i*frames.length/maxJobs),hi=Math.max(lo+1,Math.floor((i+1)*frames.length/maxJobs));
    let best=null;
    for(let j=lo;j<hi;j++)if(!used.has(j)&&(!best||quality(frames[j])>quality(best.frame)))best={frame:frames[j],index:j};
    if(best){out.push(best.frame);used.add(best.index);}
  }
  return out;
}

function chooseSources(ref,frames,{minSources,maxSources,minBaseline,maxBaseline,maxAngleRad}){
  const candidates=[];
  for(const source of frames){
    if(source===ref||String(source.frameId)===String(ref.frameId))continue;
    const baseline=distance(ref.pose.p,source.pose.p),angle=quaternionAngle(ref.pose.q,source.pose.q);
    if(!finite(baseline)||baseline<minBaseline||baseline>maxBaseline||angle>maxAngleRad)continue;
    const normalized=baseline/Math.max(minBaseline,maxBaseline);
    candidates.push({source,baseline,angle,score:quality(source)+normalized*1.2-angle/Math.max(.01,maxAngleRad)*.35});
  }
  candidates.sort((a,b)=>b.score-a.score);
  const picked=[];
  for(const c of candidates){
    // Retain views at distinct baselines instead of four nearly identical
    // photographs.  This is particularly important for a wall scan.
    if(picked.some(x=>Math.abs(x.baseline-c.baseline)<minBaseline*.45&&quaternionAngle(x.source.pose.q,c.source.pose.q)<.045))continue;
    picked.push(c);
    if(picked.length>=maxSources)break;
  }
  return picked.length>=minSources?picked:null;
}

export function buildPostScanArchiveMvsPlan(inputFrames=[],options={}){
  const minSources=Math.max(2,Number(options.minSources)||2),maxSources=Math.max(minSources,Number(options.maxSources)||4),maxJobs=Math.max(1,Number(options.maxJobs)||36),minBaseline=Math.max(.0001,Number(options.minBaseline)||.014),maxBaseline=Math.max(minBaseline*1.5,Number(options.maxBaseline)||1.5),maxAngleRad=Math.max(.02,Number(options.maxAngleRad)||.38);
  const rejected={missingRaster:0,missingPose:0,jumpSuspect:0,trackingInvalid:0};
  const eligible=[];
  for(const f of inputFrames||[]){
    if(!f?.gray?.length||!f?.rgba?.length||!f?.K){rejected.missingRaster++;continue;}
    if(!poseOk(f)){rejected.missingPose++;continue;}
    if(f?.stability?.jumpSuspect){rejected.jumpSuspect++;continue;}
    if(f.trackingValid===false){rejected.trackingInvalid++;continue;}
    eligible.push(f);
  }
  const chronological=eligible.slice().sort((a,b)=>(Number(a.at)||0)-(Number(b.at)||0));
  const references=chooseReferences(chronological,maxJobs),jobs=[];let noUsableSources=0,totalSources=0;
  for(const ref of references){
    const selected=chooseSources(ref,chronological,{minSources,maxSources,minBaseline,maxBaseline,maxAngleRad});
    if(!selected){noUsableSources++;continue;}
    totalSources+=selected.length;
    jobs.push({ref:cloneFrame(ref),sources:selected.map(x=>cloneFrame(x.source)),baselines:selected.map(x=>x.baseline),angles:selected.map(x=>x.angle)});
  }
  return {jobs,stats:{input:inputFrames?.length||0,eligible:chronological.length,references:references.length,planned:jobs.length,noUsableSources,meanSources:jobs.length?totalSources/jobs.length:0,minSources,maxSources,minBaseline,maxBaseline,maxAngleRad,rejected}};
}
