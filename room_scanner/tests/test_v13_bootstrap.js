'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');
const html=fs.readFileSync(path.join(__dirname,'..','room_scanner_v12.html'),'utf8');
const m=html.match(/<script>\n([\s\S]*?)\n<\/script>/);assert.ok(m,'inline script not found');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
function classList(){const s=new Set();return{add:(...a)=>a.forEach(x=>s.add(x)),remove:(...a)=>a.forEach(x=>s.delete(x)),toggle:(x,v)=>v===undefined?(s.has(x)?s.delete(x):s.add(x)):(v?s.add(x):s.delete(x)),contains:x=>s.has(x)}}
function element(id){return{id,style:{},className:'',classList:classList(),textContent:'',innerHTML:'',disabled:false,value:id==='quality'?'balanced':'',checked:id.startsWith('lay')||id==='bareRoom'?false:false,options:[],dataset:{},addEventListener(){},setPointerCapture(){},click(){},getBoundingClientRect(){return{left:0,top:0,width:800,height:600}},getContext(){return{setTransform(){},clearRect(){},fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},arc(){},closePath(){},save(){},restore(){},setLineDash(){},fillText(){},clip(){},drawImage(){},putImageData(){},createImageData(w,h){return{data:new Uint8ClampedArray(w*h*4)}}}}}}
const els=new Map(ids.map(id=>[id,element(id)]));
const document={getElementById:id=>els.get(id)||null,querySelectorAll:()=>[],addEventListener(){},documentElement:{requestFullscreen(){return Promise.resolve()}},fullscreenElement:null,body:{classList:classList()}};
const context={console,RoomV13Geometry:require('../v13_geometry.js'),document,navigator:{},window:{addEventListener(){}},globalThis:null,performance:{now:()=>1000},setTimeout,clearTimeout,Blob:function(){},URL:{createObjectURL(){return'blob:x'},revokeObjectURL(){}},Image:function(){},ImageData:function(data,w,h){this.data=data;this.width=w;this.height=h},devicePixelRatio:1,innerWidth:800,innerHeight:600,alert(){},confirm(){return true},btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary')};
context.globalThis=context;vm.createContext(context);vm.runInContext(m[1],context,{filename:'room_scanner_v13_inline.js',timeout:4000});
assert.equal(context.__ROOM_SCANNER_V13__.VERSION,'13.0.0');
assert.equal(context.__ROOM_SCANNER_V13__.state.phase,'trace');
assert.equal(els.get('phase').textContent,'1 · Perimetro approssimativo');
// Corner view IDs are spatial, not temporal: repeated clicks from one camera position
// must not satisfy the multi-view gate.
{
  const H=context.__ROOM_SCANNER_V13__,G=context.RoomV13Geometry;
  const c={observations:[]};
  const id1=H.cornerObservationViewId(c,[0,1.4,0]);c.observations.push({o:[0,1.4,0],viewId:id1,level:'base'});
  const id2=H.cornerObservationViewId(c,[.03,1.4,.02]);
  assert.equal(id2,id1,'near-identical camera positions must share one view ID');
  const id3=H.cornerObservationViewId(c,[.38,1.4,0]);c.observations.push({o:[.38,1.4,0],viewId:id3,level:'mid'});
  assert.notEqual(id3,id1,'physically separated camera position must create a new view ID');
  assert.ok(H.cornerCameraSpan(c)>.35);
}
// Integration invariant: an interior surface clearly separated from the shell is
// object evidence before the wider wall-refinement gate can absorb it.
{
  const H=context.__ROOM_SCANNER_V13__,G=context.RoomV13Geometry,S=H.state;
  S.roomModel=G.buildRoomModel([[0,0],[4,0],[4,3],[0,3]],2.7,0);
  S.wallEvidence=S.roomModel.walls.map(()=>new Map());
  S.wallCoverage=S.roomModel.walls.map(()=>G.coverageGrid(H.CFG.coverageCols,H.CFG.coverageRows));
  S.objectVoxels.clear();S.xrStructural.clear();
  H.observePoint([2,1,.16],[180,90,60],'view-a',1,'XR-depth');
  assert.equal(S.objectVoxels.size,1,'furniture 16 cm in front of a wall must be object evidence');
  assert.equal(S.wallEvidence[0].size,0,'foreground furniture must not become wall evidence');
  H.observePoint([2,1,.03],[120,150,180],'view-b',1,'XR-depth');
  assert.ok(S.wallEvidence[0].size>0,'near-shell observation must remain wall evidence');
}
// Undo must restore both the old shell and the residual coordinate system.
{
  const H=context.__ROOM_SCANNER_V13__,G=context.RoomV13Geometry,S=H.state,base=S.roomModel;
  const samples=base.walls.map(()=>[]);samples[0]=Array.from({length:8},()=>({offset:.03,weight:1}));
  const shifted=G.applyParallelWallRefinement(base,samples,[.04,.04,.04,.04]);assert.ok(shifted.ok);
  S.previousModel=base;S.previousRefineOffsets=[...shifted.fit.offsets];S.roomModel=shifted.model;
  S.wallEvidence=S.roomModel.walls.map(()=>new Map());
  S.wallEvidence[0].set('1,1',{offsets:[0],colors:[[100,120,140]],views:new Set(['a','b']),weight:2,sources:new Set(['XR-depth'])});
  S.corners=S.roomModel.footprint.map((p,i)=>({id:'P'+(i+1),prior:[...p],solution:{xz:[...p],residual:.02,baseline:.6},observations:[{level:'base',viewId:'a'},{level:'mid',viewId:'b'}]}));
  H.undoRecalc();
  assert.equal(S.roomModel,base,'undo must restore the previous authoritative model object');
  assert.ok(Math.abs(S.wallEvidence[0].get('1,1').offsets[0]-.03)<1e-9,'undo must restore residual offsets to the previous wall frame');
  assert.equal(S.previousRefineOffsets,null);
}
console.log('V13 bootstrap test: PASS · app integration invariants OK');
