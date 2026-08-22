/**
 * V30.52 final geometry policy.
 *
 * Dense geometry is authoritative only when:
 *  - the evidence is tied to the final camera scaffold;
 *  - global surface consensus yields enough independently supported splats;
 *  - raw TSDF fragmentation is not being hidden by cleanup;
 *  - the cleaned mesh has a dominant room-scale structure.
 */
export function evaluateFinalGeometryPolicy({meshQuality=null,rawMeshQuality=null,meshCleanup=null,surfaceConsensus=null,gaussianCount=0,frames=[],sparseDepthEnvelope=null,mvsValidation=null,depthGeometryPolicy=null}={}){
  const mq=meshQuality||{},raw=rawMeshQuality||mq,cleanup=meshCleanup||{},cons=surfaceConsensus||{},components=Math.max(0,Number(mq.componentCount)||0),largestFraction=finiteOr(mq.largestComponentFraction,0),fragmentation=finiteOr(mq.fragmentationScore,1),faces=Math.max(0,Number(mq.faceCount)||0),denseDiagonal=finiteOr(mq.bbox?.diagonal,0),cameraBox=bounds((frames||[]).map(f=>f?.poseEstimate?.p||f?.posePrior?.p).filter(finite3)),cameraTrajectoryDiagonal=cameraBox.diagonal;
  const sparseQ90=finiteOr(sparseDepthEnvelope?.q90,NaN),referenceScale=Math.max(.35,cameraTrajectoryDiagonal,Number.isFinite(sparseQ90)?sparseQ90*.55:0),scaleRatio=denseDiagonal/Math.max(.35,referenceScale);

  const catastrophicFragmentation=faces>=20&&((components>=40&&largestFraction<.55)||(components>=16&&largestFraction<.28)||fragmentation>.82);
  const severeFragmentation=faces>=20&&(catastrophicFragmentation||(components>=14&&largestFraction<.62)||(components>=7&&largestFraction<.42)||fragmentation>.62);
  const topologyCoherent=faces>=20&&!severeFragmentation&&(largestFraction>=.58||components<=5||mq.status==='coherent');
  const rawComponents=Math.max(0,Number(raw.componentCount)||0),discardedVertexFraction=finiteOr(cleanup.discardedVertexFraction,0),rawFragmentationHigh=rawComponents>=18&&discardedVertexFraction>.30;

  const scaleExplosion=denseDiagonal>Math.max(18,referenceScale*9+2)&&scaleRatio>8,empty=gaussianCount<=0||faces<=0;
  const authoritativeConsensus=Math.max(0,Number(cons.authoritative)||gaussianCount),consensusCells=Math.max(0,Number(cons.occupiedCells)||0),consensusMedian=finiteOr(cons.medianConfidence,NaN),consensusReady=!surfaceConsensus||(authoritativeConsensus>=80&&consensusCells>=24&&(!Number.isFinite(consensusMedian)||consensusMedian>=.28));

  const mv=mvsValidation||{},poseBound=Math.max(0,Number(mv.poseBoundFactors)||0),legacy=Math.max(0,Math.min(poseBound,Number(mv.legacyPoseBoundFactors)||0)),authoritativeMvsFactors=Math.max(0,poseBound-legacy),committedMvs=Math.max(0,Number(mv.committed)||0),deepAuthority=depthGeometryPolicy?.commitAllowed===true,minAuthoritativeMvsFactors=poseBound?Math.min(poseBound,Math.max(3,Math.ceil(poseBound*.15))):0,legacyOnlyMvs=committedMvs>0&&poseBound>0&&authoritativeMvsFactors===0&&!deepAuthority,insufficientAuthoritativeMvs=committedMvs>0&&poseBound>0&&authoritativeMvsFactors<minAuthoritativeMvsFactors&&!deepAuthority,denseAuthorityReady=!legacyOnlyMvs&&!insufficientAuthoritativeMvs;

  const commitReady=!empty&&denseAuthorityReady&&consensusReady&&!rawFragmentationHigh&&topologyCoherent&&!scaleExplosion;
  let reason='ok';if(empty)reason='no-dense-evidence';else if(legacyOnlyMvs)reason='legacy-mvs-not-authoritative';else if(insufficientAuthoritativeMvs)reason='pose-bound-mvs-coverage-low';else if(!consensusReady)reason='global-surface-consensus-insufficient';else if(rawFragmentationHigh)reason='mesh-fragmented-before-cleanup';else if(catastrophicFragmentation)reason='mesh-catastrophically-fragmented';else if(severeFragmentation||!topologyCoherent)reason='mesh-severely-fragmented';else if(scaleExplosion)reason='dense-scene-scale-exploded';
  return {commitReady,reason,gaussianCount,faces,componentCount:components,largestComponentFraction:largestFraction,fragmentationScore:fragmentation,rawComponentCount:rawComponents,discardedVertexFraction,rawFragmentationHigh,denseDiagonal,cameraTrajectoryDiagonal,referenceScale,scaleRatio,severeFragmentation,catastrophicFragmentation,topologyCoherent,scaleExplosion,consensusReady,authoritativeConsensus,consensusCells,consensusMedianConfidence:Number.isFinite(consensusMedian)?consensusMedian:null,poseBoundMvsFactors:poseBound,legacyPoseBoundMvsFactors:legacy,authoritativeMvsFactors,minAuthoritativeMvsFactors,legacyOnlyMvs,insufficientAuthoritativeMvs,denseAuthorityReady,deepAuthority};
}
function bounds(points){if(!points.length)return {min:null,max:null,diagonal:0};const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const p of points)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],p[k]);hi[k]=Math.max(hi[k],p[k]);}return {min:lo,max:hi,diagonal:Math.hypot(hi[0]-lo[0],hi[1]-lo[1],hi[2]-lo[2])};}function finite3(p){return Array.isArray(p)&&p.length>=3&&p.slice(0,3).every(Number.isFinite);}function finiteOr(v,d){v=Number(v);return Number.isFinite(v)?v:d;}
