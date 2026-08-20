/**
 * Convert a calibrated Depth Anything map into sparse anisotropic ray samples.
 *
 * Why this exists
 * ---------------
 * A single monocular depth map must NOT be treated as a finished metric mesh.
 * Each sampled pixel is only an observation along a calibrated camera ray.  The
 * fusion stage keeps that observation as a compact Gaussian-like constraint and
 * confirms it only when later AlvaAR views agree in world space.
 *
 * The uncertainty is intentionally anisotropic:
 *   - lateral sigma ~= projected pixel footprint;
 *   - axial sigma is larger and grows with the Deep->Alva calibration residual.
 * This makes a monocular observation "long" along the ray and much tighter
 * across it, which is the geometry expected from a relative-depth prior.
 */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function depthMapToRaySamples({
  depth,width,height,ref,K=ref?.K,baseConfidence=.5,calibrationRelativeError=.12,
  sparseSeeds=[],pixelStep=5,maxSamples=5000,source='deep-ray'
}={}){
  if(!depth?.length||depth.length!==width*height||!ref?.pose||!K||!ref?.rgba?.length)return {samples:[],stats:{reason:'invalid-input'}};
  const step=Math.max(2,pixelStep|0),samples=[],R=rotationFromQuat(ref.pose.q),origin=ref.pose.p;
  let valid=0,rejectedEdge=0,anchored=0;
  for(let v=step;v<height-step;v+=step){
    for(let u=step;u<width-step;u+=step){
      const z=depth[v*width+u];if(!(z>0&&Number.isFinite(z)))continue;valid++;
      const zl=depth[v*width+u-step],zr=depth[v*width+u+step],zu=depth[(v-step)*width+u],zd=depth[(v+step)*width+u];
      if(!(zl>0&&zr>0&&zu>0&&zd>0))continue;
      // Strong depth jumps are normally occlusion boundaries.  A fat Gaussian
      // crossing that boundary would glue foreground and wall together, so keep
      // only the more stable interior samples for the persistent map.
      const localSpread=Math.max(Math.abs(z-zl),Math.abs(z-zr),Math.abs(z-zu),Math.abs(z-zd))/Math.max(.05,z);
      if(localSpread>.34){rejectedEdge++;continue;}
      const p=unprojectWorld(origin,R,K,u,v,z),pl=unprojectWorld(origin,R,K,u-step,v,zl),pr=unprojectWorld(origin,R,K,u+step,v,zr),pu=unprojectWorld(origin,R,K,u,v-step,zu),pd=unprojectWorld(origin,R,K,u,v+step,zd);
      let normal=normalize(cross(sub(pr,pl),sub(pd,pu)));const toCam=normalize(sub(origin,p));if(dot(normal,toCam)<0)normal=normal.map(x=>-x);
      const pixelFootprint=Math.max(1e-6,z/Math.max(K.fx,K.fy)*step*1.25);
      const seed=nearestSeed(sparseSeeds,u,v,Math.max(10,step*2.5));
      const anchorBoost=seed?clamp(1-Math.hypot(seed.u-u,seed.v-v)/Math.max(10,step*2.5),0,1):0;if(seed)anchored++;
      // Calibration residual is the dominant axial uncertainty.  Near a trusted
      // triangulated Alva anchor we can tighten it, but never make it isotropic.
      const relSigma=clamp(.035+1.15*Math.max(0,calibrationRelativeError),.045,.30),anchorScale=seed?(1-.42*anchorBoost):1;
      const sigmaDepth=Math.max(pixelFootprint*1.8,z*relSigma*anchorScale);
      const sigmaLateral=Math.max(pixelFootprint*.75,z/Math.max(K.fx,K.fy)*1.1);
      const confidence=clamp(baseConfidence*(1-.55*localSpread)*(.82+.18*anchorBoost),.05,.92);
      samples.push({
        p,normal,color:sampleRgb(ref.rgba,width,height,u,v),confidence,radius:pixelFootprint,
        depth:z,u,v,sigmaDepth,sigmaLateral,source,anchorBoost
      });
    }
  }
  if(samples.length>maxSamples){const stride=Math.ceil(samples.length/maxSamples),thin=[];for(let i=0;i<samples.length;i+=stride)thin.push(samples[i]);samples.length=0;samples.push(...thin);}
  return {samples,stats:{validPixels:valid,rejectedEdge,anchored,samples:samples.length,pixelStep:step,relativeSigma:clamp(.035+1.15*Math.max(0,calibrationRelativeError),.045,.30)}};
}

function nearestSeed(seeds,u,v,radius){let best=null,bd=radius*radius;for(const s of seeds||[]){if(!Number.isFinite(s?.u+s?.v+s?.depth))continue;const dx=s.u-u,dy=s.v-v,d=dx*dx+dy*dy;if(d<bd){bd=d;best=s;}}return best;}
function sampleRgb(rgba,w,h,x,y){const xx=clamp(Math.round(x),0,w-1),yy=clamp(Math.round(y),0,h-1),i=(yy*w+xx)*4;return [rgba[i]||0,rgba[i+1]||0,rgba[i+2]||0];}
function unprojectWorld(o,R,K,u,v,z){const c=[(u-K.cx)/K.fx*z,(v-K.cy)/K.fy*z,z],w=rotate(R,c);return [o[0]+w[0],o[1]+w[1],o[2]+w[2]];}
function rotationFromQuat(q){let [x,y,z,w]=(q||[0,0,0,1]).map(Number),n=Math.hypot(x,y,z,w)||1;x/=n;y/=n;z/=n;w/=n;const xx=x*x,yy=y*y,zz=z*z,xy=x*y,xz=x*z,yz=y*z,wx=w*x,wy=w*y,wz=w*z;return [1-2*(yy+zz),2*(xy-wz),2*(xz+wy),2*(xy+wz),1-2*(xx+zz),2*(yz-wx),2*(xz-wy),2*(yz+wx),1-2*(xx+yy)];}
function rotate(R,v){return [R[0]*v[0]+R[1]*v[1]+R[2]*v[2],R[3]*v[0]+R[4]*v[1]+R[5]*v[2],R[6]*v[0]+R[7]*v[1]+R[8]*v[2]];}
function sub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}function normalize(v){const n=Math.hypot(...v)||1;return v.map(x=>x/n);}
