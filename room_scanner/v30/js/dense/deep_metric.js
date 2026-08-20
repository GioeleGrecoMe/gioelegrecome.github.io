/**
 * Depth Anything -> Alva metric proxy-depth calibration.
 *
 * V30.25 keeps the robust global scale/shift fit, but no longer assumes that one
 * affine transform is equally accurate over the whole image. Alva feature tracks
 * provide sparse metric depths with uncertainty. Their residuals define a tiny
 * smooth correction/uncertainty grid which is bilinearly evaluated for every
 * Deep pixel. This is deliberately low-frequency: it can correct spatial drift
 * in a monocular prior without bending the image around individual feature noise.
 *
 * The returned `relativeSigma` map is as important as the depth itself. It is
 * converted into a true 3D covariance by deep_ray_samples.js and therefore lets
 * later views statistically dominate uncertain monocular regions.
 */
const EPS=1e-8;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function calibrateRelativeDepth({rawDepth,rawWidth,rawHeight,outWidth,outHeight,sparseSeeds,near=0,far=Infinity,minAnchors=6,minCells=3,maxMedianRelativeError=.18}={}){
  if(!rawDepth?.length||!(rawWidth>1&&rawHeight>1&&outWidth>1&&outHeight>1))return {ok:false,reason:'invalid-depth-map'};
  const pairs=[];
  for(const s of sparseSeeds||[]){
    if(!Number.isFinite(s?.u)||!Number.isFinite(s?.v)||!(s?.depth>0))continue;
    const x=(s.u/(outWidth-1))*(rawWidth-1),y=(s.v/(outHeight-1))*(rawHeight-1),raw=sampleMedian3(rawDepth,rawWidth,rawHeight,x,y);
    if(!Number.isFinite(raw)||Math.abs(raw)<EPS)continue;
    pairs.push({
      raw,depth:Number(s.depth),u:Number(s.u),v:Number(s.v),confidence:clamp(Number(s.confidence??.5),.05,1),
      sigmaDepth:Math.max(0,Number(s.sigmaDepth)||0),viewSupport:Math.max(1,Number(s.viewSupport)||1),trackId:s.trackId||null
    });
  }
  if(pairs.length<minAnchors)return {ok:false,reason:'too-few-anchors',anchorCount:pairs.length};
  const cells=countCoverageCells(pairs,outWidth,outHeight,4,6);
  if(cells<minCells)return {ok:false,reason:'anchors-too-clustered',anchorCount:pairs.length,cells};

  const candidates=[fitRobustAffine(pairs,p=>p.raw,'direct'),fitRobustAffine(pairs,p=>1/Math.max(EPS,Math.abs(p.raw)),'inverse')].filter(Boolean);
  if(!candidates.length)return {ok:false,reason:'fit-failed',anchorCount:pairs.length,cells};
  candidates.sort((a,b)=>a.medianRelativeError-b.medianRelativeError||b.inlierRatio-a.inlierRatio);
  const fit=candidates[0];
  if(fit.inliers<Math.max(4,Math.ceil(minAnchors*.66)))return {ok:false,reason:'too-few-inliers',anchorCount:pairs.length,cells,...fit};
  if(!(fit.medianRelativeError<=maxMedianRelativeError))return {ok:false,reason:'metric-residual-too-large',anchorCount:pairs.length,cells,...fit};

  const enriched=pairs.map(p=>{
    const feature=fit.mode==='inverse'?1/Math.max(EPS,Math.abs(p.raw)):p.raw,pred=fit.a*feature+fit.b;
    const rel=pred>0?Math.abs(pred-p.depth)/Math.max(.05,p.depth):Infinity;
    const logResidual=pred>0?Math.log(Math.max(.2,Math.min(5,p.depth/pred))):0;
    const anchorRelSigma=p.sigmaDepth>0?p.sigmaDepth/Math.max(.05,p.depth):fit.medianRelativeError;
    return {...p,pred,rel,logResidual,anchorRelSigma};
  }).filter(p=>Number.isFinite(p.pred)&&p.pred>0&&p.rel<=Math.max(.36,fit.medianRelativeError*3.2));
  if(enriched.length<4)return {ok:false,reason:'local-fit-too-few-inliers',anchorCount:pairs.length,cells,...fit};

  // A tiny regularised field is enough to model local scale drift. Building it
  // on 8x12 nodes keeps calibration cheap on low-budget phones; per-pixel work
  // below is then only a bilinear lookup.
  const field=buildLocalField(enriched,outWidth,outHeight,8,12,fit.medianRelativeError);
  const depth=new Float32Array(outWidth*outHeight),relativeSigma=new Float32Array(outWidth*outHeight);let valid=0;
  for(let y=0;y<outHeight;y++)for(let x=0;x<outWidth;x++){
    const rx=(x/(outWidth-1))*(rawWidth-1),ry=(y/(outHeight-1))*(rawHeight-1),r=bilinear(rawDepth,rawWidth,rawHeight,rx,ry);
    if(!Number.isFinite(r)||Math.abs(r)<EPS)continue;
    const feature=fit.mode==='inverse'?1/Math.max(EPS,Math.abs(r)):r,z0=fit.a*feature+fit.b;if(!(z0>0))continue;
    const local=sampleField(field,x,y,outWidth,outHeight),z=z0*Math.exp(clamp(local.logCorrection,-.22,.22));
    if(!Number.isFinite(z)||z<=0||z<near||z>far)continue;
    depth[y*outWidth+x]=z;relativeSigma[y*outWidth+x]=clamp(local.relativeSigma,.025,.32);valid++;
  }
  const validRatio=valid/Math.max(1,depth.length);
  if(validRatio<.45)return {ok:false,reason:'calibrated-map-mostly-invalid',anchorCount:pairs.length,cells,validRatio,...fit};
  const confidence=clamp((1-fit.medianRelativeError/Math.max(.05,maxMedianRelativeError))*.48+fit.inlierRatio*.30+Math.min(1,cells/8)*.12+Math.min(1,enriched.reduce((s,p)=>s+p.viewSupport,0)/(enriched.length*2))*.10,.05,1);
  return {
    ok:true,depth,relativeSigma,width:outWidth,height:outHeight,confidence,anchorCount:pairs.length,cells,validRatio,
    mode:fit.mode,a:fit.a,b:fit.b,inliers:fit.inliers,inlierRatio:fit.inlierRatio,medianError:fit.medianError,
    medianRelativeError:fit.medianRelativeError,localField:{cols:field.cols,rows:field.rows,maxCorrection:field.maxCorrection,medianSigma:field.medianSigma}
  };
}

export function countCoverageCells(points,width,height,cols=4,rows=6){
  const seen=new Set();for(const p of points||[]){if(!Number.isFinite(p?.u)||!Number.isFinite(p?.v))continue;const x=clamp(Math.floor(p.u/Math.max(1,width)*cols),0,cols-1),y=clamp(Math.floor(p.v/Math.max(1,height)*rows),0,rows-1);seen.add(`${x},${y}`);}return seen.size;
}

function buildLocalField(pairs,width,height,cols,rows,globalRel){
  const corr=new Float32Array(cols*rows),sig=new Float32Array(cols*rows);let maxCorrection=0;const sigmaValues=[];
  for(let gy=0;gy<rows;gy++)for(let gx=0;gx<cols;gx++){
    const u=(gx/(cols-1))*Math.max(1,width-1),v=(gy/(rows-1))*Math.max(1,height-1);let sw=0,se=0;
    const local=[];
    for(const p of pairs){
      const dx=(p.u-u)/Math.max(1,width),dy=(p.v-v)/Math.max(1,height),d2=dx*dx+dy*dy;
      // Heavy-tailed spatial kernel: close tracks dominate but distant anchors
      // still keep textureless wall regions tied to the same room scale.
      const spatial=1/Math.pow(.018+d2,1.25),support=.72+.18*Math.min(3,p.viewSupport),unc=1/Math.max(.025,p.anchorRelSigma||globalRel),w=p.confidence*support*spatial*Math.min(18,unc);
      sw+=w;se+=w*p.logResidual;local.push({w,e:p.logResidual,rel:p.rel,anchor:p.anchorRelSigma});
    }
    const mean=sw>0?se/sw:0;corr[gy*cols+gx]=clamp(mean,-.22,.22);maxCorrection=Math.max(maxCorrection,Math.abs(corr[gy*cols+gx]));
    let sv=0;if(sw>0)for(const p of local)sv+=p.w*((p.e-mean)**2+Math.max(.0004,(p.anchor||globalRel)**2));
    const rel=Math.sqrt(Math.max(.0004,sv/Math.max(EPS,sw))),nearest=nearestNormalisedDistance(pairs,u,v,width,height),distancePenalty=.035*Math.min(2.5,nearest/.18),s=clamp(.55*globalRel+.45*rel+distancePenalty,.025,.32);sig[gy*cols+gx]=s;sigmaValues.push(s);
  }
  return {cols,rows,corr,sig,maxCorrection,medianSigma:median(sigmaValues)};
}
function sampleField(field,x,y,width,height){
  const gx=(x/Math.max(1,width-1))*(field.cols-1),gy=(y/Math.max(1,height-1))*(field.rows-1),x0=Math.floor(gx),y0=Math.floor(gy),x1=Math.min(field.cols-1,x0+1),y1=Math.min(field.rows-1,y0+1),tx=gx-x0,ty=gy-y0;
  const interp=a=>(a[y0*field.cols+x0]*(1-tx)+a[y0*field.cols+x1]*tx)*(1-ty)+(a[y1*field.cols+x0]*(1-tx)+a[y1*field.cols+x1]*tx)*ty;
  return {logCorrection:interp(field.corr),relativeSigma:interp(field.sig)};
}
function nearestNormalisedDistance(pairs,u,v,w,h){let best=Infinity;for(const p of pairs){const dx=(p.u-u)/Math.max(1,w),dy=(p.v-v)/Math.max(1,h),d=Math.hypot(dx,dy);if(d<best)best=d;}return Number.isFinite(best)?best:1;}

function fitRobustAffine(pairs,feature,mode){
  let active=pairs.map((p,i)=>({p,i,x:feature(p),y:p.depth,w:p.confidence*(.75+.15*Math.min(3,p.viewSupport||1))/Math.max(.5,1+(p.sigmaDepth||0)/Math.max(.05,p.depth)*6)})).filter(o=>Number.isFinite(o.x+o.y)&&o.y>0);
  if(active.length<4)return null;let fit=weightedLeastSquares(active);if(!fit)return null;
  for(let pass=0;pass<3;pass++){
    const residuals=active.map(o=>Math.abs((fit.a*o.x+fit.b)-o.y)),med=median(residuals),mad=median(residuals.map(r=>Math.abs(r-med))),depthMed=median(active.map(o=>o.y));
    const threshold=Math.max(depthMed*.025,med+2.8*Math.max(mad,depthMed*.004));
    const kept=active.filter((o,i)=>residuals[i]<=threshold);if(kept.length<4||kept.length===active.length)break;active=kept;fit=weightedLeastSquares(active);if(!fit)return null;
  }
  const allResiduals=pairs.map(p=>Math.abs(fit.a*feature(p)+fit.b-p.depth)),rel=pairs.map((p,i)=>allResiduals[i]/Math.max(.05,p.depth));
  const depthMed=median(pairs.map(p=>p.depth)),m=median(allResiduals),threshold=Math.max(depthMed*.035,m+3*Math.max(median(allResiduals.map(r=>Math.abs(r-m))),depthMed*.004));
  const inliers=allResiduals.filter(r=>r<=threshold).length;
  return {mode,a:fit.a,b:fit.b,inliers,inlierRatio:inliers/pairs.length,medianError:median(allResiduals),medianRelativeError:median(rel)};
}
function weightedLeastSquares(a){let sw=0,sx=0,sy=0,sxx=0,sxy=0;for(const o of a){const w=o.w||1;sw+=w;sx+=w*o.x;sy+=w*o.y;sxx+=w*o.x*o.x;sxy+=w*o.x*o.y;}const den=sw*sxx-sx*sx;if(Math.abs(den)<EPS)return null;const aa=(sw*sxy-sx*sy)/den,bb=(sy-aa*sx)/sw;return Number.isFinite(aa+bb)?{a:aa,b:bb}:null;}
function median(a){if(!a.length)return Infinity;const b=a.slice().sort((x,y)=>x-y),m=b.length>>1;return b.length%2?b[m]:(b[m-1]+b[m])*.5;}
function sampleMedian3(a,w,h,x,y){const xx=Math.round(x),yy=Math.round(y),v=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const sx=clamp(xx+dx,0,w-1),sy=clamp(yy+dy,0,h-1),z=a[sy*w+sx];if(Number.isFinite(z)&&Math.abs(z)>EPS)v.push(z);}return v.length?median(v):NaN;}
function bilinear(a,w,h,x,y){const x0=clamp(Math.floor(x),0,w-1),y0=clamp(Math.floor(y),0,h-1),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),tx=x-x0,ty=y-y0;return (a[y0*w+x0]*(1-tx)+a[y0*w+x1]*tx)*(1-ty)+(a[y1*w+x0]*(1-tx)+a[y1*w+x1]*tx)*ty;}
