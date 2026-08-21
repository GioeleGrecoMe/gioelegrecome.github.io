import {ProbabilisticJointOptimizer} from './joint_optimizer.js?v=30.39.2';
import {evaluateLiveCandidate} from './live_optimization_gate.js?v=30.39.2';

const now=()=>globalThis.performance?.now?.()??Date.now();
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

/**
 * Single optimisation runtime used both during acquisition and in REVIEW.
 *
 * There is intentionally only one estimator implementation in V30.39:
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
  }
  reset(initial=null){
    this.acceptedSnapshot=initial||null;
    this.acceptedStats=initial?.stats||null;
    this.workingSnapshot=this.acceptedSnapshot;
    this.stopped=false;
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
      const baseOptions={...(job.options||{})};
      const acceptedOpt=new ProbabilisticJointOptimizer(graph,{...baseOptions,initial:this.acceptedSnapshot||job.initial||null});
      const baselineStats=acceptedOpt.computeStats(),baselineSnapshot=acceptedOpt.snapshot();
      const opt=new ProbabilisticJointOptimizer(graph,{...baseOptions,initial:this.workingSnapshot||this.acceptedSnapshot||job.initial||null});
      const workingBaselineStats=opt.computeStats(),workingBaselineSnapshot=opt.snapshot();
      const budget=Math.max(6,Number(job.budgetMs)||30),maxIterations=Math.max(1,Math.min(8,Number(job.maxIterations)||1));
      const traceBase={generation,trigger:job.reason||null,mode:job.mode||'live',summary,windowDiagnostics:graph.windowDiagnostics||null};
      this.trace('cycle-start',{...traceBase,budgetMs:budget,maxIterations,acceptedSeed:!!this.acceptedSnapshot,workingSeed:!!this.workingSnapshot,baseline:compactStats(baselineStats),workingBaseline:compactStats(workingBaselineStats)});
      const steps=[];let iterations=0;
      while(iterations<maxIterations&&!this.stopped&&token===this.token){
        const t=now(),stats=opt.step(1),dt=now()-t;iterations++;
        const row={iteration:iterations,ms:dt,phase:stats.feedbackPhase,reprojectionRmse:finiteOrNull(stats.reprojectionRmse),deepRelativeError:finiteOrNull(stats.deepRelativeError),poseShiftMean:finiteOrNull(stats.poseShiftMean),edgeRejected:stats.edgeSwitches?.rejected??null,alvaRejected:stats.alvaSwitches?.rejected??null};steps.push(row);this.trace('step',{...traceBase,...row});
        if(now()-start>=budget)break;
        await yieldUi();
      }
      if(this.stopped||token!==this.token)return {type:'single-opt-stopped',generation,trigger:job.reason||null,summary};
      const candidateStats=opt.computeStats(),candidateSnapshot=opt.snapshot();
      const gate=evaluateLiveCandidate({baselineStats,candidateStats,baselineSnapshot,candidateSnapshot,options:job.gateOptions||{}}),elapsed=now()-start;
      this.trace('gate',{...traceBase,elapsedMs:elapsed,accepted:gate.accepted,score:finiteOrNull(gate.score),hardReasons:gate.hardReasons||[],softReasons:gate.softReasons||[],poseDelta:gate.poseDelta||null,baseline:compactStats(baselineStats),candidate:compactStats(candidateStats)});
      if(gate.accepted){
        this.acceptedSnapshot=candidateSnapshot;this.acceptedStats=candidateStats;this.workingSnapshot=candidateSnapshot;
        const preview=await this.makePreview(opt,job,summary,traceBase);
        const anchors=opt.landmarkPreview(Math.max(40,Math.min(900,Number(job.maxPreviewLandmarks)||320)))
          .filter(x=>(x.confidence||0)>.20)
          .sort((a,b)=>(b.confidence||0)*(b.support||1)-(a.confidence||0)*(a.support||1))
          .slice(0,Math.max(40,Math.min(180,Number(job.maxPreviewAnchors)||90)))
          .map(x=>({id:x.id,p:x.position,confidence:x.confidence,support:x.support}));
        return {type:'single-opt-accepted',generation,trigger:job.reason,elapsedMs:elapsed+preview.mapMs,solveMs:elapsed,mapMs:preview.mapMs,iterations,steps,stats:candidateStats,gate,snapshot:this.acceptedSnapshot,anchors,previewGaussians:preview.previewGaussians,previewStats:preview.previewStats,summary};
      }
      const workingGate=evaluateLiveCandidate({baselineStats:workingBaselineStats,candidateStats,baselineSnapshot:workingBaselineSnapshot,candidateSnapshot,options:{maxReprojectionPx:8,maxReprojectionGrowth:1.8,maxCommonTranslationJump:.24,maxCommonRotationJumpRad:.16,maxMeanTranslationJump:.12,maxMeanRotationJumpRad:.08,maxDepthErrorGrowth:2.2,maxRejectedEdgeGrowth:8}}),workingRetained=workingGate.hardReasons.length===0;
      this.workingSnapshot=workingRetained?candidateSnapshot:this.acceptedSnapshot;
      return {type:'single-opt-rejected',generation,trigger:job.reason,elapsedMs:elapsed,solveMs:elapsed,mapMs:0,iterations,steps,stats:candidateStats,baselineStats,gate,workingGate,workingRetained,summary};
    }catch(err){
      const out={type:'single-opt-error',generation,trigger:job.reason||null,message:err?.message||String(err),stack:err?.stack||null,summary,elapsedMs:now()-start};
      this.trace('exception',out);return out;
    }finally{this.busy=false;}
  }

  async rebuildAccepted(graph,options={}){
    if(!this.acceptedSnapshot)return null;
    const t=now();
    try{
      const opt=new ProbabilisticJointOptimizer(graph,{...(options.optimizer||{}),initial:this.acceptedSnapshot});
      const map=opt.rebuild(options.rebuild||{}),elapsedMs=now()-t;
      this.trace('rebuild',{elapsedMs,stats:map?.stats||null,gaussians:map?.gaussians?.length||0,faces:map?.mesh?.faces?.length?map.mesh.faces.length/3:0});
      return {map,stats:opt.computeStats(),snapshot:opt.snapshot(),elapsedMs};
    }catch(err){this.trace('rebuild-error',{message:err?.message||String(err),stack:err?.stack||null});throw err;}
  }

  async makePreview(opt,job,summary,traceBase){
    let previewGaussians=null,previewStats=null,mapMs=0;
    if(job.previewMap&&String(opt.lastFeedbackPhase||opt.computeStats()?.feedbackPhase)==='depth-feedback'&&(summary.deepFrames||0)>0){
      const mt=now();try{
        const map=opt.rebuild({voxel:Number(job.previewVoxel)||.055,hashVoxel:Number(job.previewHashVoxel)||.04,maxSurfels:Math.max(700,Math.min(3500,Number(job.previewMaxSurfels)||2200)),maxTriangles:Math.max(300,Math.min(1800,Number(job.previewMaxTriangles)||900)),maxDeepSamples:Math.max(800,Math.min(6000,Number(job.previewMaxDeepSamples)||3200)),maxMvsSamples:Math.max(1000,Math.min(7000,Number(job.previewMaxMvsSamples)||3800)),submapSize:Math.max(4,Number(job.previewSubmapSize)||6),submapOverlap:2,deepFrameWeightBudget:10});
        previewGaussians=(map.gaussians||[]).slice(0,Number(job.previewMaxSurfels)||2200);previewStats=map.stats||null;
      }catch(err){this.trace('preview-map-error',{...traceBase,message:err?.message||String(err),stack:err?.stack||null});}
      mapMs=now()-mt;
    }
    return {previewGaussians,previewStats,mapMs};
  }
  trace(event,data){try{this.onTrace?.(event,data);}catch{}}
}

function compactStats(s){return {iterations:s?.iterations,reprojectionRmse:finiteOrNull(s?.reprojectionRmse),poseShiftMean:finiteOrNull(s?.poseShiftMean),poseRotationShiftMeanRad:finiteOrNull(s?.poseRotationShiftMeanRad),deepRelativeError:finiteOrNull(s?.deepRelativeError),feedbackPhase:s?.feedbackPhase,observations:s?.observations,landmarks:s?.landmarks,edgeSwitches:s?.edgeSwitches,alvaSwitches:s?.alvaSwitches,reliability:s?.reliability};}
function finiteOrNull(v){return Number.isFinite(v)?v:null;}
function yieldUi(){return new Promise(r=>setTimeout(r,0));}
