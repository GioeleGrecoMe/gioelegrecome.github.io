/**
 * Global gate for allowing monocular Deep estimates to create committed surface.
 * Cross-view self-consistency is not enough when the global inverse-depth
 * calibration is itself poor. V30.42 could mark thousands of samples trusted
 * while the calibration median relative residual exceeded 50%.
 */
export function evaluateDepthGeometryPolicy(calibration,reliabilitySummary=null){
  const s=calibration?.stats||{},frames=calibration?.frames||[];
  const medianRelativeResidual=finiteOr(s.medianRelativeResidual,Infinity),p90RelativeResidual=finiteOr(s.p90RelativeResidual,Infinity),informativeFrames=Math.max(0,Number(s.informativeFrames)||0),informativeAnchors=Math.max(0,Number(s.informativeAnchors)||0),globalReady=!!(s.globalAffineReady??s.globalNonlinearityReady),looFrames=Math.max(0,Number(s.leaveOneFrameOutFrames)||0),looMedian=finiteOr(s.leaveOneFrameOutMedianRelativeResidual,Infinity),ordinalAgreement=finiteOr(s.ordinalAgreement,0),hasClosureValidation='globalAffineReady' in s;
  const conf=frames.map(x=>Number(x?.confidence)).filter(Number.isFinite).sort((a,b)=>a-b),medianFrameConfidence=quantile(conf,.5),p25FrameConfidence=quantile(conf,.25),meanDepthConfidence=Number.isFinite(+reliabilitySummary?.meanDepthConfidence)?+reliabilitySummary.meanDepthConfidence:null;
  const residualGood=medianRelativeResidual<=.34;
  const tailNotCatastrophic=p90RelativeResidual<=4.0||medianRelativeResidual<=.22;
  const confidenceGood=(Number.isFinite(medianFrameConfidence)&&medianFrameConfidence>=.075)||(Number.isFinite(meanDepthConfidence)&&meanDepthConfidence>=.075)||medianRelativeResidual<=.20;
  const observable=globalReady&&informativeFrames>=3&&informativeAnchors>=80,validated=!hasClosureValidation||(looFrames>=3&&looMedian<=.30&&ordinalAgreement>=.68);
  const commitAllowed=observable&&residualGood&&tailNotCatastrophic&&confidenceGood&&validated;
  let reason='ok';if(!observable)reason='depth-calibration-unobservable';else if(!residualGood)reason='depth-calibration-residual-high';else if(!tailNotCatastrophic)reason='depth-calibration-tail-high';else if(!confidenceGood)reason='depth-calibration-confidence-low';else if(!validated)reason=looFrames<3?'depth-leave-one-frame-out-insufficient':looMedian>.30?'depth-leave-one-frame-out-residual-high':'depth-ordinal-consistency-low';
  return {commitAllowed,reason,medianRelativeResidual,p90RelativeResidual,informativeFrames,informativeAnchors,globalReady,looFrames,looMedian:Number.isFinite(looMedian)?looMedian:null,ordinalAgreement,validated,medianFrameConfidence:Number.isFinite(medianFrameConfidence)?medianFrameConfidence:null,p25FrameConfidence:Number.isFinite(p25FrameConfidence)?p25FrameConfidence:null,meanDepthConfidence};
}

export function classifyDenseDepthAuthority({classification='unknown',independentSupport=0,hasMetricAnchor=false,dynamic=false}={}){
  if(dynamic)return {committable:false,level:'prior',reason:'dynamic-region'};
  if(classification==='conflicting')return {committable:false,level:'rejected',reason:'cross-view-conflict'};
  if(classification==='trusted'&&hasMetricAnchor&&independentSupport>=1)return {committable:true,level:'high',reason:'metric-anchor-plus-cross-view'};
  if(classification==='trusted'&&independentSupport>=2)return {committable:true,level:'medium',reason:'two-independent-cross-view-confirmations'};
  return {committable:false,level:'prior',reason:'single-view-or-insufficient-support'};
}
function finiteOr(v,d){v=Number(v);return Number.isFinite(v)?v:d;}
function quantile(a,q){if(!a?.length)return NaN;const x=Math.max(0,Math.min(1,q))*(a.length-1),i=Math.floor(x),t=x-i;return a[i]*(1-t)+a[Math.min(a.length-1,i+1)]*t;}
