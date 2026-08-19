import {backproject,fitPlaneRansac,median} from '../slam/math.js';

function linFit(pairs,transform){if(pairs.length<4)return null;const xs=pairs.map(p=>transform(p.raw)),ys=pairs.map(p=>p.z);const mx=xs.reduce((a,b)=>a+b,0)/xs.length,my=ys.reduce((a,b)=>a+b,0)/ys.length;let num=0,den=0;for(let i=0;i<xs.length;i++){num+=(xs[i]-mx)*(ys[i]-my);den+=(xs[i]-mx)**2;}if(den<1e-10)return null;const a=num/den,b=my-a*mx;const residuals=pairs.map((p,i)=>Math.abs(a*xs[i]+b-ys[i]));return {a,b,mode:transform===inv?'inverse':'direct',medianError:median(residuals)};}
const inv=x=>1/Math.max(1e-6,x),direct=x=>x;

export function calibrateDepthFromAnchors(rawDepth,width,height,anchors){
 const pairs=[];for(const a of anchors||[]){const x=Math.max(0,Math.min(width-1,Math.round(a.u*width))),y=Math.max(0,Math.min(height-1,Math.round(a.v*height))),raw=rawDepth[y*width+x];if(Number.isFinite(raw)&&raw>1e-6&&Number.isFinite(a.z)&&a.z>0.05)pairs.push({raw,z:a.z});}
 if(pairs.length<6)return null;const c=[linFit(pairs,direct),linFit(pairs,inv)].filter(Boolean).filter(m=>m.a>0&&Number.isFinite(m.a)&&Number.isFinite(m.b));if(!c.length)return null;c.sort((a,b)=>a.medianError-b.medianError);return {...c[0],anchors:pairs.length,confidence:Math.max(0,Math.min(1,1-c[0].medianError/0.25))};
}

export function estimateFloorScale(rawDepth,width,height,K,cameraHeightM=1.35){
 const candidates=[];for(const mode of ['direct','inverse']){const points=[];const step=Math.max(3,Math.round(width/90));for(let y=Math.floor(height*.42);y<height-2;y+=step){for(let x=Math.floor(width*.08);x<width*.92;x+=step){const r=rawDepth[y*width+x];if(!Number.isFinite(r)||r<=1e-6)continue;const z=mode==='direct'?r:1/r;if(!Number.isFinite(z)||z<=0)continue;points.push(backproject((x+.5)*K.width/width,(y+.5)*K.height/height,z,K));}}
  if(points.length<80)continue;const plane=fitPlaneRansac(points,{iterations:100,threshold:Math.max(.012,median(points.map(p=>p[2]))*.018)});if(!plane||plane.count<50)continue;const dist=Math.abs(plane.d);if(dist<1e-5)continue;const inlierRatio=plane.count/points.length,scale=cameraHeightM/dist;candidates.push({mode,a:scale,b:0,plane,inlierRatio,confidence:Math.min(.85,inlierRatio*Math.max(0,1-plane.meanError/(dist*.05)))});}
 candidates.sort((a,b)=>b.confidence-a.confidence);return candidates[0]||null;
}

export function metricDepth(raw,cal){const x=cal?.mode==='inverse'?1/Math.max(1e-6,raw):raw;return (cal?.a??1)*x+(cal?.b??0);}
