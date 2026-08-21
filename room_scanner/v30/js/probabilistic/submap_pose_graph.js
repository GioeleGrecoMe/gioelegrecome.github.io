import {qMul,qConj,qNormalize,qRotate} from '../slam/math.js';
import {relativePose,relativeResidual} from './alva_switchable_edges.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

/** Rigid graph over already fused local submaps. No dense reintegration required. */
export class SubmapPoseGraph{
  constructor(submaps,frames,{photoEdges=[],edgeModel=null,primaryMap=null}={}){this.submaps=submaps||[];this.frames=frames||[];this.frameMap=new Map(this.frames.map(f=>[String(f.frameId),f]));this.primary=primaryMap instanceof Map?new Map(primaryMap):new Map();if(!this.primary.size)for(let si=0;si<this.submaps.length;si++)for(const id of this.submaps[si].frameIds||[])if(!this.primary.has(String(id)))this.primary.set(String(id),si);this.nodes=this.submaps.map(s=>({id:s.id,pose:clonePose(s.anchorPose),prior:clonePose(s.anchorPose)}));this.edges=[];this.buildEdges(photoEdges,edgeModel);}
  buildEdges(photoEdges,edgeModel){for(let i=0;i+1<this.nodes.length;i++)this.addEdge(i,i+1,relativePose(this.nodes[i].prior,this.nodes[i+1].prior),1,'adjacent');for(const e of photoEdges||[]){const a=this.primary.get(String(e.aId??e.a)),b=this.primary.get(String(e.bId??e.b));if(a==null||b==null||a===b)continue;const w=edgeModel?.pairWeight?.(String(e.aId??e.a),String(e.bId??e.b))??e.visualConfidence??.2;if(w<.12)continue;const obs=relativePose(this.nodes[a].prior,this.nodes[b].prior);if(Array.isArray(e.rotationBToA)&&e.rotationBToA.length===9)obs.q=quatFromMat(e.rotationBToA);this.addEdge(a,b,obs,clamp(w,.05,1),e.loop?'loop':'photo');}}
  addEdge(a,b,observed,weight,type){const key=a<b?`${a}|${b}|${type}`:`${b}|${a}|${type}`;if(this.edges.some(e=>e.key===key))return;this.edges.push({key,a,b,observed,weight,type});}
  optimize(iterations=8){if(this.nodes.length<2)return this;for(let it=0;it<iterations;it++){for(let i=1;i<this.nodes.length;i++){const incident=this.edges.filter(e=>e.a===i||e.b===i);if(!incident.length)continue;let dt=[0,0,0],dr=[0,0,0],sw=0;for(const e of incident){const A=this.nodes[e.a],B=this.nodes[e.b],pred=relativePose(A.pose,B.pose),r=relativeResidual(e.observed,pred),sgn=e.b===i?1:-1,w=e.weight/(1+(Math.hypot(...r.slice(0,3))/.12)**2+(Math.hypot(...r.slice(3))/.08)**2);for(let k=0;k<3;k++){dt[k]+=sgn*w*r[k];dr[k]+=sgn*w*r[k+3];}sw+=w;}if(sw<=0)continue;const d=[...dt.map(x=>-x/sw*.28),...dr.map(x=>-x/sw*.28)],n=this.nodes[i];n.pose=perturb(n.pose,d);}}
    return this;
  }
  apply(){for(let i=0;i<this.submaps.length;i++)this.submaps[i].anchorPose=clonePose(this.nodes[i].pose);return this;}
  stats(){let loop=0,res=0,w=0;for(const e of this.edges){if(e.type==='loop')loop++;const r=relativeResidual(e.observed,relativePose(this.nodes[e.a].pose,this.nodes[e.b].pose)),q=Math.hypot(...r.slice(0,3))+Math.hypot(...r.slice(3));res+=e.weight*q;w+=e.weight;}return {nodes:this.nodes.length,edges:this.edges.length,loops:loop,meanResidual:w?res/w:0};}
}
function clonePose(p){return {p:p.p.slice(0,3).map(Number),q:qNormalize(p.q.slice(0,4).map(Number))};}
function perturb(p,d){const out={p:[p.p[0]+d[0],p.p[1]+d[1],p.p[2]+d[2]],q:p.q.slice()},a=d.slice(3),ang=Math.hypot(...a);if(ang>1e-12){const s=Math.sin(ang/2)/ang,dq=[a[0]*s,a[1]*s,a[2]*s,Math.cos(ang/2)];out.q=qNormalize(qMul(out.q,dq));}return out;}
function quatFromMat(R){const tr=R[0]+R[4]+R[8];let q;if(tr>0){const s=Math.sqrt(tr+1)*2;q=[(R[7]-R[5])/s,(R[2]-R[6])/s,(R[3]-R[1])/s,.25*s];}else if(R[0]>R[4]&&R[0]>R[8]){const s=Math.sqrt(1+R[0]-R[4]-R[8])*2;q=[.25*s,(R[1]+R[3])/s,(R[2]+R[6])/s,(R[7]-R[5])/s];}else if(R[4]>R[8]){const s=Math.sqrt(1+R[4]-R[0]-R[8])*2;q=[(R[1]+R[3])/s,.25*s,(R[5]+R[7])/s,(R[2]-R[6])/s];}else{const s=Math.sqrt(1+R[8]-R[0]-R[4])*2;q=[(R[2]+R[6])/s,(R[5]+R[7])/s,.25*s,(R[3]-R[1])/s];}return qNormalize(q);}
