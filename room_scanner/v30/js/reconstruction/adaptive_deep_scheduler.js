/*
 * V30.51 adaptive Deep selection.
 *
 * Deep is requested only for RGB/Alva frames that add geometric information.
 * The selector is deliberately independent from the neural model: it uses the
 * already-solved camera scaffold, RGB support and the reliability returned by
 * the single ProbabilisticJointOptimizer after every Deep tranche.
 */
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const finite=v=>Number.isFinite(+v)?+v:0;

function poseOf(r){return r?.optimizedPose?.p&&r?.optimizedPose?.q?r.optimizedPose:r?.pose;}
function quatAngle(a,b){if(!a||!b)return Math.PI;const d=Math.abs(finite(a[0])*finite(b[0])+finite(a[1])*finite(b[1])+finite(a[2])*finite(b[2])+finite(a[3])*finite(b[3]));return 2*Math.acos(clamp(d,-1,1));}
function yawOf(q){if(!q)return 0;const x=finite(q[0]),y=finite(q[1]),z=finite(q[2]),w=Number.isFinite(+q[3])?+q[3]:1;const fx=2*(x*z+w*y),fz=1-2*(x*x+y*y);return Math.atan2(fx,fz);}
function validRecord(r){const p=poseOf(r);return !!(r&&p?.p?.length>=3&&p?.q?.length>=4&&!r.trackingRejected&&!r.stability?.jumpSuspect&&!r.recoveryRejected);}
function qualityOf(r){const q=finite(r?.photoQuality?.stableQuality),detail=finite(r?.photoQuality?.detail),features=(r?.features?.length||0);return clamp(.58*q+.20*clamp((detail-3)/9)+.22*clamp(features/110));}
function bboxScale(rows){const ps=rows.map(poseOf).filter(Boolean).map(p=>p.p);if(!ps.length)return 1;let mn=[Infinity,Infinity,Infinity],mx=[-Infinity,-Infinity,-Infinity];for(const p of ps)for(let k=0;k<3;k++){mn[k]=Math.min(mn[k],p[k]);mx[k]=Math.max(mx[k],p[k]);}return Math.max(.18,Math.hypot(mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2])/7);}
function poseDistance(a,b,scale){const pa=poseOf(a),pb=poseOf(b);if(!pa||!pb)return 0;const tr=Math.hypot(pa.p[0]-pb.p[0],pa.p[1]-pb.p[1],pa.p[2]-pb.p[2]),rot=quatAngle(pa.q,pb.q);return clamp(.66*(tr/Math.max(.05,scale))+.34*(rot/.42),0,3);}
function timeNorm(rows,r){if(rows.length<2)return .5;const a=finite(rows[0]?.at),b=finite(rows.at(-1)?.at),t=finite(r?.at);return clamp((t-a)/Math.max(1,b-a));}
function nearestDistance(r,selected,scale){if(!selected?.length)return 1.5;let best=Infinity;for(const s of selected)best=Math.min(best,poseDistance(r,s,scale));return Number.isFinite(best)?best:0;}
function reliabilityMap(snapshot){const out=new Map(),rel=snapshot?.reliability;for(const r of rel?.frames||[])out.set(String(r.frameId),{confidence:clamp(finite(r.confidence)),cause:r.cause||null,regions:r.regions||[]});return out;}

export function selectGeometricPhotoSubset(rows,maxFrames=240){
  const xs=(rows||[]).filter(validRecord).sort((a,b)=>finite(a.at)-finite(b.at));if(xs.length<=maxFrames)return xs.slice();
  const scale=bboxScale(xs),picked=[],used=new Set();
  // Seed with the strongest image rather than simply the first frame.
  let seed=0,best=-Infinity;for(let i=0;i<xs.length;i++){const q=qualityOf(xs[i])+.08*(1-Math.abs(.5-timeNorm(xs,xs[i])));if(q>best){best=q;seed=i;}}
  picked.push(xs[seed]);used.add(seed);
  while(picked.length<maxFrames){let bi=-1,bs=-Infinity;for(let i=0;i<xs.length;i++){if(used.has(i))continue;const r=xs[i],nov=nearestDistance(r,picked,scale),tn=timeNorm(xs,r),edgeBonus=.10*Math.min(tn,1-tn),score=.68*clamp(nov/1.15)+.27*qualityOf(r)+edgeBonus;if(score>bs){bs=score;bi=i;}}if(bi<0)break;used.add(bi);picked.push(xs[bi]);}
  return picked.sort((a,b)=>finite(a.at)-finite(b.at));
}

export class AdaptiveDeepScheduler{
  constructor(rows,{initialBatch=16,nextBatch=8,maxDepthFrames=56,minMarginalScore=.34,yawBins=10,gridBins=10}={}){
    this.rows=(rows||[]).filter(validRecord).sort((a,b)=>finite(a.at)-finite(b.at));this.initialBatch=Math.max(4,initialBatch|0);this.nextBatch=Math.max(2,nextBatch|0);this.maxDepthFrames=Math.max(this.initialBatch,maxDepthFrames|0);this.minMarginalScore=clamp(minMarginalScore,0,1);this.yawBins=Math.max(4,yawBins|0);this.gridBins=Math.max(4,gridBins|0);this.scale=bboxScale(this.rows);this.round=0;this.lastMap=null;
  }
  attachOptimizedPoses(poseMap){for(const r of this.rows){const p=poseMap?.get?.(String(r.frameId));if(p?.p&&p?.q)r.optimizedPose={p:[...p.p],q:[...p.q]};}this.scale=bboxScale(this.rows);return this;}
  buildUncertainty(processedIds=new Set(),snapshot=null){
    const processed=this.rows.filter(r=>processedIds.has(String(r.frameId))),rel=reliabilityMap(snapshot),cells=this._cells(),cellStats=new Map();
    for(const r of processed){const k=this._cellKey(r,cells),rr=rel.get(String(r.frameId)),c=cellStats.get(k)||{coverage:0,confidence:0,count:0};c.coverage+=1;c.confidence+=rr?.confidence??.18;c.count++;cellStats.set(k,c);}
    const scores=[];for(const r of this.rows){const id=String(r.frameId);if(processedIds.has(id))continue;const k=this._cellKey(r,cells),c=cellStats.get(k),cellCoverage=c?clamp(c.coverage/2):0,cellConfidence=c?clamp(c.confidence/Math.max(1,c.count)):0,nov=clamp(nearestDistance(r,processed,this.scale)/1.25),localUncertainty=clamp(1-(.58*cellCoverage+.42*cellConfidence)),q=qualityOf(r),feature=clamp((r.features?.length||0)/120),score=clamp(.43*nov+.30*localUncertainty+.17*q+.10*feature);scores.push({frameId:id,score,novelty:nov,localUncertainty,quality:q,featureSupport:feature,cell:k,record:r});}
    scores.sort((a,b)=>b.score-a.score);const top=scores.slice(0,Math.max(1,Math.ceil(scores.length*.25))),globalUncertainty=top.length?top.reduce((s,x)=>s+x.score,0)/top.length:0;
    const out={scores,globalUncertainty,processed:processed.length,candidates:scores.length,cells:this._serializeCells(cells,cellStats)};this.lastMap=out;return out;
  }
  next(processedIds=new Set(),snapshot=null){
    const map=this.buildUncertainty(processedIds,snapshot),remaining=Math.max(0,this.maxDepthFrames-processedIds.size),count=Math.min(remaining,this.round===0?this.initialBatch:this.nextBatch);if(count<=0)return {records:[],stopReason:'max-depth-frames',map,marginalScore:0,round:this.round};
    const chosen=[],chosenIds=new Set();for(const s of map.scores){if(chosen.length>=count)break;let redundancy=0;if(chosen.length)redundancy=clamp(1-nearestDistance(s.record,chosen,this.scale)/.7);const adjusted=s.score*(1-.48*redundancy);if(adjusted<this.minMarginalScore&&this.round>0)continue;chosen.push(s.record);chosenIds.add(s.frameId);}
    const marginal=chosen.length?map.scores.filter(x=>chosenIds.has(x.frameId)).reduce((s,x)=>s+x.score,0)/chosen.length:0,stopReason=!chosen.length?'marginal-gain-low':null,round=this.round++;
    return {records:chosen,stopReason,map,marginalScore:marginal,round};
  }
  _cells(){const ps=this.rows.map(poseOf).filter(Boolean).map(p=>p.p);let minX=0,maxX=1,minZ=0,maxZ=1;if(ps.length){minX=Math.min(...ps.map(p=>p[0]));maxX=Math.max(...ps.map(p=>p[0]));minZ=Math.min(...ps.map(p=>p[2]));maxZ=Math.max(...ps.map(p=>p[2]));}return {minX,maxX,minZ,maxZ,gridBins:this.gridBins,yawBins:this.yawBins};}
  _cellKey(r,c){const p=poseOf(r),gx=clamp(Math.floor((p.p[0]-c.minX)/Math.max(1e-6,c.maxX-c.minX)*c.gridBins),0,c.gridBins-1),gz=clamp(Math.floor((p.p[2]-c.minZ)/Math.max(1e-6,c.maxZ-c.minZ)*c.gridBins),0,c.gridBins-1),yaw=(yawOf(p.q)+Math.PI)/(2*Math.PI),gy=clamp(Math.floor(yaw*c.yawBins),0,c.yawBins-1);return `${gx}|${gz}|${gy}`;}
  _serializeCells(c,stats){const out=[];for(const [key,v] of stats){const [x,z,yaw]=key.split('|').map(Number);out.push({x,z,yaw,count:v.count,confidence:v.count?v.confidence/v.count:0});}return {bounds:c,cells:out};}
}
