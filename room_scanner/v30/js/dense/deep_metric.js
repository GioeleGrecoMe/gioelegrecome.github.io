/**
 * Depth Anything -> Alva world-depth calibration helpers.
 *
 * IMPORTANT GEOMETRY CONTRACT
 * ---------------------------
 * Depth Anything V2 Small is used only as a RELATIVE dense shape prior. It is
 * never trusted as a metric sensor by itself. Sparse depths triangulated from
 * Alva-tracked features provide the scale/offset in the current Alva world
 * (metres when the one-shot metric bootstrap is locked, Alva units otherwise).
 *
 * The model output has changed conventions across runtimes, so we test three
 * low-cost monotonic calibrations: metric depth affine in raw output, metric
 * depth affine in 1/raw, and (important for disparity-like networks) inverse
 * metric depth affine in raw output. Sparse Alva anchors reject outliers and
 * select the calibration with the lowest median metric residual.
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
    pairs.push({raw,depth:Number(s.depth),u:Number(s.u),v:Number(s.v),confidence:clamp(Number(s.confidence??.5),.05,1)});
  }
  if(pairs.length<minAnchors)return {ok:false,reason:'too-few-anchors',anchorCount:pairs.length};
  const cells=countCoverageCells(pairs,outWidth,outHeight,4,6);
  if(cells<minCells)return {ok:false,reason:'anchors-too-clustered',anchorCount:pairs.length,cells};

  const candidates=[
    fitRobustAffine(pairs,p=>p.raw,'direct'),
    fitRobustAffine(pairs,p=>1/Math.max(EPS,Math.abs(p.raw)),'inverse-raw'),
    fitRobustInverseDepth(pairs),
  ].filter(Boolean);
  if(!candidates.length)return {ok:false,reason:'fit-failed',anchorCount:pairs.length,cells};
  candidates.sort((a,b)=>a.medianRelativeError-b.medianRelativeError||b.inlierRatio-a.inlierRatio);
  const fit=candidates[0];
  if(fit.inliers<Math.max(4,Math.ceil(minAnchors*.66)))return {ok:false,reason:'too-few-inliers',anchorCount:pairs.length,cells,...fit};
  if(!(fit.medianRelativeError<=maxMedianRelativeError))return {ok:false,reason:'metric-residual-too-large',anchorCount:pairs.length,cells,...fit};

  const depth=new Float32Array(outWidth*outHeight);let valid=0;
  for(let y=0;y<outHeight;y++)for(let x=0;x<outWidth;x++){
    const rx=(x/(outWidth-1))*(rawWidth-1),ry=(y/(outHeight-1))*(rawHeight-1),r=bilinear(rawDepth,rawWidth,rawHeight,rx,ry);
    if(!Number.isFinite(r)||Math.abs(r)<EPS)continue;
    const z=predictMetricDepth(fit,r);
    if(!Number.isFinite(z)||z<=0||z<near||z>far)continue;depth[y*outWidth+x]=z;valid++;
  }
  const validRatio=valid/Math.max(1,depth.length);
  if(validRatio<.45)return {ok:false,reason:'calibrated-map-mostly-invalid',anchorCount:pairs.length,cells,validRatio,...fit};
  const confidence=clamp((1-fit.medianRelativeError/Math.max(.05,maxMedianRelativeError))*.55+fit.inlierRatio*.35+Math.min(1,cells/8)*.10,.05,1);
  return {ok:true,depth,width:outWidth,height:outHeight,confidence,anchorCount:pairs.length,cells,validRatio,mode:fit.mode,a:fit.a,b:fit.b,inliers:fit.inliers,inlierRatio:fit.inlierRatio,medianError:fit.medianError,medianRelativeError:fit.medianRelativeError};
}

export function countCoverageCells(points,width,height,cols=4,rows=6){
  const seen=new Set();for(const p of points||[]){if(!Number.isFinite(p?.u)||!Number.isFinite(p?.v))continue;const x=clamp(Math.floor(p.u/Math.max(1,width)*cols),0,cols-1),y=clamp(Math.floor(p.v/Math.max(1,height)*rows),0,rows-1);seen.add(`${x},${y}`);}return seen.size;
}

function fitRobustAffine(pairs,feature,mode){
  let active=pairs.map((p,i)=>({p,i,x:feature(p),y:p.depth,w:p.confidence})).filter(o=>Number.isFinite(o.x+o.y)&&o.y>0);
  if(active.length<4)return null;let fit=weightedLeastSquares(active);if(!fit)return null;
  // Three IRLS-like passes are intentionally deterministic and cheap. Sparse
  // anchors are already geometric matches; this stage only removes remaining
  // mismatches before their scale is allowed to steer the dense prior.
  for(let pass=0;pass<3;pass++){
    const residuals=active.map(o=>Math.abs((fit.a*o.x+fit.b)-o.y)),med=median(residuals),mad=median(residuals.map(r=>Math.abs(r-med))),depthMed=median(active.map(o=>o.y));
    const threshold=Math.max(depthMed*.025,med+2.8*Math.max(mad,depthMed*.004));
    const kept=active.filter((o,i)=>residuals[i]<=threshold);if(kept.length<4||kept.length===active.length)break;active=kept;fit=weightedLeastSquares(active);if(!fit)return null;
  }
  const allResiduals=pairs.map(p=>Math.abs(fit.a*feature(p)+fit.b-p.depth)),rel=pairs.map((p,i)=>allResiduals[i]/Math.max(.05,p.depth));
  const depthMed=median(pairs.map(p=>p.depth)),threshold=Math.max(depthMed*.035,median(allResiduals)+3*Math.max(median(allResiduals.map(r=>Math.abs(r-median(allResiduals)))),depthMed*.004));
  const inliers=allResiduals.filter(r=>r<=threshold).length;
  return {mode,a:fit.a,b:fit.b,inliers,inlierRatio:inliers/pairs.length,medianError:median(allResiduals),medianRelativeError:median(rel)};
}
function fitRobustInverseDepth(pairs){
  // Many relative-depth networks are better described as disparity predictors:
  //     1 / z_metric = a * raw + b
  // Fitting z directly to raw (or 1/raw) can look acceptable at the sparse
  // anchors yet curve incorrectly between them. This third candidate preserves
  // the correct projective shape while Alva supplies the common scale/offset.
  let active=pairs.map((p,i)=>({p,i,x:p.raw,y:1/Math.max(EPS,p.depth),w:p.confidence})).filter(o=>Number.isFinite(o.x+o.y)&&o.y>0);
  if(active.length<4)return null;let fit=weightedLeastSquares(active);if(!fit)return null;
  for(let pass=0;pass<3;pass++){
    const scored=active.map(o=>({o,r:metricResidualFromInverseFit(fit,o.p)})).filter(s=>Number.isFinite(s.r));
    if(scored.length<4)return null;
    const residuals=scored.map(s=>s.r),med=median(residuals),mad=median(residuals.map(r=>Math.abs(r-med))),depthMed=median(scored.map(s=>s.o.p.depth));
    const threshold=Math.max(depthMed*.025,med+2.8*Math.max(mad,depthMed*.004));
    const kept=scored.filter(s=>s.r<=threshold).map(s=>s.o);if(kept.length<4||kept.length===active.length)break;active=kept;fit=weightedLeastSquares(active);if(!fit)return null;
  }
  const allResiduals=pairs.map(p=>metricResidualFromInverseFit(fit,p)),rel=pairs.map((p,i)=>allResiduals[i]/Math.max(.05,p.depth));
  const finiteResiduals=allResiduals.filter(Number.isFinite);if(finiteResiduals.length<4)return null;
  const depthMed=median(pairs.map(p=>p.depth)),med=median(finiteResiduals),threshold=Math.max(depthMed*.035,med+3*Math.max(median(finiteResiduals.map(r=>Math.abs(r-med))),depthMed*.004));
  const inliers=allResiduals.filter(r=>Number.isFinite(r)&&r<=threshold).length;
  return {mode:'inverse-depth',a:fit.a,b:fit.b,inliers,inlierRatio:inliers/pairs.length,medianError:median(allResiduals),medianRelativeError:median(rel)};
}
function metricResidualFromInverseFit(fit,p){const z=predictMetricDepth({mode:'inverse-depth',a:fit.a,b:fit.b},p.raw);return Number.isFinite(z)?Math.abs(z-p.depth):Infinity;}
function predictMetricDepth(fit,raw){
  if(fit.mode==='inverse-raw')return fit.a*(1/Math.max(EPS,Math.abs(raw)))+fit.b;
  if(fit.mode==='inverse-depth'){const inv=fit.a*raw+fit.b;return inv>EPS?1/inv:NaN;}
  return fit.a*raw+fit.b;
}
function weightedLeastSquares(a){let sw=0,sx=0,sy=0,sxx=0,sxy=0;for(const o of a){const w=o.w||1;sw+=w;sx+=w*o.x;sy+=w*o.y;sxx+=w*o.x*o.x;sxy+=w*o.x*o.y;}const den=sw*sxx-sx*sx;if(Math.abs(den)<EPS)return null;const aa=(sw*sxy-sx*sy)/den,bb=(sy-aa*sx)/sw;return Number.isFinite(aa+bb)?{a:aa,b:bb}:null;}
function median(a){if(!a.length)return Infinity;const b=a.slice().sort((x,y)=>x-y),m=b.length>>1;return b.length%2?b[m]:(b[m-1]+b[m])*.5;}
function sampleMedian3(a,w,h,x,y){const xx=Math.round(x),yy=Math.round(y),v=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const sx=clamp(xx+dx,0,w-1),sy=clamp(yy+dy,0,h-1),z=a[sy*w+sx];if(Number.isFinite(z)&&Math.abs(z)>EPS)v.push(z);}return v.length?median(v):NaN;}
function bilinear(a,w,h,x,y){const x0=clamp(Math.floor(x),0,w-1),y0=clamp(Math.floor(y),0,h-1),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),tx=x-x0,ty=y-y0;return (a[y0*w+x0]*(1-tx)+a[y0*w+x1]*tx)*(1-ty)+(a[y1*w+x0]*(1-tx)+a[y1*w+x1]*tx)*ty;}
