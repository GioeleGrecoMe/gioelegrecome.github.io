#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const html=fs.readFileSync(path.join(__dirname,'..','room_scanner_v12.html'),'utf8');
const m=html.match(/<script type="module">([\s\S]*?)<\/script>/);if(!m)throw new Error('script module non trovato');
class El{constructor(){this.style={};this.className='';this.classList={contains:()=>true,add:()=>{},remove:()=>{}};this.innerHTML='';this.textContent='';this.dataset={};this.checked=true;this.value='';this.files=[];this.disabled=false}addEventListener(){}appendChild(){}append(){}setPointerCapture(){}click(){}getContext(){return null}}
const els=new Map();const document={getElementById:id=>{if(!els.has(id))els.set(id,new El);return els.get(id)},querySelectorAll:()=>[],createElement:()=>new El};
const context={console,document,window:{addEventListener(){},devicePixelRatio:1},navigator:{},performance:{now:()=>1000},setTimeout,clearTimeout,requestAnimationFrame:fn=>fn(),Blob,URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}},btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),alert:()=>{},globalThis:null};context.globalThis=context;vm.createContext(context);vm.runInContext(m[1],context,{filename:'room_scanner_v12.module.js'});const H=context.__ROOM_SCANNER_V12_0_1__;if(!H)throw new Error('diagnostic hook non disponibile');
let failures=0;function ok(cond,msg,detail=''){if(cond)console.log('PASS',msg,detail);else{console.error('FAIL',msg,detail);failures++}}
function close(a,b,t=.08){return Math.abs(a-b)<=t}
// 1. Piano finito: un punto sulla stessa equazione ma fuori dal poligono non deve essere supportato.
const floor={polygon:[[-1,0,-1],[1,0,-1],[1,0,1],[-1,0,1]],center:[0,0,0],normal:[0,1,0]};
ok(H.finiteSurfaceSupport(floor,[.2,.03,.3],0,.08),'piano: punto interno supportato');
ok(!H.finiteSurfaceSupport(floor,[2.2,.02,0],0,.08),'piano: estensione infinita rifiutata');
// 2. Tavolo: OBB stabile su un top rettangolare ruotato, senza imporre Manhattan.
function boxPoints(cx,cy,cz,sx,sy,sz,ang){const out=[],ca=Math.cos(ang),sa=Math.sin(ang);for(let ix=0;ix<=8;ix++)for(let iz=0;iz<=5;iz++)for(const yy of [-sy/2,sy/2]){const x=-sx/2+sx*ix/8,z=-sz/2+sz*iz/5;out.push([cx+ca*x-sa*z,cy+yy,cz+sa*x+ca*z])}return out}
const table=H.pcaObb(boxPoints(.4,.76,-.2,1.35,.08,.72,.37));const ts=[...table.size].sort((a,b)=>a-b);
ok(close(ts[2],1.35,.12)&&close(ts[1],.72,.12)&&close(ts[0],.08,.04),'tavolo: OBB recupera dimensioni ruotate',table.size.map(x=>x.toFixed(2)).join('x'));
// 3. Divano: volume compatto grande con orientazione libera.
const sofa=H.pcaObb(boxPoints(-.6,.52,.8,2.05,.86,.92,-.28));const ss=[...sofa.size].sort((a,b)=>a-b);
ok(close(ss[2],2.05,.16)&&ss[1]>.8&&ss[0]>.75,'divano: OBB conserva volume grande non strutturale',sofa.size.map(x=>x.toFixed(2)).join('x'));
// 4. Parete parzialmente occlusa: due bande visibili devono generare un rettangolo finito plausibile.
const wall=[];for(let y=.1;y<=2.4;y+=.18)for(let x=-1.8;x<=1.8;x+=.18){if(x>-.45&&x<.55&&y>.55&&y<1.95)continue;wall.push([x,y,-2.1])}const wr=H.rectangleOnPlane(wall,[0,0,1]);
ok(wr&&wr.area>6.5&&wr.area<10,'parete parzialmente occlusa: supporto esteso dai bordi osservati senza area illimitata',wr?wr.area.toFixed(2):'null');
// 5. Fit metrico robusto con outlier monoculari.
const samples=[];for(let i=0;i<45;i++){const r=.4+i*.035,d=1.25+1.7*r+(i%7===0?.035:-.018);samples.push({r,d,u:(i%9)/9+.02,v:Math.floor(i/9)/5+.05})}samples.push({r:1.1,d:7,u:.9,v:.9},{r:.8,d:.25,u:.1,v:.8});const fit=H.regression(samples);
ok(H.fitIsAcceptable(fit)&&fit.med<.08,'ancoraggio metrico robusto resiste a outlier',fit?`n=${fit.n} med=${fit.med.toFixed(3)}`:'null');
if(failures){console.error(`\n${failures} test sintetici falliti`);process.exit(1)}console.log('\nTutti i test sintetici V12.0.1 sono passati.');
