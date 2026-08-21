// V30.40 OPT UNICO robust-bootstrap closure: republished atomically with the single optimizer runtime.
const EPS=1e-12;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

/**
 * Decide how many per-frame Deep calibration DOF are actually observable.
 *
 * The important distinction is not simply "how many anchors do I have?" but
 * whether those anchors span enough of both the image and the relative-depth
 * axis to distinguish scale from shift.  A flat wall can yield many excellent
 * tracks while the 2-column affine design matrix remains nearly singular.
 */
export function assessDepthCalibrationObservability(pairs,{width=1,height=1,minFullAnchors=10,minWeakAnchors=5,minCells=3,maxConditionFull=180,maxConditionShift=900,minRelativeSpan=.12,minGeometricSpan=.06}={}){
  const p=(pairs||[]).filter(x=>Number.isFinite(x?.raw)&&Number.isFinite(x?.rho)&&x.rho>0&&Number.isFinite(x?.w)&&x.w>0);
  if(!p.length)return empty('none');
  const raw=p.map(x=>x.raw),rho=p.map(x=>x.rho),rw=robustRange(raw),gw=robustRange(rho),rawScale=Math.max(EPS,Math.abs(median(raw)),Math.abs(rw.hi-rw.lo)),relativeSpan=(rw.hi-rw.lo)/rawScale,geometricSpan=(gw.hi-gw.lo)/Math.max(EPS,median(rho));
  const cells=coverageCells(p,width,height,4,6),condition=affineCondition(p),count=p.length;
  const anchorQuality=clamp((1-Math.exp(-count/12))*(.35+.65*clamp(cells/6,0,1)),0,1);
  const spanQuality=clamp(Math.min(relativeSpan/Math.max(EPS,minRelativeSpan),geometricSpan/Math.max(EPS,minGeometricSpan)),0,1);
  const condQuality=Number.isFinite(condition)?clamp(Math.log(maxConditionShift+1)/Math.log(condition+1),0,1):0;
  const score=clamp(.36*anchorQuality+.38*spanQuality+.26*condQuality,0,1);
  let mode='inherit',reason='unobservable-affine';
  if(count>=minFullAnchors&&cells>=minCells&&relativeSpan>=minRelativeSpan&&geometricSpan>=minGeometricSpan&&condition<=maxConditionFull){mode='full';reason='scale-and-shift-observable';}
  else if(count>=minWeakAnchors&&cells>=Math.max(2,minCells-1)&&condition<=maxConditionShift){mode='shift-only';reason='only-one-affine-dof-safe';}
  else if(count>=3){mode='inherit';reason='anchors-present-but-degenerate';}
  return {mode,reason,count,cells,condition,rawSpan:rw.hi-rw.lo,relativeSpan,geometricSpan,score,rawRange:rw,geometricRange:gw};
}

export function affineCondition(pairs){
  let sw=0,sx=0,sxx=0;for(const p of pairs||[]){const w=Math.max(EPS,+p.w||0),x=+p.raw;if(!Number.isFinite(x))continue;sw+=w;sx+=w*x;sxx+=w*x*x;}if(!(sw>0))return Infinity;
  // X'WX for columns [x,1].  The singular-value condition number of X is the
  // square root of the eigenvalue ratio of this 2x2 normal matrix.
  const tr=sxx+sw,det=Math.max(0,sxx*sw-sx*sx),disc=Math.sqrt(Math.max(0,tr*tr-4*det)),lmax=(tr+disc)/2,lmin=(tr-disc)/2;if(!(lmin>EPS))return Infinity;return Math.sqrt(lmax/lmin);
}

export function coverageCells(points,width,height,cols=4,rows=6){const seen=new Set(),w=Math.max(1,width),h=Math.max(1,height);for(const p of points||[]){if(!Number.isFinite(p?.u)||!Number.isFinite(p?.v))continue;const x=clamp(Math.floor(p.u/w*cols),0,cols-1),y=clamp(Math.floor(p.v/h*rows),0,rows-1);seen.add(`${x},${y}`);}return seen.size;}

function robustRange(a){const b=(a||[]).filter(Number.isFinite).sort((x,y)=>x-y);if(!b.length)return {lo:NaN,hi:NaN};return {lo:quantileSorted(b,.08),hi:quantileSorted(b,.92)};}
function median(a){const b=(a||[]).filter(Number.isFinite).sort((x,y)=>x-y);return b.length?quantileSorted(b,.5):NaN;}
function quantileSorted(a,q){if(!a.length)return NaN;const x=(a.length-1)*q,i=Math.floor(x),t=x-i;return a[i]*(1-t)+a[Math.min(a.length-1,i+1)]*t;}
function empty(reason){return {mode:'inherit',reason,count:0,cells:0,condition:Infinity,rawSpan:0,relativeSpan:0,geometricSpan:0,score:0,rawRange:{lo:NaN,hi:NaN},geometricRange:{lo:NaN,hi:NaN}};}
