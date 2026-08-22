import {ProbabilisticJointOptimizer} from './joint_optimizer.js?v=30.49.0';
import {evaluateLiveCandidate} from './live_optimization_gate.js?v=30.49.0';
import {evaluatePoseScaffoldPolicy} from './pose_scaffold_policy.js?v=30.49.0';
import {evaluateRgbConsensusPolicy} from './rgb_consensus_policy.js?v=30.49.0';

const now=()=>globalThis.performance?.now?.()??Date.now();
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

/**
 * Single optimisation runtime used both during acquisition and in REVIEW.
 *
 * There is intentionally only one estimator implementation in V30.40:
 * ProbabilisticJointOptimizer.  This runtime only schedules it, gates candidate
 * states and exposes deterministic diagnostics.  It does not introduce a second
 * mathematical optimiser or a fallback solution path.
 *
 * The runtime executes on the main thread in short, explicit slices. This is
 * deliberate: the previous module-worker path could fail before the optimiser
 * even started, leaving no usable stack trace. A single in-process path is much
 * easier to inspect while this estimator is being validated on real scans.
 */
export class SingleOptimizerRuntime{
  constructor({initial=null,onTrace=null}={}){
    this.acceptedSnapshot=initial||null;
    this.acceptedStats=initial?.stats||null;
    this.workingSnapshot=this.acceptedSnapshot;
    this.onTrace=typeof onTrace==='function'?onTrace:null;
    this.busy=false;
    this.stopped=false;
    this.token=0;
    this.generation=0;
    this.stallCount=0;
    this.lastGraphSignature=null;
  }
  reset(initial=null){
    this.acceptedSnapshot=initial||null;
    this.acceptedStats=initial?.stats||null;
    this.workingSnapshot=this.acceptedSnapshot;
    this.stopped=false;
    this.stallCount=0;
    this.lastGraphSignature=null;
    this.token++;
    return this;
  }
  stop(){this.stopped=true;this.token++;}
  resume(){this.stopped=false;}
  snapshot(){return {snapshot:this.acceptedSnapshot,stats:this.acceptedStats};}

  async runCycle(job={}){
    if(this.busy)return {type:'single-opt-deferred',reason:'busy',trigger:job.reason||null};
    const graph=job.graph||{},summary=graph.summary||{
      frames:graph.frames?.length||0,
      landmarks:graph.landmarkFactors?.length||0,
      deepFrames:graph.deepFactors?.length||0,
      photoEdges:graph.edgeFactors?.length||0,
      alvaEdges:graph.alvaFactors?.length||0,
      mvsSamples:(graph.mvsFactors||[]).reduce((n,x)=>n+(x.count||x.samples?.length||0),0)
    };
    if((summary.frames||0)<2||(summary.landmarks||0)<4){
      return {type:'single-opt-deferred',reason:'insufficient-scaffold',trigger:job.reason||null,summary};
    }
    this.busy=true;this.stopped=false;const token=++this.token,generation=++this.generation,start=now();
    try{
      const signature=graphSignature(summary);if(signature!==this.lastGraphSignature){this.stallCount=0;this.lastGraphSignature=signature;}
      const baseOptions={...(job.options||{})};
      const acceptedOpt=new ProbabilisticJointOptimizer(graph,{...baseOptions,initial:this.acceptedSnapshot||job.initial||null});
      const baselineStats=acceptedOpt.computeStats(),baselineSnapshot=acceptedOpt.snapshot();
      const opt=new ProbabilisticJointOptimizer(graph,{...baseOptions,initial:this.workingSnapshot||this.acceptedSnapshot||job.initial||null});
      const workingBaselineStats=opt.computeStats(),workingBaselineSnapshot=opt.snapshot();
      const budget=Math.max(6,Number(job.budgetMs)||30),maxIterations=Math.max(1,Math.min(8,Number(job.maxIterations)||1)),gateOptions=job.gateOptions||{},bootstrapThreshold=Number(gateOptions.maxReprojectionPx??3.2),workingMetric=preferredReprojection(workingBaselineStats),warmupIterations=Math.max(0,Number(baseOptions.rgbWarmupIterations??2)||0),workingIterations=Math.max(0,Number(workingBaselineStats?.iterations)||0),bootstrap=!this.acceptedSnapshot&&(workingIterations<warmupIterations||!Number.isFinite(workingMetric)||workingMetric>bootstrapThreshold);
      const traceBase={generation,trigger:job.reason||null,mode:job.mode||'live',summary,windowDiagnostics:graph.windowDiagnostics||null};
      this.trace('cycle-start',{...traceBase,budgetMs:budget,maxIterations,bootstrap,acceptedSeed:!!this.acceptedSnapshot,workingSeed:!!this.workingSnapshot,stallCount:this.stallCount,baseline:compactStats(baselineStats),workingBaseline:compactStats(workingBaselineStats)});
      const steps=[];let iterations=0;
      while(iterations<maxIterations&&!this.stopped&&token===this.token){
        const t=now(),stats=opt.step(1,{bootstrap,allowDepth:!bootstrap}),dt=now()-t;iterations++;
        const row={iteration:iterations,ms:dt,phase:stats.feedbackPhase,reprojectionRmse:finiteOrNull(stats.reprojectionRmse),reprojectionRobustRmse:finiteOrNull(stats.reprojectionRobustRmse),reprojectionMedianPx:finiteOrNull(stats.reprojectionMedianPx),reprojectionP90Px:finiteOrNull(stats.reprojectionP90Px),reprojectionInlierFraction4px:finiteOrNull(stats.reprojectionInlierFraction4px),deepRelativeError:finiteOrNull(stats.deepRelativeError),poseShiftMean:finiteOrNull(stats.poseShiftMean),edgeRejected:stats.edgeSwitches?.rejected??null,alvaRejected:stats.alvaSwitches?.rejected??null};steps.push(row);this.trace('step',{...traceBase,...row});
        if(now()-start>=budget)break;
        await yieldUi();
      }
      if(this.stopped||token!==this.token)return {type:'single-opt-stopped',generation,trigger:job.reason||null,summary};
      const candidateStats=opt.computeStats(),candidateSnapshot=opt.snapshot();
      const gate=applyRgbConsensusGuard(evaluateLiveCandidate({baselineStats,candidateStats,baselineSnapshot,candidateSnapshot,options:gateOptions}),candidateStats,{bootstrap}),elapsed=now()-start;
      this.trace('gate',{...traceBase,elapsedMs:elapsed,accepted:gate.accepted,score:finiteOrNull(gate.score),hardReasons:gate.hardReasons||[],softReasons:gate.softReasons||[],poseDelta:gate.poseDelta||null,baseline:compactStats(baselineStats),candidate:compactStats(candidateStats)});
      if(gate.accepted){
        // A live cycle sees only a bounded graph window. Replacing the accepted
        // snapshot with that local state discards every pose/landmark correction
        // accepted in older windows. Merge by persistent IDs instead: the
        // accepted state is global even though every solve remains local.
        this.acceptedSnapshot=mergeOptimizerSnapshots(this.acceptedSnapshot,candidateSnapshot);this.acceptedStats=candidateStats;this.workingSnapshot=this.acceptedSnapshot;this.stallCount=0;
        const preview=await this.makePreview(opt,job,summary,traceBase);
        const anchors=opt.landmarkPreview(Math.max(40,Math.min(900,Number(job.maxPreviewLandmarks)||320)))
          .filter(x=>(x.confidence||0)>.20)
          .sort((a,b)=>(b.confidence||0)*(b.support||1)-(a.confidence||0)*(a.support||1))
          .slice(0,Math.max(40,Math.min(180,Number(job.maxPreviewAnchors)||90)))
          .map(x=>({id:x.id,p:x.position,confidence:x.confidence,support:x.support}));
        return {type:'single-opt-accepted',generation,trigger:job.reason,elapsedMs:elapsed+preview.mapMs,solveMs:elapsed,mapMs:preview.mapMs,iterations,steps,stats:candidateStats,gate,snapshot:this.acceptedSnapshot,anchors,previewGaussians:preview.previewGaussians,previewStats:preview.previewStats,summary};
      }
      const workingGate=evaluateLiveCandidate({baselineStats:workingBaselineStats,candidateStats,baselineSnapshot:workingBaselineSnapshot,candidateSnapshot,options:{maxReprojectionPx:1e6,maxReprojectionGrowth:1.12,reprojectionSlackPx:.35,maxCommonTranslationJump:.24,maxCommonRotationJumpRad:.16,maxMeanTranslationJump:.12,maxMeanRotationJumpRad:.08,maxDepthErrorGrowth:2.2,maxRejectedEdgeGrowth:8}}),progress=evaluateBootstrapProgress(workingBaselineStats,candidateStats,workingGate),workingRetained=progress.retain;
      this.workingSnapshot=workingRetained?mergeOptimizerSnapshots(this.workingSnapshot||this.acceptedSnapshot,candidateSnapshot):this.acceptedSnapshot;if(workingRetained)this.stallCount=0;else this.stallCount++;
      if(bootstrap)this.trace(workingRetained?'bootstrap-progress':'bootstrap-no-progress',{...traceBase,workingRetained,stallCount:this.stallCount,progress,workingGate,baseline:compactStats(workingBaselineStats),candidate:compactStats(candidateStats)});
      if(!workingRetained&&this.stallCount>=4)return {type:'single-opt-stalled',generation,trigger:job.reason,elapsedMs:elapsed,solveMs:elapsed,mapMs:0,iterations,steps,stats:candidateStats,baselineStats,gate,workingGate,workingRetained:false,workingSnapshot:null,bootstrap:true,stallCount:this.stallCount,progress,summary};
      return {type:'single-opt-rejected',generation,trigger:job.reason,elapsedMs:elapsed,solveMs:elapsed,mapMs:0,iterations,steps,stats:candidateStats,baselineStats,gate,workingGate,workingRetained,workingSnapshot:workingRetained?candidateSnapshot:null,bootstrap,stallCount:this.stallCount,progress,summary};
    }catch(err){
      const out={type:'single-opt-error',generation,trigger:job.reason||null,message:err?.message||String(err),stack:err?.stack||null,summary,elapsedMs:now()-start};
      this.trace('exception',out);return out;
    }finally{this.busy=false;}
  }

  async reconcileRgbScaffold(graph,options={}){
    if(!graph?.frames?.length)return null;const start=now(),initial=this.acceptedSnapshot||options.initial||null,opt=new ProbabilisticJointOptimizer(graph,{...(options.optimizer||{}),initial}),baseStats=opt.computeStats(),baseSnapshot=opt.snapshot(),n=opt.frames?.length||0,w=Math.max(8,Number(options.optimizer?.localWindowSize)||20),o=Math.max(2,Number(options.optimizer?.localWindowOverlap)||6),windows=n<=w?1:Math.max(1,Math.ceil((n-o)/Math.max(1,w-o))),passes=Math.max(4,Math.min(24,Number(options.passes)||windows*2)),globalPasses=Math.max(12,Math.min(48,Number(options.globalLinePasses)||36));
    opt.recoverRgbScaffold?.({iterations:globalPasses,gain:.55,maxStep:.14});await yieldUi();
    for(let i=0;i<passes;i++){opt.step(1,{bootstrap:true,allowDepth:false,rgbScaffoldRecovery:true});if((i&1)===1)await yieldUi();}
    const candidateStats=opt.computeStats(),candidateSnapshot=opt.snapshot(),basePolicy=scaffoldPolicyFromStats(baseStats,graph),candidatePolicy=scaffoldPolicyFromStats(candidateStats,graph),br=preferredReprojection(baseStats),cr=preferredReprojection(candidateStats),safeReprojection=!Number.isFinite(br)||cr<=br*1.06+.12,noCollapse=!candidateStats?.rgbConsensusCollapsed,scaffoldUpgrade=(candidatePolicy.observed&&!basePolicy.observed)||(candidatePolicy.translationDirectionEdges>=Math.max(basePolicy.translationDirectionEdges+4,candidatePolicy.requiredDirection)&&candidatePolicy.active>=Math.max(basePolicy.active,candidatePolicy.requiredActive));
    const consensusUpgrade=!!candidateStats?.rgbConsensusCommitReady&&!baseStats?.rgbConsensusCommitReady,accepted=safeReprojection&&noCollapse&&(candidatePolicy.observed||scaffoldUpgrade||consensusUpgrade);
    if(accepted){this.acceptedSnapshot=mergeOptimizerSnapshots(this.acceptedSnapshot,candidateSnapshot);this.acceptedStats=candidateStats;this.workingSnapshot=this.acceptedSnapshot;this.stallCount=0;}
    this.trace('postscan-rgb-scaffold',{accepted,passes,globalPasses,windows,safeReprojection,scaffoldUpgrade,consensusUpgrade,baseline:compactStats(baseStats),candidate:compactStats(candidateStats),baselinePolicy:basePolicy,candidatePolicy,elapsedMs:now()-start});
    return {accepted,snapshot:accepted?this.acceptedSnapshot:baseSnapshot,stats:accepted?candidateStats:baseStats,baselineStats:baseStats,candidateStats,baselinePolicy:basePolicy,candidatePolicy,elapsedMs:now()-start};
  }

  async rebuildAccepted(graph,options={}){
    if(!this.acceptedSnapshot)return null;
    const t=now();
    try{
      // The live accepted snapshot is intentionally local. Before committed
      // geometry, sweep the COMPLETE graph with the SAME optimizer but RGB-only
      // so frames acquired after the last accepted window are not left at raw
      // Alva priors. This is a reconciliation stage, not a second optimizer.
      const opt=new ProbabilisticJointOptimizer(graph,{...(options.optimizer||{}),initial:this.acceptedSnapshot}),baseStats=opt.computeStats(),baseSnapshot=opt.snapshot(),basePolicyBeforeRecovery=scaffoldPolicyFromStats(baseStats,graph);if(!basePolicyBeforeRecovery.observed)opt.recoverRgbScaffold?.({iterations:Math.max(12,Math.min(36,Number(options.optimizer?.globalLinePasses)||24)),gain:.50,maxStep:.12});const recoveryStats=opt.computeStats(),n=opt.frames?.length||0,w=Math.max(6,Number(options.optimizer?.localWindowSize)||18),o=Math.max(2,Number(options.optimizer?.localWindowOverlap)||5),windows=n<=w?1:Math.max(1,Math.ceil((n-o)/Math.max(1,w-o))),passes=Math.max(1,Math.min(20,Number(options.reconcileRgbPasses)||windows*2));
      for(let i=0;i<passes;i++){opt.step(1,{bootstrap:true,allowDepth:false,rgbScaffoldRecovery:!basePolicyBeforeRecovery.observed});if((i&1)===1)await yieldUi();}
      const reconciledStats=opt.computeStats(),reconciledSnapshot=opt.snapshot(),reconcileGate=applyRgbConsensusGuard(evaluateLiveCandidate({baselineStats:baseStats,candidateStats:reconciledStats,baselineSnapshot:baseSnapshot,candidateSnapshot:reconciledSnapshot,options:{maxReprojectionPx:4.5,maxReprojectionGrowth:1.10,reprojectionSlackPx:.22,maxCommonTranslationJump:.20,maxCommonRotationJumpRad:.14,maxMeanTranslationJump:.08,maxMeanRotationJumpRad:.055,maxDepthErrorGrowth:99,maxRejectedEdgeGrowth:10}}),reconciledStats,{bootstrap:false,commit:true}),br=preferredReprojection(baseStats),cr=preferredReprojection(reconciledStats),edgeBase=Number(baseStats.edgeSwitches?.mean||0),edgeNew=Number(reconciledStats.edgeSwitches?.mean||0),baseScaffold=scaffoldPolicyFromStats(baseStats,graph),newScaffold=scaffoldPolicyFromStats(reconciledStats,graph),scaffoldUpgrade=(newScaffold.observed&&!baseScaffold.observed)||(newScaffold.translationDirectionEdges>=Math.max(baseScaffold.translationDirectionEdges+4,newScaffold.requiredDirection)),safeReprojection=!Number.isFinite(br)||cr<=br*1.06+.12,hardReasons=[...(reconcileGate.hardReasons||[])],blockingHard=hardReasons.filter(r=>r!=='rgb-consensus-insufficient-for-commit'),noHard=!hardReasons.length,directScaffoldOverride=!blockingHard.length&&safeReprojection&&newScaffold.observed&&newScaffold.directLineBackbone&&!baseScaffold.observed,useReconciled=directScaffoldOverride||(noHard&&safeReprojection&&!(edgeBase>.25&&edgeNew<edgeBase*.40)&&(reconcileGate.accepted||scaffoldUpgrade||(reconciledStats.rgbConsensusCommitReady&&!baseStats.rgbConsensusCommitReady)));
      this.trace('commit-reconcile',{passes,windows,useReconciled,directScaffoldOverride,selectionReason:directScaffoldOverride?'direct-rgb-scaffold-override':reconcileGate.accepted?'gate-accepted':scaffoldUpgrade?'rgb-scaffold-upgrade':(reconciledStats.rgbConsensusCommitReady&&!baseStats.rgbConsensusCommitReady)?'rgb-consensus-upgrade':'baseline-retained',gate:reconcileGate,baselineScaffold:baseScaffold,candidateScaffold:newScaffold,baseline:compactStats(baseStats),candidate:compactStats(reconciledStats)});
      const commitOpt=useReconciled?opt:new ProbabilisticJointOptimizer(graph,{...(options.optimizer||{}),initial:this.acceptedSnapshot}),acceptedFrameIds=new Set((this.acceptedSnapshot?.frames||[]).map(f=>String(f.frameId))),commitFrameIds=useReconciled?null:acceptedFrameIds,preCommitStats=commitOpt.computeStats(),preCommitScaffold=scaffoldPolicyFromStats(preCommitStats,graph);
      // A numerically low reprojection is not enough when the RGB graph has
      // switched itself almost completely off. In that state Alva can explain
      // the trajectory while dense evidence is projected into a wrong world.
      // Keep the optimized snapshot for diagnostics, but do not manufacture a
      // committed surface until independent RGB consensus exists again.
      const rgbWithheldReason=preCommitStats?.rgbConsensusCollapsed?'rgb-consensus-collapsed':(preCommitStats?.rgbConsensusCommitReady===false&&!preCommitScaffold.observed)?'rgb-consensus-insufficient-for-commit':null;
      if(rgbWithheldReason)this.trace('commit-candidate-rebuild',{reason:rgbWithheldReason,reconciled:useReconciled,stats:compactStats(preCommitStats),acceptedCoverage:{acceptedFrames:acceptedFrameIds.size,totalFrames:graph.frames?.length||0},poseScaffoldPolicy:preCommitScaffold,advice:'rebuild continues only to measure MVS/Deep observability; output remains candidate-only'});
      // If full-graph reconciliation is rejected, never fill the final surface
      // with frames that are still only raw Alva priors. Old V30.40 sessions may
      // contain a local accepted snapshot; those unaccepted frames remain
      // candidate-only until a later successful reconciliation.
      const map=commitOpt.rebuild({...options.rebuild,...(commitFrameIds?{commitFrameIds}: {})}),elapsedMs=now()-t,stats=commitOpt.computeStats(),localSnapshot=commitOpt.snapshot(),snapshot=useReconciled?mergeOptimizerSnapshots(this.acceptedSnapshot,localSnapshot):this.acceptedSnapshot;
      // REVIEW should continue from the reconciled/full-depth state rather than
      // repeatedly returning to the last small live window.
      if(useReconciled){this.acceptedSnapshot=snapshot;this.acceptedStats=stats;this.workingSnapshot=snapshot;}
      const meshQuality=map?.stats?.meshQuality||null,geometryPolicy=map?.stats?.geometryPolicy||null;
      this.trace('mesh-quality',{elapsedMs,status:meshQuality?.status||'empty',quality:meshQuality,geometryPolicy,poseScaffoldPolicy:map?.stats?.poseScaffoldPolicy||null,depthGeometryPolicy:map?.stats?.depthGeometryPolicy||null,mvsValidation:map?.stats?.mvsValidation||null,surfaceLayers:map?.mesh?.surfaceLayers??null,sourceSurfels:map?.mesh?.sourceSurfels??null,inputSurfels:map?.mesh?.inputSurfels??null,reconciled:useReconciled});
      this.trace('rebuild',{elapsedMs,stats:map?.stats||null,gaussians:map?.gaussians?.length||0,faces:map?.mesh?.faces?.length?map.mesh.faces.length/3:0,reconciled:useReconciled,acceptedCoverage:{acceptedFrames:acceptedFrameIds.size,totalFrames:graph.frames?.length||0,excludedUnacceptedFrames:map?.stats?.excludedUnacceptedFrames||0}});
      const geometryWithheldReason=geometryPolicy&&geometryPolicy.commitReady===false?(geometryPolicy.reason||'final-geometry-policy-rejected'):null,withheldReason=rgbWithheldReason||geometryWithheldReason;
      if(withheldReason){this.trace('commit-withheld',{elapsedMs,reason:withheldReason,rgbWithheldReason,geometryWithheldReason,reconciled:useReconciled,geometryPolicy,poseScaffoldPolicy:map?.stats?.poseScaffoldPolicy||null,depthGeometryPolicy:map?.stats?.depthGeometryPolicy||null,mvsValidation:map?.stats?.mvsValidation||null});return {map,stats,snapshot,elapsedMs,reconciled:useReconciled,reconcileGate,acceptedFrameIds:[...acceptedFrameIds],withheldReason};}
      return {map,stats,snapshot,elapsedMs,reconciled:useReconciled,reconcileGate,acceptedFrameIds:[...acceptedFrameIds]};
    }catch(err){this.trace('rebuild-error',{message:err?.message||String(err),stack:err?.stack||null});throw err;}
  }

  async makePreview(opt,job,summary,traceBase){
    let previewGaussians=null,previewStats=null,mapMs=0;
    if(job.previewMap&&String(opt.lastFeedbackPhase||opt.computeStats()?.feedbackPhase)==='depth-feedback'&&(summary.deepFrames||0)>0){
      const mt=now();try{
        const map=opt.rebuild({voxel:Number(job.previewVoxel)||.055,hashVoxel:Number(job.previewHashVoxel)||.04,maxSurfels:Math.max(700,Math.min(3500,Number(job.previewMaxSurfels)||2200)),maxTriangles:Math.max(300,Math.min(1800,Number(job.previewMaxTriangles)||900)),maxDeepSamples:Math.max(800,Math.min(6000,Number(job.previewMaxDeepSamples)||3200)),maxMvsSamples:Math.max(1000,Math.min(7000,Number(job.previewMaxMvsSamples)||3800)),submapSize:Math.max(4,Number(job.previewSubmapSize)||6),submapOverlap:2,deepFrameWeightBudget:10});
        previewStats=map.stats||null;previewGaussians=map.stats?.geometryPolicy?.commitReady===false?null:(map.gaussians||[]).slice(0,Number(job.previewMaxSurfels)||2200);if(!previewGaussians?.length&&map.gaussians?.length)this.trace('preview-map-withheld',{...traceBase,reason:map.stats?.geometryPolicy?.reason||'geometry-policy',geometryPolicy:map.stats?.geometryPolicy||null,poseScaffoldPolicy:map.stats?.poseScaffoldPolicy||null,mvsValidation:map.stats?.mvsValidation||null,depthGeometryPolicy:map.stats?.depthGeometryPolicy||null});
      }catch(err){this.trace('preview-map-error',{...traceBase,message:err?.message||String(err),stack:err?.stack||null});}
      mapMs=now()-mt;
    }
    return {previewGaussians,previewStats,mapMs};
  }
  trace(event,data){try{this.onTrace?.(event,data);}catch{}}
}

export function mergeOptimizerSnapshots(base,patch){
  if(!base)return cloneSnapshot(patch);if(!patch)return cloneSnapshot(base);
  const out={...base,...patch,format:patch.format||base.format||'ROOMSCAN-PROB-OPT-2'};
  out.frames=mergeBy(base.frames,patch.frames,x=>String(x.frameId));
  out.landmarks=mergeBy(base.landmarks,patch.landmarks,x=>String(x.id));
  out.edgeSwitches=mergeEdgeState(base.edgeSwitches,patch.edgeSwitches,'ROOMSCAN-SWITCHABLE-RGB-EDGES-1');
  out.alvaSwitches=mergeEdgeState(base.alvaSwitches,patch.alvaSwitches,'ROOMSCAN-SWITCHABLE-ALVA-1');
  out.depthCalibration=mergeDepthCalibration(base.depthCalibration,patch.depthCalibration);
  out.iterations=Math.max(Number(base.iterations)||0,Number(patch.iterations)||0);
  out.stats=patch.stats||base.stats||null;
  return out;
}
function mergeBy(a,b,key){const m=new Map();for(const x of a||[])if(x)m.set(key(x),structuredCloneSafe(x));for(const x of b||[])if(x)m.set(key(x),structuredCloneSafe(x));return [...m.values()];}
function mergeEdgeState(a,b,format){if(!a&&!b)return null;return {format:b?.format||a?.format||format,edges:mergeBy(a?.edges,b?.edges,x=>pairKey(String(x.aId),String(x.bId)))};}
function mergeDepthCalibration(a,b){if(!a&&!b)return null;if(!a)return structuredCloneSafe(b);if(!b)return structuredCloneSafe(a);return {...a,...b,frames:mergeBy(a.frames,b.frames,x=>String(x.frameId)),stats:b.stats||a.stats||null,gamma:Array.from(b.gamma||a.gamma||[]),domain:b.domain?{...b.domain}:a.domain?{...a.domain}:null};}
function cloneSnapshot(x){return x?structuredCloneSafe(x):null;}
function structuredCloneSafe(x){if(x==null)return x;try{return globalThis.structuredClone?globalThis.structuredClone(x):JSON.parse(JSON.stringify(x));}catch{return JSON.parse(JSON.stringify(x));}}
function pairKey(a,b){return a<b?`${a}|${b}`:`${b}|${a}`;}


function applyRgbConsensusGuard(gate,stats,{bootstrap=false,commit=false}={}){
  const e=stats?.edgeSwitches||{},policy=evaluateRgbConsensusPolicy(e),{edges,rejected,active,mean}=policy,collapsed=!!stats?.rgbConsensusCollapsed||policy.collapsed,commitReady=stats?.rgbConsensusCommitReady!==false&&policy.commitReady;
  if(bootstrap||(!collapsed&&(!commit||commitReady)))return gate;
  const hard=[...(gate?.hardReasons||[])],reason=collapsed?'rgb-consensus-collapsed':'rgb-consensus-insufficient-for-commit';if(!hard.includes(reason))hard.push(reason);
  const warnings=[...(gate?.warnings||gate?.softReasons||[])];if(commit&&!warnings.includes('commit-requires-rgb-consensus'))warnings.push('commit-requires-rgb-consensus');
  return {...gate,accepted:false,hardReasons:hard,warnings,softReasons:warnings,rgbConsensusGuard:{edges,active,rejected,mean,collapsed,commitReady}};
}

function scaffoldPolicyFromStats(stats,graph){return evaluatePoseScaffoldPolicy({edgeStats:stats?.edgeSwitches||null,photoAudit:graph?.photoEdgeAudit||null,frameCount:graph?.frames?.length||0});}
function compactStats(s){return {iterations:s?.iterations,reprojectionRmse:finiteOrNull(s?.reprojectionRmse),reprojectionRobustRmse:finiteOrNull(s?.reprojectionRobustRmse),reprojectionIndependentRobustRmse:finiteOrNull(s?.reprojectionIndependentRobustRmse),reprojectionOptimizationRobustRmse:finiteOrNull(s?.reprojectionOptimizationRobustRmse),reprojectionMedianPx:finiteOrNull(s?.reprojectionMedianPx),reprojectionP90Px:finiteOrNull(s?.reprojectionP90Px),reprojectionInlierFraction4px:finiteOrNull(s?.reprojectionInlierFraction4px),poseShiftMean:finiteOrNull(s?.poseShiftMean),poseRotationShiftMeanRad:finiteOrNull(s?.poseRotationShiftMeanRad),deepRelativeError:finiteOrNull(s?.deepRelativeError),feedbackPhase:s?.feedbackPhase,observations:s?.observations,landmarks:s?.landmarks,edgeSwitches:s?.edgeSwitches,rgbConsensusCollapsed:!!s?.rgbConsensusCollapsed,rgbConsensusCommitReady:s?.rgbConsensusCommitReady!==false,rgbActiveFraction:finiteOrNull(s?.rgbActiveFraction),rgbRejectedFraction:finiteOrNull(s?.rgbRejectedFraction),rgbEdgeImportFraction:finiteOrNull(s?.rgbEdgeImportFraction),rgbEdgeInput:s?.rgbEdgeInput,rgbEdgeUnresolved:s?.rgbEdgeUnresolved,alvaSwitches:s?.alvaSwitches,reliability:s?.reliability};}
function preferredReprojection(s){const r=Number(s?.reprojectionRobustRmse);return Number.isFinite(r)?r:Number(s?.reprojectionRmse);}
function evaluateBootstrapProgress(b,c,gate){const br=preferredReprojection(b),cr=preferredReprojection(c),be=Number(b?.energy),ce=Number(c?.energy),bm=Number(b?.reprojectionMedianPx),cm=Number(c?.reprojectionMedianPx),hard=(gate?.hardReasons||[]).filter(x=>x!=='robust-reprojection-absolute'),reprojGain=Number.isFinite(br)&&Number.isFinite(cr)?(br-cr)/Math.max(.25,br):0,energyGain=Number.isFinite(be)&&Number.isFinite(ce)?(be-ce)/Math.max(.05,Math.abs(be)):0,medianGain=Number.isFinite(bm)&&Number.isFinite(cm)?(bm-cm)/Math.max(.25,bm):0,catastrophic=hard.length>0||(Number.isFinite(br)&&Number.isFinite(cr)&&cr>br*1.08+.25),retain=!catastrophic&&(reprojGain>.002||energyGain>.006||medianGain>.003);return {retain,reprojGain,energyGain,medianGain,baselineRobustPx:finiteOrNull(br),candidateRobustPx:finiteOrNull(cr),hardReasons:hard};}
function graphSignature(s){return [s?.frames||0,s?.landmarks||0,s?.photoEdges||0,s?.alvaEdges||0,s?.deepFrames||0,s?.mvsSamples||0].join(':');}
function finiteOrNull(v){return Number.isFinite(v)?v:null;}
function yieldUi(){return new Promise(r=>setTimeout(r,0));}
