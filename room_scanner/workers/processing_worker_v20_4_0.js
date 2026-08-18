/*
 * Room Scanner V20.4 - raw-ray + dense point-Gaussian + Deep multi-view fusion worker.
 *
 * Nothing in this file is executed while WebXR owns the camera/compositor.
 * Raw WebXR measurements remain authoritative for metric scale. Depth Anything
 * is a dense geometric/color prior that must be calibrated against those
 * measurements and confirmed across views before it is allowed to create new
 * permanent geometry.
 */
import {CaptureRepository} from '../js/db_v20_2_0.js';
import {decodePointBatch,decodeRayBatchToPoints} from '../js/xr_capture_v20_2_0.js';
import {buildAcousticReadyModel,clusterResidualObjects,decimateSurfels,fitStructuralPlanes} from '../js/reconstruction_v20_4_0.js';
import {clamp,cross3,dist3,dot3,hashCell,invert4,norm3,projectWorldPoint,sub3,transformDirection4,transformPoint4} from '../js/math_v20_2_0.js';
import {applySegmentTransformToPacked,estimateSegmentTransforms,transformPoseMatrix} from '../js/registration_v20_2_0.js';

let cancelled=false,activeDeep=null;
self.onmessage=e=>{const m=e.data||{};if(m.type==='cancel'){cancelled=true;activeDeep?.terminate();post('cancelled',0,'Interruzione richiesta');return;}if(m.type==='run'){cancelled=false;run(m).catch(error=>postMessage({type:'error',message:error.message,stack:error.stack}));}};

async function run({sessionId,mode='safe',memoryBudgetMB=320}){
  const repo=new CaptureRepository();await repo.open();stage(2,'Apro la sessione persistita');const session=await repo.getSession(sessionId);if(!session)throw new Error('Sessione non trovata');
  const [records,blobRecords,events]=await Promise.all([repo.getRecords(sessionId),repo.getBlobs(sessionId),repo.getEvents(sessionId)]);check();
  const byKind=groupRecords(records),rayBlobs=blobRecords.filter(b=>b.kind==='depth-rays'),depthBlobs=blobRecords.filter(b=>b.kind==='depth-points'),frameBlobs=blobRecords.filter(b=>b.kind==='frame-jpeg');
  // About 70k surfels at the default 320 MB profile. The accumulator keeps
  // moments rather than every raw sample, so the point count is not a RAM leak.
  const maxSurfels=Math.max(70000,Math.min(320000,Math.floor(memoryBudgetMB*650)));
  const rawMarkpoints=(byKind.get('markpoint')||[]).map(r=>r.value),registration=estimateSegmentTransforms(session.segments||[],rawMarkpoints),referenceSegment=registration.referenceSegmentId;let skippedUnregisteredBatches=0;
  stage(5,`Caricati ${rayBlobs.length} batch di raggi, ${depthBlobs.length} batch legacy e ${frameBlobs.length} fotografie`);

  const accumulator=new GaussianAccumulator({maxCells:maxSurfels,voxel:.020});
  let rawRaySamples=0;
  for(let i=0;i<rayBlobs.length;i++){
    check();const b=rayBlobs[i],segmentId=b.meta?.segmentId||referenceSegment,reg=registration.transforms[segmentId];if(segmentId!==referenceSegment&&!reg?.registered){skippedUnregisteredBatches++;continue;}
    try{let packed=decodeRayBatchToPoints(await b.blob.arrayBuffer(),{cameraMatrix:b.meta?.cameraMatrix,projectionMatrix:b.meta?.projectionMatrix});rawRaySamples+=packed.length/10;if(reg?.matrix)packed=applySegmentTransformToPacked(packed,reg.matrix);const origin=b.meta?.origin||[b.meta?.cameraMatrix?.[12]||0,b.meta?.cameraMatrix?.[13]||0,b.meta?.cameraMatrix?.[14]||0],viewOrigin=reg?.matrix?transformPoint4(reg.matrix,origin):origin;accumulator.addPacked(packed,{source:'xr-depth-ray',viewOrigin,segmentId});}catch(error){post('warning',5+20*(i+1)/Math.max(1,rayBlobs.length),`Ray batch ${i} ignorato: ${error.message}`);}
    if(i%5===0)stage(5+20*(i+1)/Math.max(1,rayBlobs.length),`Fusione raggi metrici ${i+1}/${rayBlobs.length}`);
  }
  for(let i=0;i<depthBlobs.length;i++){
    check();const b=depthBlobs[i],origin=b.meta?.origin||[0,0,0],segmentId=b.meta?.segmentId||referenceSegment,reg=registration.transforms[segmentId];if(segmentId!==referenceSegment&&!reg?.registered){skippedUnregisteredBatches++;continue;}
    try{let packed=decodePointBatch(await b.blob.arrayBuffer(),origin);if(reg?.matrix)packed=applySegmentTransformToPacked(packed,reg.matrix);accumulator.addPacked(packed,{source:'xr-depth',viewOrigin:reg?.matrix?transformPoint4(reg.matrix,origin):origin,segmentId});}catch(error){post('warning',5+24*(i+1)/Math.max(1,depthBlobs.length),`Batch ${i} ignorato: ${error.message}`);}
    if(i%4===0)stage(25+6*(i+1)/Math.max(1,depthBlobs.length),`Fusione legacy ${i+1}/${depthBlobs.length}`);
  }
  for(const record of byKind.get('hit-test-chunk')||[]){const segmentId=record.value.segmentId||referenceSegment,reg=registration.transforms[segmentId];if(segmentId!==referenceSegment&&!reg?.registered)continue;for(const h of record.value.hits||[]){let p=h.position,n=h.normal;if(reg?.matrix){p=transformPoint4(reg.matrix,p);n=transformDirection4(reg.matrix,n);}accumulator.add({position:p,normal:n,rgb:[145,145,145],quality:.28,source:'hit-test',surfaceType:'unknown',viewOrigin:h.origin||null});}}
  const snapshots=byKind.get('grid-snapshot')||[],latestSnapshot=[...snapshots].reverse().find(r=>{const sid=r.value.segmentId||referenceSegment;return sid===referenceSegment||registration.transforms[sid]?.registered;})?.value;
  if(latestSnapshot){const reg=registration.transforms[latestSnapshot.segmentId||referenceSegment];for(const t of latestSnapshot.tiles||[]){if(t.predicted)continue;const tile={...t};if(reg?.matrix){tile.center=transformPoint4(reg.matrix,t.center);tile.normal=transformDirection4(reg.matrix,t.normal);}accumulator.addTile(tile);}}
  let points=accumulator.toSurfels();stage(31,`${points.length} Gaussian 3D puntiformi da ${rawRaySamples} raggi prima di Deep`);await saveCheckpoint(repo,sessionId,'metric-fusion',{gaussianCount:points.length,rawRaySamples,rayBatches:rayBlobs.length,legacyPointBatches:depthBlobs.length,registration,skippedUnregisteredBatches});

  let deepSummary={status:'not-requested'};
  if(mode==='deep'&&frameBlobs.length){
    try{deepSummary=await mergeDeepFrames({frameBlobs,frameRecords:byKind.get('frame-meta')||[],accumulator,registration,referenceSegment,memoryBudgetMB,progressBase:32,progressSpan:36});points=accumulator.toSurfels({dropUnconfirmedDeep:true});stage(69,`Deep multi-view: ${points.length} Gaussian 3D, ${deepSummary.validFrames}/${deepSummary.selectedFrames} frame calibrati`);await saveCheckpoint(repo,sessionId,'deep-fusion',deepSummary);}
    catch(error){deepSummary={status:'failed',message:error.message};post('warning',69,`Depth Anything non disponibile; mantengo la mappa WebXR: ${error.message}`);}
  }

  check();stage(72,'Compattazione fine: rimuovo solo ridondanza sub-centimetrica');
  points=decimateSurfels(points,{maxPoints:Math.min(maxSurfels,320000)});await saveCheckpoint(repo,sessionId,'decimation',{surfelCount:points.length});check();
  stage(80,'Fit strutturale sopra la mappa densa (la mappa originale resta nel modello)');const fit=fitStructuralPlanes(points);await saveCheckpoint(repo,sessionId,'structural-fit',{stats:fit.stats,planes:fit.planes});check();
  stage(89,'Raggruppo i residui persistenti in oggetti RGB');const objects=clusterResidualObjects(fit.residual,{maxPoints:Math.min(26000,Math.floor(memoryBudgetMB*70))});check();
  const markpoints=rawMarkpoints.map(m=>transformEntityPoint(m,registration,referenceSegment)),frames=(byKind.get('frame-meta')||[]).map(r=>transformFrameMeta(r.value,registration,referenceSegment)).filter(Boolean),chirps=(byKind.get('chirp')||[]).map(r=>transformChirp(r.value,registration,referenceSegment)).filter(Boolean),audio=blobRecords.filter(b=>b.kind==='audio-pcm').map(b=>({key:b.key,size:b.size,meta:b.meta}));
  stage(95,'Creo modello 3D + superfici acusticamente indirizzabili');const model=buildAcousticReadyModel({session,points,fit,objects,markpoints,frames,chirps,audio,registration,diagnostics:events});
  // Backward compatible extension: viewers that only know `surfels` keep
  // working, while newer tools can use covariance/scales as true Gaussian data.
  model.format='ROOMSCAN-MODEL-20.4';model.geometry.gaussianCount=points.filter(p=>p.gaussian).length;model.geometry.gaussianEncoding='point3d.mean+covariance6+scale+normal+rgb+confidence+ray-provenance';model.geometry.rawRaySamples=rawRaySamples;model.geometry.rawRayBatches=rayBlobs.length;model.geometry.rawRayFormat='RSRY-1';model.processing={...(model.processing||{}),deepFusion:deepSummary};
  await repo.putModel(sessionId,model);await repo.patchSession(sessionId,{status:'processed',flags:{processingStarted:true},processing:{finishedAt:Date.now(),mode,surfelCount:points.length,planeCount:fit.planes.length,objectCount:objects.length,deepFusion:compactDeepSummary(deepSummary)}});await repo.drain(2500);stage(100,'Modello salvato');postMessage({type:'complete',model,summary:{surfels:points.length,gaussians:model.geometry.gaussianCount,planes:fit.planes.length,objects:objects.length,frames:frames.length,chirps:chirps.length,deep:compactDeepSummary(deepSummary)}});repo.close();
}

class GaussianAccumulator{
  constructor({maxCells,voxel}){this.maxCells=maxCells;this.voxel=voxel;this.map=new Map();this.seen=0;}
  addPacked(a,{source='xr-depth',frameId=null,viewOrigin=null}={}){for(let i=0;i+9<a.length;i+=10)this.add({position:[a[i],a[i+1],a[i+2]],normal:[a[i+3],a[i+4],a[i+5]],rgb:[a[i+6],a[i+7],a[i+8]],quality:a[i+9],source,frameId,viewOrigin});}
  addTile(t){this.add({position:t.center,normal:t.normal,rgb:t.rgb,quality:t.overall??t.geometry??.5,source:'grid',frameId:t.frameRefs?.[0]?.id||t.frameRefs?.[0]||null,surfaceType:t.surfaceType,status:t.status,curvature:t.curvature,frameRefs:t.frameRefs,markpointId:t.markpointId,gaussian:t.gaussian});}
  _key(p,size=this.voxel){return hashCell(p,size);}
  _cellFor(p,source){
    // Deep points may join a nearby metric/confirmed cell rather than creating
    // a second fuzzy surface 4 cm away. XR points retain exact voxel indexing.
    if(source==='deep'){const near=this.nearest(p,.052);if(near)return near;}
    const key=this._key(p);return {key,cell:this.map.get(key)||null,distance:0};
  }
  nearest(p,radius=.09){const s=this.voxel,ix=Math.floor(p[0]/s),iy=Math.floor(p[1]/s),iz=Math.floor(p[2]/s),r=Math.max(1,Math.ceil(radius/s));let best=null,bestD=radius;for(let dx=-r;dx<=r;dx++)for(let dy=-r;dy<=r;dy++)for(let dz=-r;dz<=r;dz++){const key=`${ix+dx},${iy+dy},${iz+dz}`,c=this.map.get(key);if(!c||!c.w)continue;const q=[c.p[0]/c.w,c.p[1]/c.w,c.p[2]/c.w],d=dist3(p,q);if(d<bestD){bestD=d;best={key,cell:c,distance:d,mean:q};}}return best;}
  add(p){
    if(!p.position?.every(Number.isFinite))return false;this.seen++;
    const found=this._cellFor(p.position,p.source),key=found.key;let c=found.cell;if(!c){c={w:0,p:[0,0,0],m2:[0,0,0,0,0,0],n:[0,0,0],rgb:[0,0,0],rgb2:[0,0,0],q:0,count:0,frameRefs:new Set(),deepFrames:new Set(),views:new Map(),surfaceVotes:new Map(),markpointId:null,status:'green',curvature:0,last:this.seen,sources:{xr:0,deep:0,hit:0,grid:0},firstTime:Date.now(),lastTime:Date.now()};this.map.set(key,c);}
    // Deep disagreement with a stable metric surface is rejected instead of
    // thickening the wall. This is the central multi-source consistency gate.
    if(p.source==='deep'&&found.cell&&found.distance>.018){const mean=found.mean||[c.p[0]/c.w,c.p[1]/c.w,c.p[2]/c.w],nn=norm3(c.n),planeResidual=Math.abs(dot3(nn,sub3(p.position,mean)));const tol=.026+.014*Math.max(0,p.depthM||dist3(p.position,p.viewOrigin||p.position));if(c.sources.xr>=2&&planeResidual>tol)return false;if(c.sources.deep>=2&&found.distance>.062)return false;}
    const important=p.markpointId||p.surfaceType==='object'||p.surfaceType==='edge'||p.status!=='green',sourceScale=p.source==='deep'?.62:(p.source==='hit-test'?.25:(p.source==='grid'?.30:1)),w=(.06+clamp(p.quality??.5,0,1))*sourceScale;
    c.w+=w;c.count++;const [x,y,z]=p.position;for(let k=0;k<3;k++){c.p[k]+=p.position[k]*w;c.n[k]+=(p.normal?.[k]||0)*w;c.rgb[k]+=(p.rgb?.[k]??145)*w;c.rgb2[k]+=(p.rgb?.[k]??145)**2*w;}c.m2[0]+=x*x*w;c.m2[1]+=x*y*w;c.m2[2]+=x*z*w;c.m2[3]+=y*y*w;c.m2[4]+=y*z*w;c.m2[5]+=z*z*w;c.q+=(p.quality??.5)*w;c.last=this.seen;c.lastTime=Date.now();c.curvature=Math.max(c.curvature,p.curvature||0);
    for(const f of p.frameRefs||[])c.frameRefs.add(typeof f==='string'?f:f.id);if(p.frameId){c.frameRefs.add(p.frameId);if(p.source==='deep')c.deepFrames.add(p.frameId);}if(p.viewOrigin){const vk=`${Math.round(p.viewOrigin[0]/.16)},${Math.round(p.viewOrigin[1]/.16)},${Math.round(p.viewOrigin[2]/.16)}`;c.views.set(vk,p.viewOrigin);}
    if(p.surfaceType)c.surfaceVotes.set(p.surfaceType,(c.surfaceVotes.get(p.surfaceType)||0)+w);if(p.status&&p.status!=='green')c.status=p.status;c.markpointId||=p.markpointId||null;if(p.source==='deep')c.sources.deep++;else if(p.source==='hit-test')c.sources.hit++;else if(p.source==='grid')c.sources.grid++;else c.sources.xr++;
    if(this.map.size>this.maxCells*1.07)this.prune();return true;
  }
  prune(){const arr=[...this.map.entries()];arr.sort((a,b)=>cellImportance(a[1])-cellImportance(b[1]));const remove=Math.ceil(this.map.size-this.maxCells*.93);for(let i=0;i<remove;i++)this.map.delete(arr[i][0]);}
  toCalibrationPoints({max=12000}={}){let out=[];for(const [id,c] of this.map){if(!c.w)continue;const stable=c.sources.xr>=2||c.sources.grid>=2||(c.sources.deep>=2&&c.deepFrames.size>=2);if(!stable)continue;out.push(this._surfel(id,c));}out.sort((a,b)=>anchorImportance(b)-anchorImportance(a));if(out.length>max){const step=out.length/max,sub=[];for(let i=0;i<max;i++)sub.push(out[Math.floor(i*step)]);out=sub;}return out;}
  toSurfels({dropUnconfirmedDeep=false}={}){const out=[];for(const [id,c] of this.map){if(dropUnconfirmedDeep&&c.sources.xr===0&&c.sources.grid===0&&c.sources.deep>0&&c.deepFrames.size<2)continue;out.push(this._surfel(id,c));}return out;}
  _surfel(id,c){const iw=1/c.w,p=c.p.map(v=>v*iw),cov=[Math.max(1e-6,c.m2[0]*iw-p[0]*p[0]),c.m2[1]*iw-p[0]*p[1],c.m2[2]*iw-p[0]*p[2],Math.max(1e-6,c.m2[3]*iw-p[1]*p[1]),c.m2[4]*iw-p[1]*p[2],Math.max(1e-6,c.m2[5]*iw-p[2]*p[2])],scales=scaleProxy(cov),surfaceType=[...c.surfaceVotes].sort((a,b)=>b[1]-a[1])[0]?.[0]||inferSurface(norm3(c.n),c.curvature),rgb=c.rgb.map(v=>Math.round(v*iw)),rgbStd=[0,1,2].map(k=>Math.sqrt(Math.max(0,c.rgb2[k]*iw-rgb[k]*rgb[k]))),viewCount=c.views.size,baseline=maxBaseline([...c.views.values()]);const quality=clamp(c.q*iw*(.72+.09*Math.min(3,viewCount))+(c.sources.xr>0?.08:0),0,1),confirmed=c.sources.xr>0||c.sources.grid>0||c.deepFrames.size>=2;return {id,position:p,normal:norm3(c.n),rgb,quality,curvature:c.curvature,frameRefs:[...c.frameRefs].slice(0,12),surfaceType,status:c.status,markpointId:c.markpointId,sourceCounts:{...c.sources},viewCount,maxBaselineM:baseline,gaussian:{kind:'point3d',mean:p,covariance6:cov,scale:scales,normal:norm3(c.n),rgbMean:rgb,rgbStd,rayTerminated:true,opacity:clamp(.15+.85*quality,0,1),confidence:quality,confirmed,support:c.count,viewCount,deepViewCount:c.deepFrames.size,maxBaselineM:baseline}};}
}
function cellImportance(c){return (c.markpointId?100:0)+c.frameRefs.size*1.1+c.deepFrames.size*1.4+c.views.size*.8+c.curvature*3+Math.min(5,c.count*.14)+(c.sources.xr>0?4:0)+(c.status!=='green'?1:0)+(c.last/1e8);}
function anchorImportance(p){return (p.sourceCounts.xr||0)*2+(p.sourceCounts.grid||0)+p.viewCount*.5+(p.gaussian?.confirmed?2:0)+(p.quality||0);}

async function mergeDeepFrames({frameBlobs,frameRecords,accumulator,registration,referenceSegment,memoryBudgetMB,progressBase,progressSpan}){
  const metaById=new Map(frameRecords.map(r=>[r.value.id,r.value])),candidates=[];
  for(const b of frameBlobs){const frameId=b.meta?.id||extractFrameId(b.key),raw=metaById.get(frameId)||b.meta,meta=transformFrameMeta(raw,registration,referenceSegment);if(meta?.pose?.matrix&&meta?.pose?.projectionMatrix)candidates.push({blobRecord:b,frameId,meta});}
  const maxFrames=Math.max(64,Math.min(240,Math.round(memoryBudgetMB*.55))),selected=selectDeepFrames(candidates,maxFrames);if(!selected.length)throw new Error('Nessuna fotografia con posa metrica valida');
  const worker=new Worker(new URL('./depth_ai_worker_v20_3_0.js',import.meta.url));activeDeep=worker;const ready=await workerRequest(worker,{type:'init',webgpuRuntimeUrls:['../vendor/onnxruntime-web/ort.webgpu.min.js','https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/ort.webgpu.min.js'],runtimeUrls:['../vendor/onnxruntime-web/ort.min.js','https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/ort.min.js'],modelUrls:['../models/depth_anything_v2_vits_q4.onnx','https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_q4.onnx'],wasmPaths:'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/'},'ready',120000);
  let validFrames=0,rejectedFrames=0,acceptedPoints=0,rejectedPoints=0;const calibrations=[],inferenceTimes=[];let temporalPrior=null;
  for(let i=0;i<selected.length;i++){
    check();const f=selected[i],result=await workerRequest(worker,{type:'process',requestId:`deep-${i}`,frameId:f.frameId,blob:f.blobRecord.blob,inputSize:518},'result',120000);inferenceTimes.push(result.inferenceMs||0);const depth=new Float32Array(result.depth),rgb=new Uint8Array(result.rgb),anchors=accumulator.toCalibrationPoints({max:14000}),cal=calibrateDepthRobust(depth,result.width,result.height,f.meta,anchors,temporalPrior);
    if(cal.valid){
      validFrames++;temporalPrior=updateTemporalPrior(temporalPrior,cal);calibrations.push({frameId:f.frameId,mode:cal.mode,a:cal.a,b:cal.b,residualM:cal.residualM,anchors:cal.anchors,tiles:cal.tiles,confidence:cal.confidence});
      const dense=reprojectDeepDense(depth,rgb,result.width,result.height,f.meta,cal,f.frameId,{stride:selected.length>190?6:(selected.length>125?5:4)});let accepted=0;for(const p of dense){if(accumulator.add(p))accepted++;}acceptedPoints+=accepted;rejectedPoints+=dense.length-accepted;
      post('progress',progressBase+progressSpan*(i+1)/selected.length,`Deep ${i+1}/${selected.length}: ${accepted}/${dense.length} punti, residuo ${cal.residualM.toFixed(3)} m`);
    }else{rejectedFrames++;post('warning',progressBase+progressSpan*(i+1)/selected.length,`Deep ${i+1}/${selected.length}: calibrazione rifiutata (${cal.reason||'ancore insufficienti'})`);}
  }
  worker.terminate();activeDeep=null;return {status:'complete',selectedFrames:selected.length,availableFrames:candidates.length,validFrames,rejectedFrames,acceptedPoints,rejectedPoints,provider:ready.provider||'unknown',runtimeFlavor:ready.runtimeFlavor||'unknown',medianCalibrationResidualM:medianLocal(calibrations.map(c=>c.residualM)),medianInferenceMs:medianLocal(inferenceTimes),calibrations:calibrations.slice(0,180),policy:{metricAuthority:'WebXR',singleViewDeepCreatesPermanentGeometry:false,multiViewConfirmation:true,perFrameRobustCalibration:true,temporalCalibrationPrior:true}};
}

function selectDeepFrames(candidates,maxFrames){
  if(candidates.length<=maxFrames)return candidates;
  const selected=[],remaining=new Set(candidates),covered=new Set();
  const forced=candidates.filter(c=>/manual|markpoint/i.test(c.meta.reason||''));for(const c of forced){if(selected.length>=maxFrames)break;selected.push(c);remaining.delete(c);for(const t of c.meta.linkedTiles||[])covered.add(t.tileId||t.id);}
  while(selected.length<maxFrames&&remaining.size){let best=null,bestScore=-Infinity;for(const c of remaining){const q=c.meta.quality||{},links=c.meta.linkedTiles||[],uncovered=links.filter(t=>!covered.has(t.tileId||t.id)).length,need=links.filter(t=>t.needDeep||t.status==='red'||t.status==='yellow').length,base=.42*(q.sharpness||0)+.25*(q.exposureScore||0)+.04*Math.min(8,uncovered)+.025*Math.min(10,need)+(c.meta.reason==='grid-deep'?.35:0);let diversity=.6;if(selected.length){let minD=Infinity,minAngle=Infinity;for(const s of selected){const a=c.meta.pose.position,b=s.meta.pose.position;minD=Math.min(minD,dist3(a,b));const fa=forwardFromPose(c.meta.pose.matrix),fb=forwardFromPose(s.meta.pose.matrix);minAngle=Math.min(minAngle,Math.acos(clamp(dot3(fa,fb),-1,1)));}diversity=.75*clamp(minD/.55,0,1)+.25*clamp(minAngle/(28*Math.PI/180),0,1);}const score=base+.70*diversity;if(score>bestScore){bestScore=score;best=c;}}
    if(!best)break;selected.push(best);remaining.delete(best);for(const t of best.meta.linkedTiles||[])covered.add(t.tileId||t.id);
  }
  return selected;
}
function forwardFromPose(m){return norm3([-(m?.[8]||0),-(m?.[9]||0),-(m?.[10]??1)]);}

function calibrateDepthRobust(depth,w,h,meta,points,prior){
  const worldFromCamera=meta.pose.matrix,view=invert4(worldFromCamera),proj=meta.pose.projectionMatrix;if(!view)return {valid:false,reason:'pose-non-invertibile'};const perTile=new Map();
  const step=Math.max(1,Math.floor(points.length/5200));for(let i=0;i<points.length;i+=step){const p=points[i],screen=projectWorldPoint(p.position,view,proj,w,h);if(!screen?.inside)continue;const cam=transformPoint4(view,p.position),z=-cam[2];if(z<.16||z>9.5)continue;const x=clamp(Math.round(screen.x),0,w-1),y=clamp(Math.round(screen.y),0,h-1),d=depth[y*w+x];if(!Number.isFinite(d)||Math.abs(d)<1e-7)continue;const tile=`${Math.floor(x/(w/8))},${Math.floor(y/(h/6))}`,arr=perTile.get(tile)||[];if(arr.length<14)arr.push({d,z,weight:.35+.65*clamp(p.quality??.5,0,1),tile});perTile.set(tile,arr);}
  const pairs=[...perTile.values()].flat();if(pairs.length<14||perTile.size<4)return {valid:false,reason:`ancore=${pairs.length}, tile=${perTile.size}`,anchors:pairs.length,tiles:perTile.size};
  const direct=robustAffineWeighted(pairs,false),inverse=robustAffineWeighted(pairs,true);let best=direct.score<=inverse.score?direct:inverse;
  if(prior&&prior.mode===best.mode&&best.residual<.30){const blend=clamp(.18*(1-best.residual/.30),0,.18);best={...best,a:best.a*(1-blend)+prior.a*blend,b:best.b*(1-blend)+prior.b*blend};best.residual=evaluateResidual(pairs,best);}
  const confidence=clamp(1-best.residual/.32,0,1)*clamp(perTile.size/16,0.35,1)*clamp(pairs.length/80,.45,1),valid=best.residual<.30&&pairs.length>=14&&perTile.size>=4&&Number.isFinite(best.a+best.b)&&confidence>.20;
  return {valid,reason:valid?null:'residuo/dispersione eccessivi',mode:best.mode,a:best.a,b:best.b,residualM:best.residual,anchors:pairs.length,tiles:perTile.size,confidence};
}
function robustAffineWeighted(pairs,inverse){let data=pairs.map(p=>({x:inverse?1/safeDepthValue(p.d):p.d,y:p.z,w:p.weight})),fit=weightedLinear(data);for(let k=0;k<4;k++){const residuals=data.map(p=>Math.abs(p.y-(fit.a*p.x+fit.b))),med=medianLocal(residuals),mad=medianLocal(residuals.map(r=>Math.abs(r-med)))||.012,limit=Math.max(.025,med+2.7*mad);data=data.filter(p=>Math.abs(p.y-(fit.a*p.x+fit.b))<=limit);if(data.length<10)break;fit=weightedLinear(data);}const residual=medianLocal(data.map(p=>Math.abs(p.y-(fit.a*p.x+fit.b)))),score=residual*(1+8/Math.max(8,data.length));return {...fit,residual,score,mode:inverse?'inverse':'direct'};}
function weightedLinear(data){let sw=0,mx=0,my=0;for(const p of data){sw+=p.w;mx+=p.x*p.w;my+=p.y*p.w;}mx/=sw||1;my/=sw||1;let xx=0,xy=0;for(const p of data){xx+=p.w*(p.x-mx)**2;xy+=p.w*(p.x-mx)*(p.y-my);}const a=xy/(xx||1e-9),b=my-a*mx;return {a,b};}
function evaluateResidual(pairs,fit){return medianLocal(pairs.map(p=>Math.abs(p.z-depthToMeters(p.d,fit))));}
function safeDepthValue(d){return Math.abs(d)<1e-6?(d<0?-1e-6:1e-6):d;}
function depthToMeters(d,cal){return cal.mode==='inverse'?cal.a/safeDepthValue(d)+cal.b:cal.a*d+cal.b;}
function updateTemporalPrior(prior,cal){if(!prior||prior.mode!==cal.mode)return {mode:cal.mode,a:cal.a,b:cal.b};return {mode:cal.mode,a:.78*cal.a+.22*prior.a,b:.78*cal.b+.22*prior.b};}

function reprojectDeepDense(depth,rgb,w,h,meta,cal,frameId,{stride=8}={}){
  const invProj=invert4(meta.pose.projectionMatrix),world=meta.pose.matrix;if(!invProj)return [];const camera=meta.pose.position||[world[12],world[13],world[14]],out=[];
  const pointAt=(x,y)=>{if(x<0||y<0||x>=w||y>=h)return null;const d=depth[y*w+x],z=depthToMeters(d,cal);if(!Number.isFinite(z)||z<.16||z>9.5)return null;const far=transformPoint4(invProj,[x/(w-1)*2-1,1-y/(h-1)*2,1]),ray=norm3(far);if(ray[2]>=-.01)return null;const k=z/(-ray[2]),cam=[ray[0]*k,ray[1]*k,ray[2]*k];return {p:transformPoint4(world,cam),z};};
  const half=Math.max(2,Math.floor(stride*.65));for(let y=Math.floor(stride/2);y<h-stride;y+=stride)for(let x=Math.floor(stride/2);x<w-stride;x+=stride){const c=pointAt(x,y);if(!c)continue;const px=pointAt(x+half,y),py=pointAt(x,y+half);let normal=[0,0,0],surfaceType='unknown',curvature=0,localConsistency=.42;if(px&&py){const dx=sub3(px.p,c.p),dy=sub3(py.p,c.p),jump=Math.max(Math.abs(px.z-c.z),Math.abs(py.z-c.z)),edgeThreshold=.055+.035*c.z;if(jump<=edgeThreshold){normal=norm3(cross3(dx,dy));if(dot3(normal,sub3(camera,c.p))<0)normal=normal.map(v=>-v);localConsistency=clamp(1-jump/edgeThreshold,.35,1);}else{curvature=clamp(jump/(edgeThreshold*2),.25,1);surfaceType='edge';}}
    if(Math.hypot(...normal)<.5){normal=norm3(sub3(camera,c.p));localConsistency*=.62;}
    const ny=normal[1];if(surfaceType!=='edge')surfaceType=Math.abs(ny)>.78?(ny>0?'floor':'ceiling'):(Math.abs(ny)<.34?'wall':'object');const idx=(y*w+x)*3,luma=(.2126*rgb[idx]+.7152*rgb[idx+1]+.0722*rgb[idx+2])/255,exposure=clamp(1-Math.abs(luma-.5)*1.45,0.25,1),quality=clamp((.18+.72*cal.confidence)*localConsistency*exposure,.08,.82);out.push({position:c.p,normal,rgb:[rgb[idx],rgb[idx+1],rgb[idx+2]],quality,source:'deep',frameId,viewOrigin:camera,surfaceType,curvature,depthM:c.z});}
  return out;
}

function scaleProxy(cov){const a=[Math.sqrt(Math.max(1e-7,cov[0])),Math.sqrt(Math.max(1e-7,cov[3])),Math.sqrt(Math.max(1e-7,cov[5]))].sort((x,y)=>y-x);return [clamp(Math.max(.006,a[0]*1.45),.006,.050),clamp(Math.max(.005,a[1]*1.45),.005,.044),clamp(Math.max(.0035,a[2]*1.30),.0035,.032)];}
function inferSurface(n,curvature=0){if(curvature>.20)return 'edge';return Math.abs(n[1])>.78?(n[1]>0?'floor':'ceiling'):(Math.abs(n[1])<.34?'wall':'object');}
function maxBaseline(origins){let b=0;for(let i=0;i<origins.length;i++)for(let j=i+1;j<origins.length;j++)b=Math.max(b,dist3(origins[i],origins[j]));return b;}
function compactDeepSummary(s){if(!s)return null;const {calibrations,...rest}=s;return rest;}
function workerRequest(worker,message,expected,timeoutMs){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>cleanup(new Error(`Timeout ${expected}`)),timeoutMs);const onMessage=e=>{const m=e.data||{};if(m.type==='error'&&(m.requestId==null||m.requestId===message.requestId))cleanup(new Error(m.message));else if(m.type===expected&&(message.requestId==null||m.requestId===message.requestId))cleanup(null,m);};const onError=e=>cleanup(e.error||new Error(e.message));function cleanup(error,value){clearTimeout(timer);worker.removeEventListener('message',onMessage);worker.removeEventListener('error',onError);error?reject(error):resolve(value);}worker.addEventListener('message',onMessage);worker.addEventListener('error',onError);worker.postMessage(message);});}
function transformFrameMeta(meta,registration,referenceSegment){if(!meta)return null;const sid=meta.segmentId||referenceSegment,reg=registration.transforms[sid];if(sid!==referenceSegment&&!reg?.registered)return null;if(!reg?.matrix)return meta;const pose={...meta.pose,matrix:Array.from(transformPoseMatrix(meta.pose.matrix,reg.matrix)),position:transformPoint4(reg.matrix,meta.pose.position)};return {...meta,pose,registeredFromSegment:sid};}
function transformEntityPoint(entity,registration,referenceSegment){const sid=entity.segmentId||referenceSegment,reg=registration.transforms[sid];if(!reg?.matrix)return {...entity,registered:sid===referenceSegment||!!reg?.registered};return {...entity,position:transformPoint4(reg.matrix,entity.position),registered:true,registeredFromSegment:sid};}
function transformChirp(chirp,registration,referenceSegment){const sid=chirp.segmentId||referenceSegment,reg=registration.transforms[sid];if(sid!==referenceSegment&&!reg?.registered)return null;if(!reg?.matrix)return chirp;const pose=chirp.pose?{...chirp.pose,position:transformPoint4(reg.matrix,chirp.pose.position),matrix:chirp.pose.matrix?Array.from(transformPoseMatrix(chirp.pose.matrix,reg.matrix)):chirp.pose.matrix}:chirp.pose;return {...chirp,pose,registeredFromSegment:sid};}
async function saveCheckpoint(repo,sessionId,name,value){await repo.enqueueRecord(sessionId,'processing-checkpoint',{name,time:Date.now(),value},{key:`${sessionId}/processing/${name}`});}
function groupRecords(records){const m=new Map();for(const r of records){if(!m.has(r.kind))m.set(r.kind,[]);m.get(r.kind).push(r);}return m;}
function stage(progress,detail){post('progress',progress,detail);}function post(type,progress,detail){postMessage({type,progress,detail,time:Date.now()});}function check(){if(cancelled)throw new Error('Processing annullato');}function extractFrameId(key){const m=key.match(/(frame-[0-9a-f-]+)/i);return m?.[1]||key;}function medianLocal(a){if(!a.length)return 0;const b=[...a].filter(Number.isFinite).sort((x,y)=>x-y);if(!b.length)return 0;const m=Math.floor(b.length/2);return b.length%2?b[m]:(b[m-1]+b[m])/2;}
