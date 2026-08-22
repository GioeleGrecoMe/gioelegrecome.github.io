const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

/**
 * Dense depth can be locally photometrically observable while the CAMERA
 * scaffold is globally wrong.  This policy separates those two statements.
 * MVS/Deep may still be evaluated for diagnostics, but they cannot create a
 * surface until enough independent RGB geometry actually constrains the poses.
 */
export function evaluatePoseScaffoldPolicy({edgeStats=null,photoAudit=null,frameCount=0}={}){
  const e=edgeStats||{},edges=Math.max(0,Number(e.edges)||0),active=Math.max(0,Number(e.active)||0),weak=Math.max(0,Number(e.weak)||0),rejected=Math.max(0,Number(e.rejected)||0),dirEdges=Math.max(0,Number(e.translationDirectionEdges)||0),dirResidualDeg=Number(e.meanTranslationDirectionResidualDeg),lineInlierFraction=Number(e.translationDirectionMeanInlierFraction),epipolarResidualDeg=Number(e.meanEpipolarPlaneResidualDeg),inputEdges=Math.max(edges,Number(photoAudit?.inputEdges)||edges),unresolved=Math.max(0,Number(photoAudit?.unresolvedEdges)||0),importFraction=Number.isFinite(+photoAudit?.importFraction)?clamp(+photoAudit.importFraction,0,1):(inputEdges?clamp(edges/inputEdges,0,1):1);
  const requiredEdges=Math.max(3,Math.min(8,Math.ceil(Math.max(1,Number(frameCount)||0)/8))),requiredDirection=Math.max(2,Math.ceil(Math.max(1,edges)*.35)),requiredActive=Math.max(1,Math.ceil(Math.max(1,edges)*.12)),usable=active+.35*weak;
  const edgeCoverageOk=edges>=requiredEdges&&importFraction>=.70,lineFitOk=(!Number.isFinite(lineInlierFraction)||lineInlierFraction>=.52)&&(!Number.isFinite(epipolarResidualDeg)||epipolarResidualDeg<=3.0),directionOk=dirEdges>=requiredDirection&&Number.isFinite(dirResidualDeg)&&dirResidualDeg<=28&&lineFitOk,switchOk=active>=requiredActive||usable>=Math.max(2,edges*.45),rejectedFraction=edges?rejected/edges:1;
  const reasons=[];if(edges<requiredEdges)reasons.push('rgb-edge-count-low');if(importFraction<.70)reasons.push('rgb-edge-import-low');if(dirEdges<requiredDirection)reasons.push('rgb-translation-line-coverage-low');if(Number.isFinite(lineInlierFraction)&&lineInlierFraction<.52)reasons.push('rgb-epipolar-inlier-fraction-low');if(Number.isFinite(epipolarResidualDeg)&&epipolarResidualDeg>3.0)reasons.push('rgb-epipolar-fit-residual-high');if(!Number.isFinite(dirResidualDeg)||dirResidualDeg>28)reasons.push('rgb-translation-line-residual-high');if(!switchOk)reasons.push('rgb-switch-support-low');if(rejectedFraction>.78)reasons.push('rgb-rejected-fraction-high');
  const observed=edgeCoverageOk&&directionOk&&switchOk&&rejectedFraction<=.78;
  const authority=clamp(.28*Math.min(1,edges/requiredEdges)+.22*importFraction+.25*(Number.isFinite(dirResidualDeg)?Math.max(0,1-dirResidualDeg/45):0)+.25*Math.min(1,usable/Math.max(1,edges*.55)),0,1);
  return {observed,mvsSurfaceAllowed:observed,deepSurfaceAllowed:observed,reason:observed?'ok':(reasons[0]||'rgb-pose-scaffold-unobserved'),reasons,authority,edges,inputEdges,unresolved,importFraction,active,weak,rejected,rejectedFraction,translationDirectionEdges:dirEdges,meanTranslationDirectionResidualDeg:Number.isFinite(dirResidualDeg)?dirResidualDeg:null,translationDirectionMeanInlierFraction:Number.isFinite(lineInlierFraction)?lineInlierFraction:null,meanEpipolarPlaneResidualDeg:Number.isFinite(epipolarResidualDeg)?epipolarResidualDeg:null,requiredEdges,requiredDirection,requiredActive,usableSwitchSupport:usable};
}
