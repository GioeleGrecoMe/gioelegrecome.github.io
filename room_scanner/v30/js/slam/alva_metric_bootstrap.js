import {qConj,qMul,qNormalize,qRotate} from './math.js?v=30.52.0';

/**
 * One-shot Sim(3) bootstrap from AlvaAR coordinates to the metric room frame.
 *
 * Calibration is deliberately consumed only here. After lock, the returned
 * similarity transform is immutable and the runtime camera pose comes only
 * from AlvaAR. This prevents calibration/template noise from feeding back into
 * the SLAM trajectory.
 */
export class AlvaMetricBootstrap{
  constructor({minSamples=5,minMetricBaselineM=.07,maxPositionRmseM=.035,maxOrientationRmseRad=.16}={}){
    this.minSamples=minSamples;this.minMetricBaselineM=minMetricBaselineM;this.maxPositionRmseM=maxPositionRmseM;this.maxOrientationRmseRad=maxOrientationRmseRad;this.samples=[];this.result=null;
  }
  reset(){this.samples=[];this.result=null;}
  add(rawPose,metricPose,at=performance.now()){
    if(!validPose(rawPose)||!validPose(metricPose))return this.status();
    const prev=this.samples[this.samples.length-1];
    if(prev&&distance(prev.metric.p,metricPose.p)<.008&&quatAngle(prev.metric.q,metricPose.q)<.01)return this.status();
    this.samples.push({raw:clonePose(rawPose),metric:clonePose(metricPose),at});if(this.samples.length>40)this.samples.shift();
    this.result=fitSimilarity(this.samples,{minSamples:this.minSamples,minMetricBaselineM:this.minMetricBaselineM,maxPositionRmseM:this.maxPositionRmseM,maxOrientationRmseRad:this.maxOrientationRmseRad});
    return this.status();
  }
  status(){const span=maxPairDistance(this.samples.map(s=>s.metric.p));return {ready:!!this.result,samples:this.samples.length,metricBaselineM:span,result:this.result};}
}

export function fitSimilarity(samples,{minSamples=5,minMetricBaselineM=.07,maxPositionRmseM=.035,maxOrientationRmseRad=.16}={}){
  const xs=(samples||[]).filter(s=>validPose(s?.raw)&&validPose(s?.metric));if(xs.length<minSamples)return null;
  const scaleRatios=[];
  for(let i=0;i<xs.length;i++)for(let j=i+1;j<xs.length;j++){
    const dr=distance(xs[i].raw.p,xs[j].raw.p),dm=distance(xs[i].metric.p,xs[j].metric.p);
    if(dm>=.012&&dr>1e-6){const s=dm/dr;if(Number.isFinite(s)&&s>1e-4&&s<1e4)scaleRatios.push(s);}
  }
  const metricBaselineM=maxPairDistance(xs.map(s=>s.metric.p));if(metricBaselineM<minMetricBaselineM||scaleRatios.length<3)return null;
  const scale=robustMedian(scaleRatios),qAlign=averageQuaternions(xs.map(s=>qNormalize(qMul(s.metric.q,qConj(s.raw.q)))));
  const rawC=centroid(xs.map(s=>s.raw.p)),metricC=centroid(xs.map(s=>s.metric.p)),rotRaw=qRotate(qAlign,rawC.map(v=>v*scale)),translation=metricC.map((v,i)=>v-rotRaw[i]);
  const posErrors=[],angErrors=[];
  for(const s of xs){const p=applySimilarityPoint({scale,qAlign,translation},s.raw.p);posErrors.push(distance(p,s.metric.p));const q=qNormalize(qMul(qAlign,s.raw.q));angErrors.push(quatAngle(q,s.metric.q));}
  const positionRmseM=rms(posErrors),orientationRmseRad=rms(angErrors);
  if(!Number.isFinite(scale)||positionRmseM>maxPositionRmseM||orientationRmseRad>maxOrientationRmseRad)return null;
  return {scale,qAlign,translation,positionRmseM,orientationRmseRad,metricBaselineM,samples:xs.length,source:'one-shot-alva-metric-sim3'};
}
export function applySimilarityPose(sim,raw){return {p:applySimilarityPoint(sim,raw.p),q:qNormalize(qMul(sim.qAlign,raw.q))};}
export function applySimilarityPoint(sim,p){const r=qRotate(sim.qAlign,p.map(v=>v*sim.scale));return r.map((v,i)=>v+sim.translation[i]);}

function averageQuaternions(qs){if(!qs.length)return [0,0,0,1];const ref=qs[0],sum=[0,0,0,0];for(const q0 of qs){let q=qNormalize(q0);if(dot4(q,ref)<0)q=q.map(v=>-v);for(let i=0;i<4;i++)sum[i]+=q[i];}return qNormalize(sum);}
function robustMedian(a){const b=a.filter(Number.isFinite).sort((x,y)=>x-y);if(!b.length)return NaN;const trim=b.length>=10?Math.floor(b.length*.12):0,c=trim?b.slice(trim,b.length-trim):b,m=c.length>>1;return c.length%2?c[m]:(c[m-1]+c[m])/2;}
function centroid(ps){const n=ps.length||1,s=[0,0,0];for(const p of ps)for(let i=0;i<3;i++)s[i]+=p[i];return s.map(v=>v/n);}
function maxPairDistance(ps){let m=0;for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++)m=Math.max(m,distance(ps[i],ps[j]));return m;}
function distance(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);}
function quatAngle(a,b){const d=Math.min(1,Math.abs(dot4(qNormalize(a),qNormalize(b))));return 2*Math.acos(d);}
function dot4(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3];}
function rms(a){return Math.sqrt(a.reduce((s,v)=>s+v*v,0)/Math.max(1,a.length));}
function clonePose(p){return {p:p.p.slice(0,3).map(Number),q:qNormalize(p.q.slice(0,4).map(Number))};}
function validPose(p){return Array.isArray(p?.p)&&p.p.length>=3&&Array.isArray(p?.q)&&p.q.length>=4&&[...p.p,...p.q].every(Number.isFinite);}
