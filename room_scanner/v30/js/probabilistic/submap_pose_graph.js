import {qMul,qNormalize,qRotate,qConj} from '../slam/math.js?v=30.46.0';
import {relativePose,relativeResidual} from './alva_switchable_edges.js?v=30.46.0';
import {estimatePhotoTranslationDirection,alignTranslationLine,translationLineAngle} from './rgb_translation_direction.js?v=30.46.0';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

/**
 * Rigid graph over already fused local submaps.
 *
 * RGB still never fabricates metric translation magnitude. V30.43 adds the
 * monocular quantity RGB CAN observe: translation direction from pair matches.
 * Alva/metric priors retain magnitude; RGB bearing constraints can bend a
 * drifting chain back toward the visual trajectory and provide loop closure in
 * translation direction.
 */
export class SubmapPoseGraph{
  constructor(submaps,frames,{photoEdges=[],edgeModel=null,primaryMap=null}={}){
    this.submaps=submaps||[];this.frames=frames||[];this.frameMap=new Map(this.frames.map(f=>[String(f.frameId),f]));this.primary=primaryMap instanceof Map?new Map(primaryMap):new Map();
    if(!this.primary.size)for(let si=0;si<this.submaps.length;si++)for(const id of this.submaps[si].frameIds||[])if(!this.primary.has(String(id)))this.primary.set(String(id),si);
    this.nodes=this.submaps.map(s=>({id:s.id,pose:clonePose(s.anchorPose),prior:clonePose(s.anchorPose)}));this.edges=[];this.buildEdges(photoEdges,edgeModel);
  }
  buildEdges(photoEdges,edgeModel){
    for(let i=0;i+1<this.nodes.length;i++)this.addEdge(i,i+1,relativePose(this.nodes[i].prior,this.nodes[i+1].prior),.30,'adjacent',{translation:true,rotation:true});
    for(const e of photoEdges||[]){
      const aId=String(e.aId??e.a),bId=String(e.bId??e.b),a=this.primary.get(aId),b=this.primary.get(bId);if(a==null||b==null||a===b)continue;
      const w=edgeModel?.pairWeight?.(aId,bId)??e.visualConfidence??.2;if(w<.12)continue;
      const fa=this.frameMap.get(aId),fb=this.frameMap.get(bId),hasRotation=Array.isArray(e.rotationBToA)&&e.rotationBToA.length===9,dir=fa&&fb?estimatePhotoTranslationDirection(e,fa,fb):null;
      if(!hasRotation&&!dir)continue;
      const obs={p:[0,0,0],q:hasRotation?quatFromMat(e.rotationBToA):[0,0,0,1],translationDirectionLocal:null};
      if(dir){const world=qRotate(fa.poseEstimate?.q||fa.posePrior.q,dir.direction),anchor=this.nodes[a].prior;obs.translationDirectionLocal=qRotate(qConj(anchor.q),world);obs.directionConfidence=dir.confidence;obs.directionParallaxRad=dir.medianParallaxRad;obs.directionMatches=dir.matchesUsed;}
      this.addEdge(a,b,obs,clamp(w,.05,1),e.loop?'loop':'photo',{translation:false,rotation:hasRotation,translationDirection:!!dir});
    }
  }
  addEdge(a,b,observed,weight,type,observes={translation:true,rotation:true,translationDirection:false}){const key=a<b?`${a}|${b}|${type}`:`${b}|${a}|${type}`;if(this.edges.some(e=>e.key===key))return;this.edges.push({key,a,b,observed,weight,type,observes:{translation:observes.translation!==false,rotation:observes.rotation!==false,translationDirection:!!observes.translationDirection}});}
  optimize(iterations=10){
    if(this.nodes.length<2)return this;
    for(let it=0;it<iterations;it++)for(let i=1;i<this.nodes.length;i++){
      const incident=this.edges.filter(e=>e.a===i||e.b===i);if(!incident.length)continue;let dt=[0,0,0],dr=[0,0,0],swt=0,swr=0;
      for(const e of incident){
        const A=this.nodes[e.a],B=this.nodes[e.b],pred=relativePose(A.pose,B.pose),r=relativeResidual(e.observed,pred),sgn=e.b===i?1:-1,te=e.observes.translation?Math.hypot(...r.slice(0,3)):0,re=e.observes.rotation?Math.hypot(...r.slice(3)):0,w=e.weight/(1+(te/.12)**2+(re/.08)**2);
        if(e.observes.translation){for(let k=0;k<3;k++)dt[k]+=sgn*w*r[k];swt+=w;}
        if(e.observes.translationDirection&&e.observed.translationDirectionLocal){const delta=[B.pose.p[0]-A.pose.p[0],B.pose.p[1]-A.pose.p[1],B.pose.p[2]-A.pose.p[2]],baseline=Math.hypot(...delta);if(baseline>1e-5){const predW=delta.map(x=>x/baseline),rawObs=norm(qRotate(A.pose.q,e.observed.translationDirectionLocal)),obsW=alignTranslationLine(rawObs,predW),cos=clamp(Math.abs(dot(predW,obsW)),0,1),ang=translationLineAngle(predW,obsW),perp=[predW[0]-obsW[0]*cos,predW[1]-obsW[1]*cos,predW[2]-obsW[2]*cos],wd=w*clamp(Number(e.observed.directionConfidence)||.1,.05,1)/(1+(ang/.16)**2);for(let k=0;k<3;k++)dt[k]+=sgn*wd*baseline*perp[k];swt+=wd;}}
        if(e.observes.rotation){for(let k=0;k<3;k++)dr[k]+=sgn*w*r[k+3];swr+=w;}
      }
      const d=[...(swt>0?dt.map(x=>-x/swt*.20):[0,0,0]),...(swr>0?dr.map(x=>-x/swr*.24):[0,0,0])],n=this.nodes[i];n.pose=perturb(n.pose,d);
    }
    return this;
  }
  apply(){for(let i=0;i<this.submaps.length;i++)this.submaps[i].anchorPose=clonePose(this.nodes[i].pose);return this;}
  stats(){let loop=0,res=0,w=0,translationObservedEdges=0,rotationOnlyEdges=0,translationDirectionEdges=0,dirRes=0,dirW=0;for(const e of this.edges){if(e.type==='loop')loop++;if(e.observes.translation)translationObservedEdges++;if(e.observes.translationDirection)translationDirectionEdges++;if(!e.observes.translation&&!e.observes.translationDirection)rotationOnlyEdges++;const r=relativeResidual(e.observed,relativePose(this.nodes[e.a].pose,this.nodes[e.b].pose)),q=(e.observes.translation?Math.hypot(...r.slice(0,3)):0)+(e.observes.rotation?Math.hypot(...r.slice(3)):0);res+=e.weight*q;w+=e.weight;if(e.observes.translationDirection&&e.observed.translationDirectionLocal){const A=this.nodes[e.a],B=this.nodes[e.b],delta=[B.pose.p[0]-A.pose.p[0],B.pose.p[1]-A.pose.p[1],B.pose.p[2]-A.pose.p[2]],n=Math.hypot(...delta);if(n>1e-6){const pred=delta.map(x=>x/n),obs=norm(qRotate(A.pose.q,e.observed.translationDirectionLocal)),a=translationLineAngle(pred,obs),ww=e.weight*(e.observed.directionConfidence||.1);dirRes+=ww*a;dirW+=ww;}}}return {nodes:this.nodes.length,edges:this.edges.length,loops:loop,translationObservedEdges,translationDirectionEdges,rotationOnlyEdges,photoTranslationFabricated:false,meanResidual:w?res/w:0,meanTranslationDirectionResidualDeg:dirW?dirRes/dirW*180/Math.PI:null};}
}
function clonePose(p){return {p:p.p.slice(0,3).map(Number),q:qNormalize(p.q.slice(0,4).map(Number))};}
function perturb(p,d){const out={p:[p.p[0]+d[0],p.p[1]+d[1],p.p[2]+d[2]],q:p.q.slice()},a=d.slice(3),ang=Math.hypot(...a);if(ang>1e-12){const s=Math.sin(ang/2)/ang,dq=[a[0]*s,a[1]*s,a[2]*s,Math.cos(ang/2)];out.q=qNormalize(qMul(out.q,dq));}return out;}
function quatFromMat(R){const tr=R[0]+R[4]+R[8];let q;if(tr>0){const s=Math.sqrt(tr+1)*2;q=[(R[7]-R[5])/s,(R[2]-R[6])/s,(R[3]-R[1])/s,.25*s];}else if(R[0]>R[4]&&R[0]>R[8]){const s=Math.sqrt(1+R[0]-R[4]-R[8])*2;q=[.25*s,(R[1]+R[3])/s,(R[2]+R[6])/s,(R[7]-R[5])/s];}else if(R[4]>R[8]){const s=Math.sqrt(1+R[4]-R[0]-R[8])*2;q=[(R[1]+R[3])/s,.25*s,(R[5]+R[7])/s,(R[2]-R[6])/s];}else{const s=Math.sqrt(1+R[8]-R[0]-R[4])*2;q=[(R[2]+R[6])/s,(R[5]+R[7])/s,.25*s,(R[3]-R[1])/s];}return qNormalize(q);}
function norm(v){const n=Math.hypot(...v)||1;return v.map(x=>x/n);}function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
