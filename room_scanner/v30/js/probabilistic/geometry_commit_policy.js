/**
 * Final geometry policy.
 *
 * Dense geometry is authoritative only when (1) the mesh has a dominant,
 * room-scale connected structure and (2) the dense evidence itself is tied to
 * the camera scaffold that produced it. Legacy MVS can remain useful for
 * diagnostics/anchors but cannot, by itself, authorize a committed surface.
 */
export function evaluateFinalGeometryPolicy({meshQuality=null,gaussianCount=0,frames=[],sparseDepthEnvelope=null,mvsValidation=null,depthGeometryPolicy=null}={}){
  const mq=meshQuality||{},components=Math.max(0,Number(mq.componentCount)||0),largestFraction=finiteOr(mq.largestComponentFraction,0),fragmentation=finiteOr(mq.fragmentationScore,1),faces=Math.max(0,Number(mq.faceCount)||0),denseDiagonal=finiteOr(mq.bbox?.diagonal,0),cameraBox=bounds((frames||[]).map(f=>f?.poseEstimate?.p||f?.posePrior?.p).filter(finite3)),cameraTrajectoryDiagonal=cameraBox.diagonal;
  const sparseQ90=finiteOr(sparseDepthEnvelope?.q90,NaN),referenceScale=Math.max(.35,cameraTrajectoryDiagonal,Number.isFinite(sparseQ90)?sparseQ90*.55:0),scaleRatio=denseDiagonal/Math.max(.35,referenceScale);

  // Connectivity is deliberately conservative. A useful room mesh may have a
  // handful of disconnected objects, but hundreds of islands with no dominant
  // component are not an acceptable committed twin.
  const catastrophicFragmentation=faces>=20&&(
    (components>=60&&largestFraction<.45)||
    (components>=20&&largestFraction<.12)||
    fragmentation>.90
  );
  const severeFragmentation=faces>=20&&(
    catastrophicFragmentation||
    (components>=24&&largestFraction<.55)||
    (components>=10&&largestFraction<.35)||
    fragmentation>.72
  );
  const topologyCoherent=faces>=20&&!severeFragmentation&&(
    largestFraction>=.45||components<=8||mq.status==='coherent'
  );

  // A room can be much larger than the camera path, so this catches only gross
  // scene-scale explosions rather than ordinary wall/floor extents.
  const scaleExplosion=denseDiagonal>Math.max(18,referenceScale*9+2)&&scaleRatio>8;
  const empty=gaussianCount<=0||faces<=0;

  const mv=mvsValidation||{},poseBound=Math.max(0,Number(mv.poseBoundFactors)||0),legacy=Math.max(0,Math.min(poseBound,Number(mv.legacyPoseBoundFactors)||0)),authoritativeMvsFactors=Math.max(0,poseBound-legacy),committedMvs=Math.max(0,Number(mv.committed)||0),deepAuthority=depthGeometryPolicy?.commitAllowed===true,minAuthoritativeMvsFactors=poseBound?Math.min(poseBound,Math.max(3,Math.ceil(poseBound*.15))):0,legacyOnlyMvs=committedMvs>0&&poseBound>0&&authoritativeMvsFactors===0&&!deepAuthority,insufficientAuthoritativeMvs=committedMvs>0&&poseBound>0&&authoritativeMvsFactors<minAuthoritativeMvsFactors&&!deepAuthority,denseAuthorityReady=!legacyOnlyMvs&&!insufficientAuthoritativeMvs;

  const commitReady=!empty&&denseAuthorityReady&&topologyCoherent&&!scaleExplosion;
  let reason='ok';
  if(empty)reason='no-dense-evidence';
  else if(legacyOnlyMvs)reason='legacy-mvs-not-authoritative';
  else if(insufficientAuthoritativeMvs)reason='pose-bound-mvs-coverage-low';
  else if(catastrophicFragmentation)reason='mesh-catastrophically-fragmented';
  else if(severeFragmentation||!topologyCoherent)reason='mesh-severely-fragmented';
  else if(scaleExplosion)reason='dense-scene-scale-exploded';
  return {commitReady,reason,gaussianCount,faces,componentCount:components,largestComponentFraction:largestFraction,fragmentationScore:fragmentation,denseDiagonal,cameraTrajectoryDiagonal,referenceScale,scaleRatio,severeFragmentation,catastrophicFragmentation,topologyCoherent,scaleExplosion,poseBoundMvsFactors:poseBound,legacyPoseBoundMvsFactors:legacy,authoritativeMvsFactors,minAuthoritativeMvsFactors,legacyOnlyMvs,insufficientAuthoritativeMvs,denseAuthorityReady,deepAuthority};
}

function bounds(points){if(!points.length)return {min:null,max:null,diagonal:0};const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const p of points)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],p[k]);hi[k]=Math.max(hi[k],p[k]);}return {min:lo,max:hi,diagonal:Math.hypot(hi[0]-lo[0],hi[1]-lo[1],hi[2]-lo[2])};}
function finite3(p){return Array.isArray(p)&&p.length>=3&&p.slice(0,3).every(Number.isFinite);}
function finiteOr(v,d){v=Number(v);return Number.isFinite(v)?v:d;}
