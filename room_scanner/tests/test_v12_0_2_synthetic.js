#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const html=fs.readFileSync(path.join(__dirname,'..','room_scanner_v12.html'),'utf8');
const m=html.match(/<script type="module">([\s\S]*?)<\/script>/);if(!m)throw new Error('script module non trovato');
class El{constructor(){this.style={};this.className='';this.classList={contains:()=>true,add:()=>{},remove:()=>{}};this.innerHTML='';this.textContent='';this.dataset={};this.checked=true;this.value='';this.files=[];this.disabled=false}addEventListener(){}appendChild(){}append(){}setPointerCapture(){}click(){}getContext(){return null}}
const els=new Map();const document={getElementById:id=>{if(!els.has(id))els.set(id,new El);return els.get(id)},querySelectorAll:()=>[],createElement:()=>new El};
let clock=1000;const context={console,document,window:{addEventListener(){},devicePixelRatio:1},navigator:{},performance:{now:()=>clock},setTimeout,clearTimeout,requestAnimationFrame:fn=>fn(),requestIdleCallback:fn=>fn(),Blob,URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}},btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),alert:()=>{},globalThis:null};context.globalThis=context;vm.createContext(context);vm.runInContext(m[1],context,{filename:'room_scanner_v12.module.js'});const H=context.__ROOM_SCANNER_V12_0_2__;if(!H)throw new Error('diagnostic hook non disponibile');
let failures=0;function ok(cond,msg,detail=''){if(cond)console.log('PASS',msg,detail);else{console.error('FAIL',msg,detail);failures++}}
function close(a,b,t=.08){return Math.abs(a-b)<=t}
function reset(){H.state.frames=[];H.state.nativeSurfels=new Map();H.state.deepSurfels=new Map();H.state.planes=new Map();H.state.meshes=new Map();H.state.importedMeshTriangles=[];H.state.surfaces=[];H.state.roomShell=null;H.state.objects=[];H.state.objectCellIndex=new Map();}
// 1. Piano finito: nessun supporto dall'estensione infinita.
const floor={polygon:[[-1,0,-1],[1,0,-1],[1,0,1],[-1,0,1]],center:[0,0,0],normal:[0,1,0]};
ok(H.finiteSurfaceSupport(floor,[.2,.03,.3],0,.08),'piano finito: punto interno supportato');
ok(!H.finiteSurfaceSupport(floor,[2.2,.02,0],0,.08),'piano finito: estensione infinita rifiutata');
// 2. OBB libera per tavolo/divano.
function boxPoints(cx,cy,cz,sx,sy,sz,ang){const out=[],ca=Math.cos(ang),sa=Math.sin(ang);for(let ix=0;ix<=8;ix++)for(let iz=0;iz<=5;iz++)for(const yy of [-sy/2,sy/2]){const x=-sx/2+sx*ix/8,z=-sz/2+sz*iz/5;out.push([cx+ca*x-sa*z,cy+yy,cz+sa*x+ca*z])}return out}
const table=H.pcaObb(boxPoints(.4,.76,-.2,1.35,.08,.72,.37)),ts=[...table.size].sort((a,b)=>a-b);
ok(close(ts[2],1.35,.12)&&close(ts[1],.72,.12)&&close(ts[0],.08,.04),'tavolo: OBB recupera dimensioni ruotate',table.size.map(x=>x.toFixed(2)).join('x'));
const sofa=H.pcaObb(boxPoints(-.6,.52,.8,2.05,.86,.92,-.28)),ss=[...sofa.size].sort((a,b)=>a-b);
ok(close(ss[2],2.05,.16)&&ss[1]>.8&&ss[0]>.75,'divano: OBB conserva volume grande',sofa.size.map(x=>x.toFixed(2)).join('x'));
// 3. Parete parzialmente occlusa: rettangolo finito plausibile.
const wall=[];for(let y=.1;y<=2.4;y+=.18)for(let x=-1.8;x<=1.8;x+=.18){if(x>-.45&&x<.55&&y>.55&&y<1.95)continue;wall.push([x,y,-2.1])}const wr=H.rectangleOnPlane(wall,[0,0,1]);
ok(wr&&wr.area>6.5&&wr.area<10,'parete occlusa: completamento dai bordi osservati resta finito',wr?wr.area.toFixed(2):'null');
// 4. Fit metrico robusto con outlier.
const samples=[];for(let i=0;i<45;i++){const r=.4+i*.035,d=1.25+1.7*r+(i%7===0?.035:-.018);samples.push({r,d,u:(i%9)/9+.02,v:Math.floor(i/9)/5+.05})}samples.push({r:1.1,d:7,u:.9,v:.9},{r:.8,d:.25,u:.1,v:.8});const fit=H.regression(samples);
ok(H.fitIsAcceptable(fit)&&fit.med<.08,'fit metrico robusto resiste a outlier',fit?`n=${fit.n} med=${fit.med.toFixed(3)}`:'null');
// 5. Campo locale: residuale Deep diverso a sinistra/destra corregge in direzioni opposte senza cambiare scala XR.
const k={deep:{w:8,h:6,data:new Float32Array(48).fill(1)},fit:{mode:'direct',m:1,b:1,n:30,cells:12,med:.03,p90:.05}};
const anchors=[];for(let j=0;j<4;j++)for(let i=0;i<4;i++){anchors.push({r:1,d:1.82,u:.08+i*.06,v:.18+j*.16,source:'synchronized XR depth'});anchors.push({r:1,d:2.18,u:.72+i*.06,v:.18+j*.16,source:'synchronized XR depth'})}k.anchorField=H.buildAnchorField(k,anchors,k.fit);const l=H.localMetricCorrection(k,.16,.5),r=H.localMetricCorrection(k,.84,.5);
ok(l.delta<-.08&&r.delta>.08&&l.support>.3&&r.support>.3,'campo metrico locale corregge bias spaziale Deep',`left=${l.delta.toFixed(3)} right=${r.delta.toFixed(3)}`);
// 6. Triangolo XR: distanza geometrica esatta vicino/lontano.
ok(close(H.pointTriangleDistance([.25,.02,.25],[0,0,0],[1,0,0],[0,0,1]),.02,.005),'supporto mesh XR usa distanza dal triangolo');
ok(H.pointTriangleDistance([2,0,2],[0,0,0],[1,0,0],[0,0,1])>1,'punto lontano non supportato da triangolo XR');
// 7. Falso piano orizzontale da parete: una striscia lineare a quota costante non deve diventare tavolo.
reset();for(let i=0;i<180;i++){const x=-2+4*i/179;H.state.nativeSurfels.set(`w${i}`,{p:[x,.82,-2],confidence:.9,evidence:['WebXR depth'],frames:[],color:[1,1,1]})}
let hs=H.horizontalObjectSurfaces([]);ok(hs.length===0,'sezione di parete orizzontale non diventa superficie oggetto');
// 8. Top tavolo 2-D connesso: deve invece essere trovato.
reset();let q=0;for(let x=-.65;x<=.65;x+=.08)for(let z=-.35;z<=.35;z+=.08){H.state.nativeSurfels.set(`t${q++}`,{p:[x,.76,z],confidence:.9,evidence:['WebXR depth'],frames:[1],color:[1,1,1]})}
hs=H.horizontalObjectSurfaces([]);ok(hs.some(s=>s.area>.5&&s.area<1.3),'top tavolo connesso viene riconosciuto',hs.map(s=>s.area.toFixed(2)).join(','));
// 9. Chiusura stanza: senza superfici strutturali sufficienti non inventare guscio attorno agli oggetti.
reset();for(let i=0;i<80;i++)H.state.nativeSurfels.set(`o${i}`,{p:[(i%10)*.08,.5,Math.floor(i/10)*.08],confidence:.95,evidence:['WebXR depth'],frames:[]});H.state.surfaces=[];
ok(H.buildRoomShell(false)===null,'nessuna stanza chiusa da soli punti di arredo');
// 10. Due pareti + pavimento generano un guscio chiuso; ogni spigolo geometrico compare due volte.
H.state.surfaces=[
 {kind:'pavimento',polygon:[[-2,0,-1.5],[2,0,-1.5],[2,0,1.5],[-2,0,1.5]],center:[0,0,0],normal:[0,1,0],evidence:['XR plane'],confidence:.95},
 {kind:'parete',polygon:[[-2,0,-1.5],[2,0,-1.5],[2,2.6,-1.5],[-2,2.6,-1.5]],center:[0,1.3,-1.5],normal:[0,0,1],evidence:['XR plane'],confidence:.9},
 {kind:'parete',polygon:[[2,0,-1.5],[2,0,1.5],[2,2.6,1.5],[2,2.6,-1.5]],center:[2,1.3,0],normal:[-1,0,0],evidence:['XR plane'],confidence:.9}
];const shell=H.buildRoomShell(false);
ok(shell&&shell.watertight&&shell.indices.length>=36&&close(shell.height,2.6,.18),'guscio stanza chiuso da evidenza strutturale',shell?`verts=${shell.vertices.length} tris=${shell.indices.length/3}`:'null');
ok(shell&&shell.parts?.length>=6&&shell.parts.some(p=>p.kind==='parete'&&!p.observed),'guscio distingue parti osservate da chiusure inferite');
// 11. Mesh voxel oggetto: una cella ha 6 facce; due celle adiacenti 10 facce (faccia interna eliminata).
const one=H.voxelBoundaryMesh(['0,0,0'],.14),two=H.voxelBoundaryMesh(['0,0,0','1,0,0'],.14);
ok(one.watertight&&one.faces===6&&one.indices.length===36,'mesh oggetto singolo voxel chiusa');
ok(two.watertight&&two.faces===10&&two.indices.length===60,'mesh oggetto rimuove facce interne e resta chiusa');
// 12. Un top sottile ma densamente osservato resta un oggetto rimovibile: la mesh voxel fornisce lo spessore minimo, non un volume inventato.
reset();q=0;for(let x=-.7;x<=.7;x+=.055)for(let z=-.4;z<=.4;z+=.055){H.state.nativeSurfels.set(`thin${q++}`,{p:[x,.78,z],confidence:.92,evidence:['WebXR depth'],sources:{'WebXR depth':1},frames:[1,2],color:[120,150,180]})}const objs=H.buildObjects(false);ok(objs.length>=1&&objs[0].mesh?.watertight&&objs[0].obb.size[1]>=H.CFG.objectCell*.99,'superficie oggetto sottile produce cloud+mesh chiusa separabile',objs[0]?`size=${objs[0].obb.size.map(x=>x.toFixed(2)).join('x')}`:'none');
if(failures){console.error(`\n${failures} test sintetici falliti`);process.exit(1)}console.log('\nTutti i test sintetici V12.0.2 sono passati.');
