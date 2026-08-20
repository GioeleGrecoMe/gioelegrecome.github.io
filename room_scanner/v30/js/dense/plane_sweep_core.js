/**
 * CPU-friendly multi-view plane sweep used by the V30 dense mapper.
 *
 * Design goals:
 * - AlvaAR owns every camera pose. This module NEVER estimates camera motion.
 * - Work on downsampled keyframes in a Web Worker so tracking stays responsive.
 * - Use several source views and robust photometric aggregation instead of
 *   converting sparse SLAM features directly into geometry.
 * - Return only points with a clear depth minimum and multi-view agreement.
 *
 * Coordinate convention matches Room Scanner:
 *   camera/world +X right, +Y down, +Z forward (right-handed CV).
 */

const EPS=1e-9;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function estimateDenseDepth(job){
  const ref=job?.ref,sources=(job?.sources||[]).filter(Boolean),K=job?.K||ref?.K;
  if(!ref?.gray||!ref?.pose||!K||sources.length<1)throw new Error('plane sweep requires reference image, pose, K, and >=1 source');
  const width=ref.width|0,height=ref.height|0;
  if(width<16||height<16)throw new Error('plane sweep image too small');

  const cfg={
    near:Number(job.near??0.25),far:Number(job.far??8),depthSteps:Math.max(12,job.depthSteps|0||40),
    pixelStep:Math.max(1,job.pixelStep|0||3),margin:Math.max(2,job.margin|0||3),
    maxCost:Number(job.maxCost??0.22),minConfidence:Number(job.minConfidence??0.11),
    minViews:Math.max(1,job.minViews|0||Math.min(2,sources.length)),maxSamples:Math.max(500,job.maxSamples|0||14000),
    minTexture:Number(job.minTexture??0.018),minDistinctiveness:Number(job.minDistinctiveness??0.025),depthSmoothRel:Number(job.depthSmoothRel??0.16),seedRadiusPx:Number(job.seedRadiusPx??22),seedMaxRelativeError:Number(job.seedMaxRelativeError??0.48),
    // A calibrated Depth Anything map is a SEARCH PRIOR, never final geometry.
    // Every accepted point must still win the Alva-pose multi-view photo test.
    priorRelRange:Number(job.priorRelRange??0.18),priorDepthSteps:Math.max(8,job.priorDepthSteps|0||18),priorWeight:Number(job.priorWeight??0.10),priorMinConfidence:Number(job.priorMinConfidence??0.28),priorMinTexture:Number(job.priorMinTexture??0.006)
  };
  if(!(cfg.near>0&&cfg.far>cfg.near))throw new Error(`invalid plane sweep depth range ${cfg.near}..${cfg.far}`);
  const sparseSeeds=(job.sparseSeeds||[]).filter(s=>Number.isFinite(s?.u)&&Number.isFinite(s?.v)&&Number.isFinite(s?.depth)&&s.depth>0);
  const prior=job.depthPrior?.depth?.length===width*height?job.depthPrior:null;
  const priorConfidence=prior?clamp(Number(prior.confidence??0),0,1):0;

  const refGrad=gradients(ref.gray,width,height),src=sources.map(s=>({
    ...s,grad:gradients(s.gray,s.width|0,s.height|0),Rcw:rotationFromQuat(s.pose.q),Rwc:null
  }));
  const Rref=rotationFromQuat(ref.pose.q);
  const depthHyp=inverseDepths(cfg.near,cfg.far,cfg.depthSteps);
  const gridW=Math.floor((width-2*cfg.margin-1)/cfg.pixelStep)+1;
  const gridH=Math.floor((height-2*cfg.margin-1)/cfg.pixelStep)+1;
  const depthGrid=new Float32Array(gridW*gridH),confGrid=new Float32Array(gridW*gridH),costGrid=new Float32Array(gridW*gridH);costGrid.fill(1);
  const pxGrid=new Int16Array(gridW*gridH),pyGrid=new Int16Array(gridW*gridH);

  let gi=0;
  for(let gy=0;gy<gridH;gy++){
    const v=cfg.margin+gy*cfg.pixelStep;
    for(let gx=0;gx<gridW;gx++,gi++){
      const u=cfg.margin+gx*cfg.pixelStep;pxGrid[gi]=u;pyGrid[gi]=v;
      const refI=ref.gray[v*width+u]/255,refGx=refGrad.gx[v*width+u],refGy=refGrad.gy[v*width+u];
      const texture=Math.hypot(refGx,refGy),priorZ=prior?.depth?.[v*width+u]||0,hasPrior=priorZ>cfg.near&&priorZ<cfg.far&&priorConfidence>=cfg.priorMinConfidence;
      // Strong calibrated priors let us retain lower-texture furniture/walls, but
      // completely flat pixels are still rejected because they cannot be checked
      // against another Alva view.
      if(texture<(hasPrior?cfg.priorMinTexture:cfg.minTexture))continue;
      let best=Infinity,second=Infinity,bestZ=0,bestViews=0;
      const hypotheses=hasPrior?localDepths(priorZ,cfg.near,cfg.far,cfg.priorRelRange,cfg.priorDepthSteps):depthHyp;
      for(const z of hypotheses){
        const xc=(u-K.cx)/K.fx*z,yc=(v-K.cy)/K.fy*z;
        const wr=rotateMat(Rref,[xc,yc,z]);
        const world=[ref.pose.p[0]+wr[0],ref.pose.p[1]+wr[1],ref.pose.p[2]+wr[2]];
        const costs=[];
        for(const s of src){
          const pr=projectWorld(s.pose,s.K||K,world,s.width,s.height);
          if(!pr||pr.u<2||pr.v<2||pr.u>s.width-3||pr.v>s.height-3)continue;
          const si=bilinear(s.gray,s.width,s.height,pr.u,pr.v)/255;
          const sgx=bilinear(s.grad.gx,s.width,s.height,pr.u,pr.v),sgy=bilinear(s.grad.gy,s.width,s.height,pr.u,pr.v);
          // Illumination-robust lightweight cost. Intensity is dominant; image
          // gradients keep repeated flat regions from looking artificially good.
          const c=.68*Math.abs(refI-si)+.16*Math.abs(refGx-sgx)+.16*Math.abs(refGy-sgy);
          costs.push(c);
        }
        if(costs.length<cfg.minViews)continue;
        costs.sort((a,b)=>a-b);
        const keep=Math.min(costs.length,Math.max(cfg.minViews,2));
        let c=0;for(let i=0;i<keep;i++)c+=costs[i];c/=keep;
        // Keep the search close to the AI shape without letting the network win
        // against photometric evidence. The penalty is zero at the calibrated
        // prior and grows smoothly towards the local search boundary.
        if(hasPrior){const rel=Math.abs(Math.log(z/priorZ))/Math.max(.03,Math.log(1+cfg.priorRelRange));c+=cfg.priorWeight*clamp(rel,0,1.5);}
        if(c<best){second=best;best=c;bestZ=z;bestViews=costs.length;}else if(c<second)second=c;
      }
      if(!Number.isFinite(best)||!bestZ||bestViews<cfg.minViews)continue;
      const distinct=Number.isFinite(second)?clamp((second-best)/(Math.max(.025,second)),0,1):0;
      const photo=clamp(1-best/Math.max(.03,cfg.maxCost),0,1);
      const confidence=hasPrior?(.40*distinct+.34*photo+.26*priorConfidence):(.62*distinct+.38*photo);
      const minDistinct=hasPrior?cfg.minDistinctiveness*.42:cfg.minDistinctiveness;
      const maxCost=hasPrior?cfg.maxCost+cfg.priorWeight*.42:cfg.maxCost;
      if(best<=maxCost&&distinct>=minDistinct&&confidence>=cfg.minConfidence){
        const seed=findNearestSparseSeed(sparseSeeds,u,v,cfg.seedRadiusPx);
        if(seed&&Math.abs(bestZ-seed.depth)/Math.max(1e-6,seed.depth)>cfg.seedMaxRelativeError)continue;
        depthGrid[gi]=bestZ;confGrid[gi]=seed?Math.min(1,confidence*.78+Number(seed.confidence||.5)*.22):confidence;costGrid[gi]=best;
      }
    }
  }

  // Local consistency filter rejects isolated depth minima before fusion.
  const valid=new Uint8Array(depthGrid.length);
  for(let y=1;y<gridH-1;y++)for(let x=1;x<gridW-1;x++){
    const i=y*gridW+x,z=depthGrid[i];if(!z)continue;const ns=[];
    for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++){if(!xx&&!yy)continue;const d=depthGrid[(y+yy)*gridW+x+xx];if(d)ns.push(d);}
    if(ns.length<2){if(confGrid[i]>.30)valid[i]=1;continue;}
    ns.sort((a,b)=>a-b);const med=ns[ns.length>>1];if(Math.abs(z-med)/Math.max(.05,med)<=cfg.depthSmoothRel||confGrid[i]>.34)valid[i]=1;
  }

  const points=new Array(depthGrid.length);
  for(let i=0;i<depthGrid.length;i++)if(valid[i]){
    const z=depthGrid[i],u=pxGrid[i],v=pyGrid[i],xc=(u-K.cx)/K.fx*z,yc=(v-K.cy)/K.fy*z,wv=rotateMat(Rref,[xc,yc,z]);
    points[i]=[ref.pose.p[0]+wv[0],ref.pose.p[1]+wv[1],ref.pose.p[2]+wv[2]];
  }

  const samples=[];
  for(let y=1;y<gridH-1;y++)for(let x=1;x<gridW-1;x++){
    const i=y*gridW+x,p=points[i];if(!p)continue;
    const left=points[i-1],right=points[i+1],up=points[i-gridW],down=points[i+gridW];
    let n=null;if(left&&right&&up&&down){n=normalize(cross(sub(right,left),sub(down,up)));const toCam=normalize(sub(ref.pose.p,p));if(dot(n,toCam)<0)n=n.map(v=>-v);}
    if(!n)n=normalize(sub(ref.pose.p,p));
    const u=pxGrid[i],v=pyGrid[i],color=sampleRgb(ref.rgba,width,height,u,v),z=depthGrid[i];
    const radius=Math.max(.0025,z/Math.max(K.fx,K.fy)*cfg.pixelStep*1.35);
    samples.push({p,normal:n,color,confidence:confGrid[i],radius,depth:z,u,v,cost:costGrid[i]});
  }
  if(samples.length>cfg.maxSamples){
    const step=Math.ceil(samples.length/cfg.maxSamples),thin=[];for(let i=0;i<samples.length;i+=step)thin.push(samples[i]);samples.length=0;samples.push(...thin);
  }
  const depths=samples.map(s=>s.depth).sort((a,b)=>a-b);
  return {samples,width,height,gridW,gridH,validCount:samples.length,coverage:samples.length/Math.max(1,gridW*gridH),medianDepth:depths.length?depths[depths.length>>1]:null,near:cfg.near,far:cfg.far,sourceCount:sources.length};
}

export function projectWorld(pose,K,p,width=K.width,height=K.height){
  const R=rotationFromQuat(pose.q),dx=p[0]-pose.p[0],dy=p[1]-pose.p[1],dz=p[2]-pose.p[2];
  // camera coordinates = R^T * (world-camera)
  const x=R[0]*dx+R[3]*dy+R[6]*dz,y=R[1]*dx+R[4]*dy+R[7]*dz,z=R[2]*dx+R[5]*dy+R[8]*dz;
  if(z<=1e-5)return null;const u=K.fx*x/z+K.cx,v=K.fy*y/z+K.cy;if(!Number.isFinite(u+v))return null;return {u,v,z,inside:u>=0&&v>=0&&u<width&&v<height};
}

export function rotationFromQuat(q){
  let [x,y,z,w]=(q||[0,0,0,1]).map(Number),n=Math.hypot(x,y,z,w)||1;x/=n;y/=n;z/=n;w/=n;
  const xx=x*x,yy=y*y,zz=z*z,xy=x*y,xz=x*z,yz=y*z,wx=w*x,wy=w*y,wz=w*z;
  // Row-major camera-to-world rotation.
  return [1-2*(yy+zz),2*(xy-wz),2*(xz+wy),2*(xy+wz),1-2*(xx+zz),2*(yz-wx),2*(xz-wy),2*(yz+wx),1-2*(xx+yy)];
}
function rotateMat(R,v){return [R[0]*v[0]+R[1]*v[1]+R[2]*v[2],R[3]*v[0]+R[4]*v[1]+R[5]*v[2],R[6]*v[0]+R[7]*v[1]+R[8]*v[2]];}
function inverseDepths(near,far,n){const a=1/far,b=1/near,out=[];for(let i=0;i<n;i++){const t=i/(n-1);out.push(1/(a+(b-a)*t));}return out;}
function localDepths(prior,near,far,rel,n){const lo=Math.max(near,prior*(1-rel)),hi=Math.min(far,prior*(1+rel));if(!(hi>lo*1.002))return [clamp(prior,near,far)];return inverseDepths(lo,hi,n);}
function gradients(gray,w,h){const gx=new Float32Array(gray.length),gy=new Float32Array(gray.length);for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;gx[i]=(gray[i+1]-gray[i-1])/510;gy[i]=(gray[i+w]-gray[i-w])/510;}return {gx,gy};}
function bilinear(a,w,h,x,y){const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),tx=x-x0,ty=y-y0;return (a[y0*w+x0]*(1-tx)+a[y0*w+x1]*tx)*(1-ty)+(a[y1*w+x0]*(1-tx)+a[y1*w+x1]*tx)*ty;}
function sampleRgb(rgba,w,h,x,y){if(!rgba?.length)return [180,200,220];const xx=clamp(Math.round(x),0,w-1),yy=clamp(Math.round(y),0,h-1),i=(yy*w+xx)*4;return [rgba[i]||0,rgba[i+1]||0,rgba[i+2]||0];}
function sub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}function normalize(v){const n=Math.hypot(...v)||1;return v.map(x=>x/n);}

function findNearestSparseSeed(seeds,u,v,radius){let best=null,bd=radius*radius;for(const s of seeds||[]){const dx=s.u-u,dy=s.v-v,d=dx*dx+dy*dy;if(d<bd){bd=d;best=s;}}return best;}
