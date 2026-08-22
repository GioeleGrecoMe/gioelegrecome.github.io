/**
 * Final geometry policy.
 *
 * A dense result is not authoritative merely because all input surfels reached
 * the TSDF. Severe topology fragmentation or a spatial scale that is wildly
 * inconsistent with the optimized camera trajectory indicates that local
 * evidence never formed one observable room-scale surface.
 */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function evaluateFinalGeometryPolicy({meshQuality=null,gaussianCount=0,frames=[],sparseDepthEnvelope=null}={}){
  const mq=meshQuality||{},components=Math.max(0,Number(mq.componentCount)||0),largestFraction=finiteOr(mq.largestComponentFraction,0),fragmentation=finiteOr(mq.fragmentationScore,1),faces=Math.max(0,Number(mq.faceCount)||0),denseDiagonal=finiteOr(mq.bbox?.diagonal,0),cameraBox=bounds((frames||[]).map(f=>f?.poseEstimate?.p||f?.posePrior?.p).filter(finite3)),cameraTrajectoryDiagonal=cameraBox.diagonal;
  const sparseQ90=finiteOr(sparseDepthEnvelope?.q90,NaN),referenceScale=Math.max(.35,cameraTrajectoryDiagonal,Number.isFinite(sparseQ90)?sparseQ90*.55:0),scaleRatio=denseDiagonal/Math.max(.35,referenceScale);
  const severeFragmentation=faces>=20&&components>=10&&(largestFraction<.20||fragmentation>.80);
  const catastrophicFragmentation=faces>=20&&components>=20&&largestFraction<.10;
  // A room can be much larger than the camera path, so this guard is purposely
  // generous. It catches only the kind of 30 m cloud produced by an otherwise
  // compact scan, not ordinary wall/floor extents.
  const scaleExplosion=denseDiagonal>Math.max(18,referenceScale*9+2)&&scaleRatio>8;
  const empty=gaussianCount<=0||faces<=0;
  const commitReady=!empty&&!severeFragmentation&&!scaleExplosion;
  let reason='ok';if(empty)reason='no-dense-evidence';else if(catastrophicFragmentation)reason='mesh-catastrophically-fragmented';else if(severeFragmentation)reason='mesh-severely-fragmented';else if(scaleExplosion)reason='dense-scene-scale-exploded';
  return {commitReady,reason,gaussianCount,faces,componentCount:components,largestComponentFraction:largestFraction,fragmentationScore:fragmentation,denseDiagonal,cameraTrajectoryDiagonal,referenceScale,scaleRatio,severeFragmentation,catastrophicFragmentation,scaleExplosion};
}

function bounds(points){if(!points.length)return {min:null,max:null,diagonal:0};const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const p of points)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],p[k]);hi[k]=Math.max(hi[k],p[k]);}return {min:lo,max:hi,diagonal:Math.hypot(hi[0]-lo[0],hi[1]-lo[1],hi[2]-lo[2])};}
function finite3(p){return Array.isArray(p)&&p.length>=3&&p.slice(0,3).every(Number.isFinite);}
function finiteOr(v,d){v=Number(v);return Number.isFinite(v)?v:d;}
