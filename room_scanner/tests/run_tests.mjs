import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {makeESS} from '../js/audio_v20_2_0.js';
import {analyzeRIRWindow} from '../js/acoustics_v20_2_0.js';
import {scoreObservationCell,chooseAdaptiveTileSize,summarizeCoverage} from '../js/grid_v20_2_0.js';
import {computePatchDescriptor,descriptorDistance,MarkpointManager,validateMarkpointCandidate} from '../js/markpoints_v20_2_0.js';
import {selectDeepKeyframes} from '../js/keyframe_selection_v20_2_0.js';
import {encodePointBatch,decodePointBatch,sampleCPUDepth} from '../js/xr_capture_v20_2_0.js';
import {decimateSurfels,fitStructuralPlanes,clusterResidualObjects,buildAcousticReadyModel,buildStructuralPatchMesh} from '../js/reconstruction_v20_2_0.js';
import {estimateSegmentTransforms,applySegmentTransformToPacked,yawTranslationMatrix} from '../js/registration_v20_2_0.js';
import {StoredZipBuilder} from '../js/raw_export_v20_2_0.js';
import {transformPoint4} from '../js/math_v20_2_0.js';
import {InteractiveModelPreview} from '../js/model_preview_v20_2_4.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const results=[];async function test(name,fn){try{await fn();results.push(['PASS',name]);}catch(e){results.push(['FAIL',name]);console.error(`FAIL ${name}\n${e.stack}`);process.exitCode=1;}}

await test('point_batch_roundtrip',()=>{const origin=[1.2,1.5,-.8],a=new Float32Array([1.234,1.568,-.754,.2,.9,-.3,12,140,250,.83, 1.001,1.2,-.3,-.7,.1,.7,200,10,40,.5]);const b=encodePointBatch(a,origin),d=decodePointBatch(b,origin);assert.equal(d.length,a.length);for(let i=0;i<a.length;i++){const tol=i%10<3 ? .0011 : (i%10<6 ? .012 : 1.1);assert.ok(Math.abs(a[i]-d[i])<tol,`${i}: ${a[i]} ${d[i]}`);}});

await test('cpu_depth_sampling_contains_out_of_bounds_failures',()=>{const inverseProjection=[1,0,0,0,0,1,0,0,0,0,-1,0,0,0,0,1],view={projectionMatrix:inverseProjection,transform:{matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}},bad=sampleCPUDepth({width:128,height:96,getDepthInMeters(){throw new RangeError('out-of-bounds');}},view,16,100,[0,0,0]);assert.equal(bad.length,0);assert.ok(bad.depthStats.readErrors>0);const good=sampleCPUDepth({width:128,height:96,getDepthInMeters(x,y){return 1.5+x*.001+y*.0005;}},view,16,100,[0,0,0]);assert.ok(good.length>0);assert.equal(good.depthStats.readErrors,0);});

await test('adaptive_grid_quality',()=>{const weak=scoreObservationCell({count:1,normalSum:[0,1,0],viewCount:1,positionStdM:.2,xrDepthCount:1,frameRefs:[],lastSeen:Date.now(),surfaceType:'object'});assert.equal(weak.status,'red');assert.equal(weak.needDeep,true);const strong=scoreObservationCell({count:20,normalSum:[0,19.5,0],viewCount:4,maxBaselineM:.8,maxParallaxDeg:24,positionStdM:.008,xrDepthCount:18,frameRefs:[{id:1},{id:2},{id:3}],photoViewCount:3,meanSharpness:.9,meanExposureScore:.9,lastSeen:Date.now(),surfaceType:'object'});assert.equal(strong.status,'green');assert.equal(chooseAdaptiveTileSize({...strong,surfaceType:'object'}),.075);const sum=summarizeCoverage([{status:'red',needDeep:true,overall:.1},{status:'green',needDeep:false,overall:.9}]);assert.deepEqual([sum.red,sum.green,sum.deep],[1,1,1]);});

await test('markpoint_validation',()=>{const w=80,h=80,rgba=new Uint8Array(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4,checker=((x>>3)+(y>>3))%2;rgba[i]=checker?250:20;rgba[i+1]=checker?30:220;rgba[i+2]=checker?40:35;rgba[i+3]=255;}const d=computePatchDescriptor(rgba,w,h);const v=validateMarkpointCandidate({position:[1,1,1],depthSamples:[1.21,1.20,1.22,1.21],descriptor:d,existing:[]});assert.ok(v.quality>.65);assert.ok(descriptorDistance(d,d)<1e-9);});

await test('markpoint_manual_multiview_and_move',async()=>{const records=[],repo={enqueueRecord:async(...args)=>records.push(args)},diag={log:async()=>{}},manager=new MarkpointManager({repository:repo,diagnostics:diag,mapWorker:null,sessionId:'session-test',segmentId:'segment-a'}),descriptor={hueHist:Array(12).fill(0),meanSaturation:.8,meanValue:.6,contrast:.3,edgeEnergy:.2};const candidate={frameId:'frame-a',position:[1,1,1],normal:[0,1,0],descriptor,referenceCameraPosition:[0,1.5,0]},validation={valid:true,quality:.9,bestMatch:null,reasons:[]};const point=await manager.accept(candidate,validation);await manager.pin(point.id,{...candidate,frameId:'frame-b',position:[1.04,1,1],referenceCameraPosition:[.45,1.5,0]});assert.equal(point.confirmations.length,1);await manager.pin(point.id,{...candidate,frameId:'frame-c',position:[1.1,1,1],referenceCameraPosition:[.7,1.5,0]},{move:true});assert.deepEqual(point.position,[1.1,1,1]);assert.equal(point.confirmations.length,2);const canonical=records.filter(r=>r[1]==='markpoint').at(-1);assert.equal(canonical[2].confirmations.length,2);assert.ok(records.length>=5);});

await test('markpoint_spatial_pin_is_immediate_and_refinable',async()=>{const records=[],manager=new MarkpointManager({repository:{enqueueRecord:async(...args)=>records.push(args)},diagnostics:{log:async()=>{}},mapWorker:null,sessionId:'session-test',segmentId:'segment-a'}),descriptor={hueHist:Array(12).fill(0),meanSaturation:.8,meanValue:.6,contrast:.3,edgeEnergy:.2};const point=await manager.place({position:[.8,1,.5],normal:[0,1,0],confidence:.7,referenceCameraPosition:[0,1.5,0]});assert.equal(point.status,'pending-photo');assert.equal(point.descriptor,null);await manager.refine(point.id,{frameId:'photo-1',descriptor},{valid:true,quality:.88,reasons:[],scores:{}});assert.equal(point.frameId,'photo-1');assert.equal(point.descriptor,descriptor);assert.ok(records.some(r=>r[1]==='markpoint-refined'));});

await test('deep_keyframe_selection_prefers_quality_and_diversity',()=>{const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],frames=[];for(let i=0;i<12;i++){const id=`f${i}`,position=[i<8?i*.035:.8+(i-8)*.5,1,0],meta={id,pose:{matrix:identity,position},quality:{sharpness:i===10?.98:.52,exposureScore:i===10?.94:.6},linkedTiles:i===11?[{needDeep:true},{needDeep:true}]:[],reason:i===11?'markpoint':'grid-deep'};frames.push({key:id,meta});}const selected=selectDeepKeyframes(frames,frames.map(value=>({value:value.meta})),{maxFrames:4}),ids=new Set(selected.map(x=>x.key));assert.equal(selected.length,4);assert.ok(ids.has('f10'));assert.ok(ids.has('f11'));assert.ok([...ids].some(id=>Number(id.slice(1))<4));});

async function simulateMapWorker(messages){const source=await readFile(path.join(root,'workers/map_worker_v20_2_0.js'),'utf8'),out=[],context={self:{},postMessage:m=>out.push(m),console,Float32Array,ArrayBuffer,Map,Set,Date,Math,Number,Array,Object,String,Boolean,JSON,Infinity};vm.createContext(context);vm.runInContext(source,context,{filename:'map_worker_v20_2_0.js'});for(const data of messages)context.self.onmessage({data});return out;}
function wallBatch(){const values=[];for(let y=.18;y<=2.42;y+=.12)for(let z=-.84;z<=.84;z+=.12)values.push(1,y,z,-1,0,0,145,145,145,.92);return new Float32Array(values);}
await test('map_worker_plane_authority_and_stable_depth_fallback',async()=>{const first=wallBatch(),second=new Float32Array(first);const messages=[{type:'init',sessionId:'sim',budget:30000},{type:'depthBatch',buffer:first.buffer,viewOrigin:[0,1.5,0],viewKey:'view-a',source:'xr-depth',time:1},{type:'depthBatch',buffer:second.buffer,viewOrigin:[0,1.5,.5],viewKey:'view-b',source:'xr-depth',time:2},{type:'snapshot',requestId:1,cameraPosition:[0,1.5,0],radius:9,maxCells:2600}],out=await simulateMapWorker(messages),depthSnapshot=out.find(m=>m.type==='snapshot'&&m.requestId===1);assert.ok(depthSnapshot.tiles.length>0);assert.ok(depthSnapshot.tiles.length<first.length/10/2,`tiles=${depthSnapshot.tiles.length}`);assert.equal(depthSnapshot.stats.predictedTargets,0);assert.ok(depthSnapshot.tiles.every(t=>t.status!=='red'));assert.ok(depthSnapshot.tiles.every(t=>t.source==='stable-depth-grid'));
  const fullWall={id:'wall-full',polygon:[[1,0,-1.2],[1,2.5,-1.2],[1,2.5,1.2],[1,0,1.2]],normal:[-1,0,0]},smallWall={id:'wall-refined',polygon:[[1,0,-.28],[1,.55,-.28],[1,.55,.28],[1,0,.28]],normal:[-1,0,0]};const planeOut=await simulateMapWorker([{type:'init',sessionId:'planes',budget:30000},{type:'planeEstimates',planes:[fullWall],time:10},{type:'snapshot',requestId:2,cameraPosition:[0,1.5,0],radius:9,maxCells:2600},{type:'planeEstimates',planes:[smallWall],time:11},{type:'snapshot',requestId:3,cameraPosition:[0,1.5,0],radius:9,maxCells:2600}]),snapshots=planeOut.filter(m=>m.type==='snapshot'),before=snapshots.find(m=>m.requestId===2),after=snapshots.find(m=>m.requestId===3);assert.ok(before.stats.planeCells>after.stats.planeCells,`${before.stats.planeCells} -> ${after.stats.planeCells}`);assert.ok(after.tiles.every(t=>t.source==='webxr-plane'));});

await test('segment_registration_no_scale',()=>{const T=yawTranslationMatrix(.32,[1.1,.08,-.7]),invPairs=[];const ref=[[0,1,0],[1,1,.2],[-.2,1,1.1]];for(let i=0;i<ref.length;i++){// Construct moving points numerically by applying a known inverse yaw/translation.
  const c=Math.cos(-.32),s=Math.sin(-.32),x=ref[i][0]-1.1,z=ref[i][2]+.7;invPairs.push([c*x-s*z,ref[i][1]-.08,s*x+c*z]);}
const marks=[];for(let i=0;i<3;i++){marks.push({logicalId:`L${i}`,segmentId:'A',position:ref[i],quality:.9},{logicalId:`L${i}`,segmentId:'B',position:invPairs[i],quality:.9});}const reg=estimateSegmentTransforms([{id:'A'},{id:'B'}],marks);assert.equal(reg.transforms.B.registered,true);assert.ok(reg.transforms.B.residualM<.005);const mapped=transformPoint4(reg.transforms.B.matrix,invPairs[1]);assert.ok(Math.hypot(mapped[0]-ref[1][0],mapped[1]-ref[1][1],mapped[2]-ref[1][2])<.005);assert.equal(reg.transforms.B.matrix[15],1);});

function surfel(position,normal,type='unknown',rgb=[130,140,150],quality=.9){return {id:Math.random().toString(36),position,normal,rgb,quality,curvature:type==='object' ? .4 : .01,frameRefs:['f1','f2'],surfaceType:type,status:'green'};}
await test('structural_fit_floor_ceiling_walls',()=>{const pts=[];for(let x=-2;x<=2;x+=.22)for(let z=-1.5;z<=1.5;z+=.22){pts.push(surfel([x,0,z],[0,1,0],'floor'));pts.push(surfel([x,2.6,z],[0,-1,0],'ceiling'));}for(let y=.1;y<2.55;y+=.2)for(let z=-1.5;z<=1.5;z+=.18){pts.push(surfel([-2,y,z],[1,0,0],'wall'));pts.push(surfel([2,y,z],[-1,0,0],'wall'));}for(let y=.1;y<2.55;y+=.2)for(let x=-2;x<=2;x+=.18){pts.push(surfel([x,y,-1.5],[0,0,1],'wall'));pts.push(surfel([x,y,1.5],[0,0,-1],'wall'));}const fit=fitStructuralPlanes(pts,{planeIterations:80,minPlaneSupport:20});assert.ok(fit.floors.length>=1);assert.ok(fit.ceilings.length>=1);assert.ok(fit.walls.length>=4,`walls=${fit.walls.length}`);assert.ok(fit.planes.every(p=>p.bounds));});

await test('webxr_patch_mesh_keeps_disconnected_rooms_disconnected',()=>{const mesh=buildStructuralPatchMesh([{id:'room-a',center:[-2,0,0],normal:[0,1,0],size:.5,surfaceType:'floor',status:'green',rgb:[90,180,150]},{id:'room-b',center:[2,0,0],normal:[0,1,0],size:.5,surfaceType:'floor',status:'green',rgb:[90,180,150]}]);assert.equal(mesh.patchCount,2);assert.equal(mesh.vertices.length,8);assert.equal(mesh.triangles.length,4);assert.equal(mesh.components.length,2);});

await test('mesh_preview_supports_touch_orbit_pinch_and_zoom_controls',()=>{const noop=()=>{},ctx={setTransform:noop,fillRect:noop,beginPath:noop,moveTo:noop,lineTo:noop,closePath:noop,fill:noop,stroke:noop,arc:noop,fillText:noop};const canvas={clientWidth:640,clientHeight:360,width:0,height:0,getContext:()=>ctx,addEventListener:noop,setPointerCapture:noop};const preview=new InteractiveModelPreview(canvas),mesh={vertices:[{position:[0,0,0],rgb:[90,180,150]},{position:[1,0,0],rgb:[90,180,150]},{position:[0,1,0],rgb:[90,180,150]}],triangles:[[0,1,2]],patchCount:1};preview.setModel({geometry:{structuralMesh:mesh,surfels:[]},markpoints:[]});const yaw=preview.yaw;preview._pointerDown({pointerId:1,clientX:20,clientY:20,shiftKey:false});preview._pointerMove({pointerId:1,clientX:65,clientY:34});assert.notEqual(preview.yaw,yaw);const zoom=preview.zoom;preview._pointerDown({pointerId:2,clientX:90,clientY:34,shiftKey:false});preview._pointerMove({pointerId:2,clientX:150,clientY:34});assert.notEqual(preview.zoom,zoom);preview.zoomBy(1.2);assert.ok(preview.zoom>zoom);preview.resetView();assert.equal(preview.zoom,1.65);});

await test('plane_aware_decimation_preserves_markpoint',()=>{const pts=[];for(let i=0;i<4000;i++)pts.push(surfel([i*.002,1,0],[0,0,1],'wall'));pts.push({...surfel([.123,1.1,.3],[1,0,0],'edge'),markpointId:'M1',status:'yellow'});const d=decimateSurfels(pts,{maxPoints:150});assert.ok(d.length<=150);assert.ok(d.some(p=>p.markpointId==='M1'));});

await test('rgb_object_cluster_and_acoustic_faces',()=>{const pts=[];for(let x=0;x<.5;x+=.08)for(let y=.2;y<.9;y+=.08)for(let z=0;z<.4;z+=.08)pts.push(surfel([x,y,z],[1,0,0],'object',[200,50,30]));const objects=clusterResidualObjects(pts,{radius:.14,minPoints:8});assert.ok(objects.length>=1);assert.equal(objects[0].acousticSurfaces.length,6);assert.ok(objects[0].mesh.vertices[0].rgb[0]>150);});

await test('rapid_ess_contract',()=>{const s=makeESS(48000);assert.equal(s.samples.length,Math.round(s.durationS*48000));assert.ok(s.durationS<.2);assert.ok(s.samples.some(v=>Math.abs(v)>.1));});

await test('relative_rir_ignores_hardware_delay',()=>{const sr=8000,sweep=makeESS(sr,{durationS:.08,startHz:120,endHz:3000,level:.5}).samples,hardwareDelay=420,echoDelay=80,signal=new Float32Array(hardwareDelay+sweep.length+echoDelay+900);for(let i=0;i<sweep.length;i++){signal[hardwareDelay+i]+=sweep[i];signal[hardwareDelay+echoDelay+i]+=.42*sweep[i];}const a=analyzeRIRWindow(signal,sweep,sr,{motionQuality:1});assert.ok(a.absoluteDelayS>.03);assert.equal(a.absoluteDelayTrusted,false);assert.ok(a.peaks.some(p=>Math.abs(p.delayS-echoDelay/sr)<.003),JSON.stringify(a.peaks.slice(0,8)));});

await test('stored_zip_contract',async()=>{const z=new StoredZipBuilder();await z.add('manifest.json','{}');await z.add('frames/a.jpg',new Blob([new Uint8Array([1,2,3])]));const b=z.finish(),a=new Uint8Array(await b.arrayBuffer());assert.equal(new DataView(a.buffer).getUint32(0,true),0x04034b50);assert.ok(z.entries.some(e=>e.name==='frames/a.jpg'));});

await test('static_safe_handoff_and_raw_first',async()=>{const xr=await readFile(path.join(root,'js/xr_capture_v20_2_0.js'),'utf8'),app=await readFile(path.join(root,'js/app_v20_2_0.js'),'utf8'),db=await readFile(path.join(root,'js/db_v20_2_0.js'),'utf8');const end=xr.slice(xr.indexOf('async _onSessionEnd'),xr.indexOf('function sampleCPUDepth'));assert.ok(!/processing_worker|depth_ai_worker|location\.(?:reload|href)/.test(end));assert.ok(end.includes("transition('CAPTURE_SAVED'"));assert.ok(!/toDataURL|btoa\s*\(/.test(xr+db));assert.ok(app.indexOf('requestImmersiveSession')<app.indexOf('await repo.createSession'));assert.ok(app.includes('buildRawBundle'));});

await test('static_adaptive_grid_and_no_wall_marking',async()=>{const html=await readFile(path.join(root,'room_scanner_v12.html'),'utf8'),worker=await readFile(path.join(root,'workers/map_worker_v20_2_0.js'),'utf8'),app=await readFile(path.join(root,'js/app_v20_2_0.js'),'utf8'),grid=await readFile(path.join(root,'js/grid_v20_2_0.js'),'utf8'),xr=await readFile(path.join(root,'js/xr_capture_v20_2_0.js'),'utf8'),processing=await readFile(path.join(root,'workers/processing_worker_v20_2_0.js'),'utf8'),preview=await readFile(path.join(root,'js/model_preview_v20_2_4.js'),'utf8');assert.ok(html.includes('grid-overlay'));assert.ok(html.includes('Pinna al reticolo'));assert.ok(html.includes('markpoint-action'));assert.ok(html.includes('telemetry-geometry'));assert.ok(!/Segna parete|Completa vano|angolo parete/i.test(html));assert.ok(worker.includes("surfaceType==='object'"));assert.ok(worker.includes('stableDepthGrid'));assert.ok(worker.includes('planeCells=next'));assert.ok(worker.includes('droppedPoints'));assert.ok(app.includes('pinAtReticle'));assert.ok(app.includes('recoverMismatchedShell'));assert.ok(app.includes('ui-control-missing'));assert.ok(app.includes('downloadPreparedFile({close:false})'));assert.ok(grid.includes('_drawReticle'));assert.ok(grid.includes('_drawMarkpoints'));assert.ok(xr.includes('maxAutoPhotos'));assert.ok(xr.includes('xr-depth-sampling-disabled'));assert.ok(processing.includes('selectDeepKeyframes'));assert.ok(processing.includes('buildStructuralPatchMesh'));assert.ok(preview.includes('InteractiveModelPreview'));assert.ok(preview.includes('2 dita: sposta/zoom'));});


await test('xr_passthrough_and_depth_contract_regression',async()=>{
  const xr=await readFile(path.join(root,'js/xr_capture_v20_2_0.js'),'utf8');
  const css=await readFile(path.join(root,'css/app_v20_2_0.css'),'utf8');
  const app=await readFile(path.join(root,'js/app_v20_2_0.js'),'utf8');
  assert.ok(xr.includes("usagePreference:['cpu-optimized','gpu-optimized']"));
  assert.ok(xr.includes("this.depthMode==='cpu-optimized'"));
  assert.ok(xr.includes('frame.getDepthInformation(view)'));
  assert.ok(xr.includes("this.depthMode==='gpu-optimized'"));
  assert.ok(xr.includes("clearColor(0,0,0,0)"));
  assert.ok(xr.includes('layer.framebuffer'));
  assert.ok(xr.includes('xr-end-event-timeout'));
  assert.ok(xr.includes('capture-ended-ui-failed'));
  assert.ok(xr.includes('plane-detection'));
  assert.ok(xr.includes('frame.detectedPlanes'));
  assert.ok(css.includes('html.xr-active,body.xr-active{background:transparent!important}'));
  assert.ok(css.includes('.xr-active #xr-canvas{visibility:visible;opacity:1}'));
  assert.ok(css.includes('.xr-active .topbar{display:none}'));
  assert.ok(!css.includes('.xr-active #xr-canvas{opacity:0}'));
  assert.ok(app.includes("document.documentElement.classList.add('xr-active')"));
  assert.ok(app.includes('capture-review-failed'));
  assert.ok(app.includes('open-review-failed'));
  assert.ok(app.includes("setState('Diagnostica pronta','good')"));
  assert.ok(app.includes('audio-start-timeout'));
  assert.ok(app.includes("['created','starting','capturing'"));
  assert.ok(app.includes('freshXRCanvas'));
  assert.ok(app.includes('sw_v20_2_0.js?build='));
  assert.ok(app.includes('prepareDownload'));
  const map=await readFile(path.join(root,'workers/map_worker_v20_2_0.js'),'utf8');
  assert.ok(map.includes('planeEstimates')&&map.includes('webxr-plane'));
});
await test('processing_is_explicit_separate_page',async()=>{const html=await readFile(path.join(root,'processing.html'),'utf8'),app=await readFile(path.join(root,'js/app_v20_2_0.js'),'utf8'),ui=await readFile(path.join(root,'js/processing_ui_v20_2_0.js'),'utf8');assert.ok(html.includes('PROCESSING ISOLATO'));assert.ok(html.includes('btn-back-capture'));assert.ok(app.includes("processing.html?session="));assert.ok(app.includes("requestedId?await repo.getSession"));assert.ok(ui.includes('review=1&session='));assert.ok(!app.includes("new Worker(new URL('../workers/processing_worker"));});

for(const [status,name] of results)console.log(`${status} ${name}`);if(!process.exitCode)console.log('ALL TESTS PASSED');
