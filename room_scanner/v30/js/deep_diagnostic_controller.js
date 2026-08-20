/**
 * Room Scanner V30.18.8 - deterministic Depth Anything raster diagnostic.
 *
 * No app.js modification is required. This listener observes the normal
 * deep-test-result and renders the exact camera bytes, the exact NCHW tensor
 * inverted back to RGB, an intentionally wrong NHWC interpretation, the
 * official row-major depth, a column-major candidate, and (when needed) the
 * 518px reference inference.
 */
let attached = null;
const $ = id => document.getElementById(id);

function room(){ return globalThis.RoomScanV30 || null; }

function drawRgba(canvas, rgba, width, height){
  if(!canvas || !rgba?.length || !(width>1&&height>1)) return;
  const src = rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba);
  const tmp=document.createElement('canvas'); tmp.width=width; tmp.height=height;
  const g=tmp.getContext('2d'); const im=g.createImageData(width,height);
  im.data.set(src.subarray(0,Math.min(src.length,im.data.length))); g.putImageData(im,0,0);
  fit(canvas,tmp,width,height);
}

function percentile(raw,q){
  const a=[]; for(const v of raw||[]) if(Number.isFinite(v)) a.push(Number(v));
  if(!a.length) return 0; a.sort((x,y)=>x-y); return a[Math.max(0,Math.min(a.length-1,Math.floor((a.length-1)*q)))];
}
function heat(t){
  const x=Math.max(0,Math.min(1,t));
  return [
    Math.round(255*Math.max(0,Math.min(1,1.8-Math.abs(4*x-3)))),
    Math.round(255*Math.max(0,Math.min(1,1.8-Math.abs(4*x-2)))),
    Math.round(255*Math.max(0,Math.min(1,1.8-Math.abs(4*x-1))))
  ];
}
function depthImage(raw,width,height,columnMajor=false){
  if(!raw?.length||!(width>1&&height>1)) return null;
  const lo=percentile(raw,.03), hi=percentile(raw,.97), range=hi>lo?hi-lo:1;
  const c=document.createElement('canvas'); c.width=width; c.height=height;
  const g=c.getContext('2d'); const im=g.createImageData(width,height);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++){
    const dst=y*width+x;
    // If the producer accidentally used column-major storage, this alternative
    // index reconstructs the same HxW image without guessing swapped dimensions.
    const src=columnMajor ? x*height+y : dst;
    const v=Number(raw[src]); const j=dst*4;
    if(!Number.isFinite(v)){im.data[j+3]=0;continue;}
    const cc=heat((v-lo)/range); im.data[j]=cc[0];im.data[j+1]=cc[1];im.data[j+2]=cc[2];im.data[j+3]=255;
  }
  g.putImageData(im,0,0); return c;
}
function fit(canvas,source,w,h){
  const rect=canvas.getBoundingClientRect(); const dpr=Math.min(2,devicePixelRatio||1);
  const cw=Math.max(160,Math.round((rect.width||w)*dpr)), ch=Math.max(100,Math.round(cw*h/w));
  canvas.width=cw;canvas.height=ch; const g=canvas.getContext('2d');g.imageSmoothingEnabled=true;g.clearRect(0,0,cw,ch);g.drawImage(source,0,0,cw,ch);
}
function drawDepth(canvas,raw,w,h,columnMajor=false){ const im=depthImage(raw,w,h,columnMajor); if(im) fit(canvas,im,w,h); }
function n(v,d=3){return Number.isFinite(Number(v))?Number(v).toFixed(d):'—';}

function render(d){
  const card=$('deepDiagCard'); if(card) card.hidden=false;
  const input=d.inputRasterDiagnostic;
  if(input){
    drawRgba($('deepDiagSource'),input.sourcePreview,input.sourceWidth,input.sourceHeight);
    drawRgba($('deepDiagNchw'),input.tensorNchwPreview,input.tensorWidth,input.tensorHeight);
    drawRgba($('deepDiagNhwc'),input.tensorNhwcPreview,input.tensorWidth,input.tensorHeight);
  }
  drawDepth($('deepDiagDepthRow'),d.rawDepth,d.rawWidth,d.rawHeight,false);
  drawDepth($('deepDiagDepthCol'),d.rawDepth,d.rawWidth,d.rawHeight,true);
  const ref=d.referenceDiagnostic;
  if(ref?.rawDepth?.length) drawDepth($('deepDiagReference'),ref.rawDepth,ref.width,ref.height,false);
  const report=$('deepDiagReport');
  if(report){
    const rd=d.rasterDiagnosis||{}; const pc=d.flipComparison||{}; const ps=rd.primaryStripe||{}; const rs=rd.referenceStripe||{};
    report.textContent=[
      `VERDETTO: ${rd.verdict||'nessuno'}`,
      `modello/sessione: ${d.provider||'?'} · ${d.inputPlan?.width||'?'}x${d.inputPlan?.height||'?'} -> ${d.outputDims?.join('x')||'?'}`,
      `input: ${d.preprocessBackend||'?'} · output: ${d.outputReadback||'?'} @ ${d.outputLocation||'?'}`,
      `stripe principale: ${ps.orientation||'?'} ratio ${n(ps.ratio,2)}`,
      `flip-equivariance: corr ${n(pc.correlation,3)} · NRMSE ${n(pc.nrmse,3)}`,
      ref?.rawDepth?.length ? `riferimento 518: ${ref.inputPlan?.width||'?'}x${ref.inputPlan?.height||'?'} · stripe ${rs.orientation||'?'} ratio ${n(rs.ratio,2)} · ${n(ref.steadyMs,0)} ms` : `riferimento 518: ${ref?.error||'non necessario'}`,
      `src ${d.frameSignature||'--------'} -> z ${d.depthSignature||'--------'}`,
      '',
      'COME LEGGERLO:',
      '1. CAMERA deve essere una foto normale.',
      '2. TENSOR NCHW deve essere la stessa scena ridimensionata. Se qui è normale, RGBA/NCHW è corretto.',
      '3. TENSOR NHWC è volutamente l’interpretazione alternativa: se questa fosse normale e NCHW no, il layout sarebbe sbagliato.',
      '4. DEPTH ROW è il contratto ufficiale [H,W]. DEPTH COLUMN è la lettura column-major alternativa.',
      '5. Se 224 è a colonne ma il riferimento 518 è normale, il problema è il raster troppo piccolo, non lo stride.',
    ].join('\n');
  }
}

function attach(worker){
  if(!worker||worker===attached)return; attached=worker;
  worker.addEventListener('message',e=>{const d=e.data||{};if(d.type==='deep-test-result')render(d);});
}
const timer=setInterval(()=>attach(room()?.state?.deepDepthWorker),200);
addEventListener('pagehide',()=>clearInterval(timer),{once:true});
