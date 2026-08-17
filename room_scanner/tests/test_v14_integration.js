'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');
const html=fs.readFileSync(path.join(__dirname,'..','room_scanner_v12.html'),'utf8'),m=html.match(/<script>\n([\s\S]*?)\n<\/script>/);assert.ok(m);
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
function classList(){const s=new Set();return{add:(...a)=>a.forEach(x=>s.add(x)),remove:(...a)=>a.forEach(x=>s.delete(x)),toggle:(x,v)=>v?s.add(x):s.delete(x),contains:x=>s.has(x)}}
function element(id){return{id,style:{},classList:classList(),textContent:'',innerHTML:'',disabled:false,value:id==='quality'?'balanced':'',checked:id==='layRoom'||id==='layTexture'||id==='layObjects',addEventListener(){},click(){},closest(){return this},getBoundingClientRect(){return{left:0,top:0,width:800,height:600}},getContext(){return{setTransform(){},transform(){},clearRect(){},fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},arc(){},closePath(){},save(){},restore(){},setLineDash(){},fillText(){},clip(){},drawImage(){},putImageData(){},createImageData(w,h){return{data:new Uint8ClampedArray(w*h*4)}}}}}}
const els=new Map(ids.map(id=>[id,element(id)])),document={getElementById:id=>els.get(id),querySelectorAll:()=>[],documentElement:{requestFullscreen(){return Promise.resolve()}},fullscreenElement:null,body:{classList:classList()}};
const context={console,RoomV14Cells:require('../v14_cells.js'),document,navigator:{},window:{addEventListener(){}},globalThis:null,performance:{now:()=>1000},setTimeout,clearTimeout,requestAnimationFrame(){},Blob:function(){},URL:{createObjectURL(){return'x'},revokeObjectURL(){}},Image:function(){this.complete=false},ImageData:function(d,w,h){this.data=d;this.width=w;this.height=h},devicePixelRatio:1,alert(){},confirm(){return true},btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary')};context.globalThis=context;vm.createContext(context);vm.runInContext(m[1],context,{timeout:4000});
const H=context.__ROOM_SCANNER_V14__,G=context.RoomV14Cells,S=H.state;
const c1={id:'C1',name:'Vano 1',station:{origin:[2,0,1.5],yaw:0,transform:{x:0,z:0,yaw:0}},footprint:[[0,0],[4,0],[4,3],[0,3]],model:G.buildCellModel([[0,0],[4,0],[4,3],[0,3]],2.7,0),transform:{x:0,z:0,yaw:0},height:2.7,heightConfidence:1,heightSamples:[2.7,2.69],panorama:G.panoramaCoverage(24),wallCoverage:[],status:'ready'};
c1.wallCoverage=c1.model.walls.map(()=>G.coverageGrid(18,10));
const c2={id:'C2',name:'Vano 2',station:{origin:[5,0,1.5],yaw:0,transform:{x:4,z:1.5,yaw:0}},footprint:[[0,-.6],[3,-.6],[3,.6],[0,.6]],model:G.buildCellModel([[0,-.6],[3,-.6],[3,.6],[0,.6]],2.7,0),transform:{x:4,z:1.5,yaw:0},height:2.7,heightConfidence:1,heightSamples:[2.7],panorama:G.panoramaCoverage(24),wallCoverage:[],status:'ready',suppressedIntervals:{3:[{s0:.1,s1:1.1}]},entranceWallIndex:3};
c2.wallCoverage=c2.model.walls.map(()=>G.coverageGrid(18,10));
S.cells=[c1,c2];S.activeCellId='C2';const p=G.createPortal('C1',1,1,2,2.7,'P1');p.linkedCellId='C2';p.linkedWallIndex=3;p.opticalHeights=[1.95,2.01,2.02,1.98,2.05,2.0];S.portals=[p];
const srcCuts=H.cellCutouts(c1),tgtCuts=H.cellCutouts(c2);assert.equal(srcCuts.length,1);assert.ok(tgtCuts.some(x=>x.synthetic&&x.wallIndex===3),'target shared interval must become a synthetic full-height cutout');
H.inferPortalHeights();assert.ok(p.top>1.9&&p.top<2.2,`portal top ${p.top}`);
assert.ok(G.cellShellMesh(c1,H.cellCutouts(c1),[]).indices.length>0);assert.ok(G.cellShellMesh(c2,H.cellCutouts(c2),[]).indices.length>0);
console.log('V14 integration tests: PASS');
