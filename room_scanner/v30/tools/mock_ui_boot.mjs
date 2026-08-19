// Minimal browser-contract smoke test: prove handlers bind before WebXR/DB exist.
if(typeof globalThis.CustomEvent==='undefined')globalThis.CustomEvent=class CustomEvent extends Event{constructor(type,opt={}){super(type);this.detail=opt.detail;}};
class Classes{constructor(init=''){this.s=new Set(init.split(/\s+/).filter(Boolean));}toggle(x,on){if(on===undefined){if(this.s.has(x))this.s.delete(x);else this.s.add(x);}else if(on)this.s.add(x);else this.s.delete(x);}add(x){this.s.add(x)}remove(x){this.s.delete(x)}contains(x){return this.s.has(x)}}
class El extends EventTarget{constructor(id,cls=''){super();this.id=id;this.classList=new Classes(cls);this.dataset={};this.disabled=false;this.hidden=false;this.textContent='';this.value='';this.files=[];this.style={};this.open=false;}click(){this.dispatchEvent(new Event('click'));}getBoundingClientRect(){return {width:390,height:844};}getContext(){return {setTransform(){},clearRect(){},beginPath(){},arc(){},moveTo(){},lineTo(){},stroke(){},fill(){},fillText(){},set strokeStyle(v){},set fillStyle(v){},set lineWidth(v){},set font(v){}};}}
const ids=['home','calibration','bridge','scan','review','calibrateBtn','clearCalibrationBtn','calibSummary','startBtn','filePly','fileR30','homeStatus','savedSessions','buildBadge','buildFoot','calibOverlay','calibStatus','calibDepth','calibAddPinBtn','calibUndoPinBtn','calibFinishBtn','calibCancelBtn','bridgeCamera','bridgeMap','bridgeCoach','bridgeFound','bridgeInliers','bridgeRmse','bridgeRetryBtn','bridgeCancelBtn','camera','miniMap','slamState','metricState','mvsState','statFeat','statMatch','statKf','statGs','statTri','coach','pinBtn','finishBtn','viewer','backHomeBtn','fitBtn','splatSize','reviewStats','exportPlyBtn','exportR30Btn','exportDiagBtn','resumeBtn','loadPlyBtn','loadR30Btn','diagPanel','diagLive','diagDownloadBtn','diagCopyBtn','selfTestBtn','forceUpdateBtn','diagForceUpdateBtn','selfTestSummary'];
const els=new Map(ids.map(id=>[id,new El(id,['home','calibration','bridge','scan','review'].includes(id)?`screen${id==='home'?' active':''}`:'')]));
const body=new El('body'),docEl={dataset:{}};
globalThis.document={documentElement:docEl,body,getElementById:id=>els.get(id)||null,querySelectorAll:q=>q==='.screen'?['home','calibration','bridge','scan','review'].map(x=>els.get(x)):[],createElement:tag=>new El(tag)};
globalThis.window=globalThis;if(typeof globalThis.dispatchEvent!=='function')globalThis.dispatchEvent=()=>true;if(typeof globalThis.addEventListener!=='function')globalThis.addEventListener=()=>{};window.__ROOMSCAN_PREBOOT={errors:[]};
globalThis.localStorage={m:new Map(),getItem(k){return this.m.get(k)??null},setItem(k,v){this.m.set(k,String(v))},removeItem(k){this.m.delete(k)}};
globalThis.sessionStorage={m:new Map(),getItem(k){return this.m.get(k)??null},setItem(k,v){this.m.set(k,String(v))},removeItem(k){this.m.delete(k)}};
Object.defineProperty(globalThis,'navigator',{value:{userAgent:'mock',mediaDevices:{}},configurable:true});Object.defineProperty(globalThis,'location',{value:{pathname:'/room_scanner/v30/room_scanner_v30.html',replace(){}},configurable:true});globalThis.devicePixelRatio=1;
await import(`../js/app.js?mock=${Date.now()}`);
if(document.documentElement.dataset.v30Interactive!=='1')throw new Error('UI did not become interactive');
if(els.get('buildBadge').textContent!=='V30.11.1')throw new Error('wrong badge');
els.get('calibrateBtn').click();
await new Promise(r=>setTimeout(r,30));
if(!els.get('home').classList.contains('active'))throw new Error('failed WebXR did not return to Home');
if(!/WebXR/.test(els.get('homeStatus').textContent))throw new Error(`WebXR error not visible: ${els.get('homeStatus').textContent}`);
console.log('PASS mock-ui-boot · controls bound · failed WebXR returns to Home · UI remains interactive');
