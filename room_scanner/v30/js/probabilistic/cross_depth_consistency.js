import {projectPoint,pixelRay,qRotate} from '../slam/math.js?v=30.54.0';
import {predictMetricDepth} from './depth_calibration_hierarchy.js?v=30.54.0';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

/**
 * Dense cross-view gate used only after sparse geometry has calibrated Deep.
 * The result is categorical on purpose: incompatible surfaces are not averaged.
 */
export class DenseDepthConsistencyEvaluator{
  constructor({frames=[],deepFactors=[],calibration=null,photoEdges=[],edgeModel=null,maxNeighbors=4,kSigma=2.8}={}){this.frames=frames;this.frameMap=new Map(frames.map((f,i)=>[String(f.frameId),i]));this.deepMap=new Map((deepFactors||[]).map(d=>[String(d.frameId),d]));this.calibration=calibration;this.calMap=new Map((calibration?.frames||[]).map(s=>[String(s.frameId),s]));this.edgeModel=edgeModel;this.maxNeighbors=maxNeighbors;this.kSigma=kSigma;this.adj=new Map();for(const e of photoEdges||[]){const a=String(e.aId??e.a),b=String(e.bId??e.b),w=edgeModel?.pairWeight?.(a,b)??clamp(Number(e.switch??e.visualConfidence??e.weight??.2),.02,1);if(!this.frameMap.has(a)||!this.frameMap.has(b))continue;for(const [x,y] of [[a,b],[b,a]]){const q=this.adj.get(x)||[];q.push({id:y,w});q.sort((m,n)=>n.w-m.w);if(q.length>maxNeighbors*2)q.length=maxNeighbors*2;this.adj.set(x,q);}}}
  evaluate(frameId,u,v,z,{sigmaDepth=null}={}){
    const id=String(frameId),fi=this.frameMap.get(id),f=this.frames[fi],d=this.deepMap.get(id),cal=this.calMap.get(id);if(fi==null||!f||!d||!cal||!(z>0))return unknown();
    const edgeQ=structuralConfidence(d,u,v,f.K.width||f.width,f.K.height||f.height),srcSigma=Math.max(.006,Number(sigmaDepth)||depthSigma(cal,z,f.poseCov)),p=unproject(f.poseEstimate||f.posePrior,f.K,u,v,z),neighbors=(this.adj.get(id)||[]).slice(0,this.maxNeighbors);let support=0,conflict=0,occluded=0,used=0,score=0,conflictScore=0;const residuals=[],supportIds=[],supportAngles=[];
    for(const n of neighbors){const j=this.frameMap.get(n.id),g=this.frames[j],dj=this.deepMap.get(n.id),cj=this.calMap.get(n.id);if(j==null||!g||!dj||!cj)continue;const q=projectPoint(g.poseEstimate||g.posePrior,g.K,p);if(!q||!(q.z>.05)||q.u<1||q.v<1||q.u>(g.K.width||g.width)-2||q.v>(g.K.height||g.height)-2)continue;const raw=sampleDeepGrid(dj,q.u,q.v,g.K.width||g.width,g.K.height||g.height),zj=predictMetricDepth(cj,raw,this.calibration);if(!(zj>.05&&zj<30))continue;used++;const cEdge=structuralConfidence(dj,q.u,q.v,g.K.width||g.width,g.K.height||g.height),sigJ=depthSigma(cj,zj,g.poseCov),sig=Math.sqrt(srcSigma*srcSigma+sigJ*sigJ),gate=Math.max(.018,this.kSigma*sig),r=q.z-zj,w=n.w*Math.sqrt(edgeQ*cEdge);residuals.push(r);if(Math.abs(r)<=gate){support++;score+=w*Math.exp(-.5*(r/gate)**2);supportIds.push(String(n.id));supportAngles.push(triangulationAngle(f.poseEstimate||f.posePrior,g.poseEstimate||g.posePrior,p));}else if(r>gate){occluded++;score+=.20*w;}else{conflict++;conflictScore+=w*clamp(Math.abs(r)/gate,1,4);}}
    // Cross-view depth agreement is only independent when the camera rays have
    // enough triangulation angle. V30.42 classified two near-pure-rotation
    // neighbours as trusted and then used them to self-confirm bad metric depth.
    const independentSupport=supportAngles.filter(a=>a>Math.PI/180*1.0).length;
    let cls='unknown',weight=.12;if(support>=2&&independentSupport>=2&&conflict===0){cls='trusted';weight=clamp(.54+.15*support+.18*score,0,1);}else if(support>=1&&independentSupport>=1&&conflictScore<score*1.3){cls='weak';weight=clamp(.24+.20*support+.12*score,.12,.72);}else if(conflict>0&&conflictScore>Math.max(.25,score*1.2)){cls='conflicting';weight=.02;}else if(occluded>0&&conflict===0){cls='occluded';weight=.12;}else if(used>0){cls='weak';weight=.10;}
    weight*=edgeQ;return {class:cls,weight:clamp(weight,.005,1),support,independentSupport,supportIds,supportAngles,conflicts:conflict,occluded,used,structuralConfidence:edgeQ,sigmaDepth:srcSigma*(cls==='trusted'?.82:cls==='weak'?1.28:1.8),residualMedian:median(residuals),residualMad:mad(residuals)};
  }
}

export function depthStatusCode(x){return ({trusted:1,weak:2,conflicting:3,occluded:4,dynamic:5,unknown:0})[x]??0;}

function structuralConfidence(d,u,v,w,h){const raw=sampleDeepGrid(d,u,v,w,h);if(!Number.isFinite(raw))return .05;const du=Math.max(1,w/Math.max(20,d.cols)),dv=Math.max(1,h/Math.max(20,d.rows)),xm=sampleDeepGrid(d,u-du,v,w,h),xp=sampleDeepGrid(d,u+du,v,w,h),ym=sampleDeepGrid(d,u,v-dv,w,h),yp=sampleDeepGrid(d,u,v+dv,w,h),g=Math.hypot((xp-xm)*.5,(yp-ym)*.5),scale=Math.max(.02,Math.abs(raw)*.15);return clamp(1/(1+Math.pow(g/scale,1.35)),.06,1);}
function depthSigma(cal,z,poseCov){const rho=1/Math.max(.05,z),sigmaRho=Math.max(.002,Number(cal?.residualSigma)||rho*.08),net=sigmaRho/(rho*rho),t=Number(poseCov?.translationStd)||0,r=Number(poseCov?.rotationStdRad)||0;return Math.max(.008,Math.hypot(net,t,z*r));}
function unproject(pose,K,u,v,z){const d=pixelRay(K,u,v),cam=[d[0]/Math.max(1e-9,d[2])*z,d[1]/Math.max(1e-9,d[2])*z,z],w=qRotate(pose.q,cam);return [pose.p[0]+w[0],pose.p[1]+w[1],pose.p[2]+w[2]];}
function sampleDeepGrid(d,u,v,w,h){if(!d?.raw?.length)return NaN;const x=clamp(u/Math.max(1,w)*d.cols-.5,0,d.cols-1),y=clamp(v/Math.max(1,h)*d.rows-.5,0,d.rows-1),x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(d.cols-1,x0+1),y1=Math.min(d.rows-1,y0+1),tx=x-x0,ty=y-y0,a=d.raw;return (a[y0*d.cols+x0]*(1-tx)+a[y0*d.cols+x1]*tx)*(1-ty)+(a[y1*d.cols+x0]*(1-tx)+a[y1*d.cols+x1]*tx)*ty;}
function triangulationAngle(a,b,p){const u=[p[0]-a.p[0],p[1]-a.p[1],p[2]-a.p[2]],v=[p[0]-b.p[0],p[1]-b.p[1],p[2]-b.p[2]],nu=Math.hypot(...u)||1,nv=Math.hypot(...v)||1,c=clamp((u[0]*v[0]+u[1]*v[1]+u[2]*v[2])/(nu*nv),-1,1);return Math.acos(c);}
function median(a){const b=(a||[]).filter(Number.isFinite).sort((x,y)=>x-y);if(!b.length)return NaN;const m=b.length>>1;return b.length%2?b[m]:(b[m-1]+b[m])*.5;}
function mad(a){const m=median(a);return Number.isFinite(m)?median((a||[]).map(x=>Math.abs(x-m))):NaN;}
function unknown(){return {class:'unknown',weight:.04,support:0,independentSupport:0,supportIds:[],supportAngles:[],conflicts:0,occluded:0,used:0,structuralConfidence:.15,sigmaDepth:Infinity,residualMedian:NaN,residualMad:NaN};}
