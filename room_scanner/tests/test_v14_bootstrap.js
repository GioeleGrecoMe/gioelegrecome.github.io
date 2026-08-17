'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');
const html=fs.readFileSync(path.join(__dirname,'..','room_scanner_v12.html'),'utf8');
const m=html.match(/<script>\n([\s\S]*?)\n<\/script>/);assert.ok(m,'inline script not found');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
function classList(){const s=new Set();return{add:(...a)=>a.forEach(x=>s.add(x)),remove:(...a)=>a.forEach(x=>s.delete(x)),toggle:(x,v)=>v===undefined?(s.has(x)?s.delete(x):s.add(x)):(v?s.add(x):s.delete(x)),contains:x=>s.has(x)}}
function ctx(){return{setTransform(){},transform(){},clearRect(){},fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},arc(){},closePath(){},save(){},restore(){},setLineDash(){},fillText(){},clip(){},drawImage(){},putImageData(){},createImageData(w,h){return{data:new Uint8ClampedArray(w*h*4)}},measureText(){return{width:20}}}}
function element(id){return{id,style:{},className:'',classList:classList(),textContent:'',innerHTML:'',disabled:false,value:id==='quality'?'balanced':'',checked:id==='layRoom'||id==='layTexture'||id==='layObjects',options:[],dataset:{},width:800,height:600,addEventListener(){},setPointerCapture(){},click(){},closest(){return this},getBoundingClientRect(){return{left:0,top:0,width:800,height:600}},getContext(){return ctx()}}}
const els=new Map(ids.map(id=>[id,element(id)]));
const document={getElementById:id=>els.get(id)||null,querySelectorAll:()=>[],addEventListener(){},documentElement:{requestFullscreen(){return Promise.resolve()}},fullscreenElement:null,body:{classList:classList()}};
const context={console,RoomV14Cells:require('../v14_cells.js'),document,navigator:{},window:{addEventListener(){}},globalThis:null,performance:{now:()=>1000},setTimeout,clearTimeout,requestAnimationFrame(){},Blob:function(){},URL:{createObjectURL(){return'blob:x'},revokeObjectURL(){}},Image:function(){this.complete=false},ImageData:function(data,w,h){this.data=data;this.width=w;this.height=h},devicePixelRatio:1,innerWidth:800,innerHeight:600,alert(){},confirm(){return true},btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary')};
context.globalThis=context;vm.createContext(context);vm.runInContext(m[1],context,{filename:'room_scanner_v14_inline.js',timeout:4000});
const H=context.__ROOM_SCANNER_V14__;assert.ok(H);assert.equal(H.VERSION,'14.0.0');assert.equal(H.state.phase,'station');assert.equal(els.get('phase').textContent,'1 · Punto di ripresa');
// A station creates a new independent cell; no global wall solver exists.
H.state.currentView={transform:{matrix:[1,0,0,0,0,1,0,0,0,0,1,0,2,1.45,3,1]}};H.state.trackingLost=false;H.createStation();
assert.equal(H.state.phase,'footprint');assert.equal(H.state.cells.length,1);assert.equal(H.state.cells[0].id,'C1');assert.equal(H.state.cells[0].footprint.length,0);
console.log('V14 bootstrap test: PASS');
