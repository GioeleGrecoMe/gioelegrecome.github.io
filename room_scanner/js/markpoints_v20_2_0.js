import {MARKPOINT} from './config_v20_2_0.js';
import {clamp,dist3,median,mad,uid} from './math_v20_2_0.js';

/**
 * A markpoint is not a generic visual feature. It is a user-selected, fixed,
 * colourful patch with a metric depth anchor. The validation score is exposed
 * before accepting it so weak references never silently constrain the map.
 */
export function computePatchDescriptor(rgba,width,height,cx=width/2,cy=height/2,radius=Math.max(7,Math.floor(Math.min(width,height)*.045))){
  const hueHist=new Float32Array(12),values=[],sats=[],lumas=[];let edge=0,samples=0;
  const x0=Math.max(1,Math.floor(cx-radius)),x1=Math.min(width-2,Math.ceil(cx+radius)),y0=Math.max(1,Math.floor(cy-radius)),y1=Math.min(height-2,Math.ceil(cy+radius));
  for(let y=y0;y<=y1;y+=2)for(let x=x0;x<=x1;x+=2){const i=(y*width+x)*4,r=rgba[i]/255,g=rgba[i+1]/255,b=rgba[i+2]/255;const {h,s,v}=rgbToHsv(r,g,b);hueHist[Math.min(11,Math.floor(h*12))]+=s+.08;values.push(v);sats.push(s);const lum=.2126*r+.7152*g+.0722*b;lumas.push(lum);const ix=(y*width+x+1)*4,iy=((y+1)*width+x)*4;const lx=.2126*rgba[ix]/255+.7152*rgba[ix+1]/255+.0722*rgba[ix+2]/255,ly=.2126*rgba[iy]/255+.7152*rgba[iy+1]/255+.0722*rgba[iy+2]/255;edge+=Math.abs(lx-lum)+Math.abs(ly-lum);samples++;}
  const sum=hueHist.reduce((a,b)=>a+b,0)||1;for(let i=0;i<hueHist.length;i++)hueHist[i]/=sum;const mean=a=>a.reduce((s,v)=>s+v,0)/Math.max(1,a.length),meanV=mean(values),meanS=mean(sats),meanL=mean(lumas);const variance=lumas.reduce((s,v)=>s+(v-meanL)**2,0)/Math.max(1,lumas.length);
  return {hueHist:Array.from(hueHist),meanSaturation:meanS,meanValue:meanV,contrast:Math.sqrt(variance),edgeEnergy:edge/Math.max(1,samples*2),sampleCount:samples,bounds:{x0,y0,x1,y1}};
}

export function descriptorDistance(a,b){
  if(!a||!b)return Infinity;let hist=0;for(let i=0;i<12;i++)hist+=Math.abs((a.hueHist?.[i]||0)-(b.hueHist?.[i]||0));hist*=.5;
  return clamp(.55*hist+.18*Math.abs(a.meanSaturation-b.meanSaturation)+.12*Math.abs(a.meanValue-b.meanValue)+.09*Math.abs(a.contrast-b.contrast)*3+.06*Math.abs(a.edgeEnergy-b.edgeEnergy)*3,0,2);
}

export function validateMarkpointCandidate({position,depthSamples=[],descriptor,existing=[]}){
  const finiteDepth=depthSamples.filter(Number.isFinite).filter(v=>v>0);const depth=finiteDepth.length?median(finiteDepth):NaN,depthStd=finiteDepth.length?mad(finiteDepth):Infinity;const nearest=existing.length?Math.min(...existing.map(m=>dist3(m.position,position))):Infinity;
  const scores={
    depth:Number.isFinite(depth)?clamp((Math.min(depth-MARKPOINT.minDepthM,MARKPOINT.maxDepthM-depth)+.08)/.5,0,1):0,
    depthStability:clamp(1-depthStd/MARKPOINT.maxDepthStdM,0,1),
    saturation:clamp((descriptor?.meanSaturation||0)/MARKPOINT.minSaturation,0,1),
    contrast:clamp((descriptor?.contrast||0)/MARKPOINT.minContrast,0,1),
    edge:clamp((descriptor?.edgeEnergy||0)/MARKPOINT.minEdgeEnergy,0,1),
    separation:clamp(nearest/MARKPOINT.minDistanceFromOtherM,0,1)
  };
  const score=.20*scores.depth+.20*scores.depthStability+.20*scores.saturation+.15*scores.contrast+.15*scores.edge+.10*scores.separation;
  const reasons=[];if(!Number.isFinite(depth))reasons.push('profondità non disponibile');else if(depth<MARKPOINT.minDepthM||depth>MARKPOINT.maxDepthM)reasons.push('distanza non adatta');if(depthStd>MARKPOINT.maxDepthStdM)reasons.push('superficie o tracking instabile');if(scores.saturation<1)reasons.push('colore poco riconoscibile');if(scores.contrast<1)reasons.push('texture troppo uniforme');if(scores.edge<1)reasons.push('contorno poco definito');if(scores.separation<1)reasons.push('troppo vicino a un riferimento esistente');
  return {valid:score>=.68&&scores.depthStability>.45&&scores.separation>.65,quality:score,scores,reasons,depthM:depth,depthStdM:depthStd};
}

export class MarkpointManager {
  constructor({repository,diagnostics,mapWorker,sessionId,segmentId}){this.repo=repository;this.diag=diagnostics;this.worker=mapWorker;this.sessionId=sessionId;this.segmentId=segmentId||'segment-0';this.points=[];}
  load(points=[]){this.points=points.map(p=>({...p}));}
  evaluate(candidate,{excludeId=null}={}){const validation=validateMarkpointCandidate({...candidate,existing:this.points.filter(p=>p.segmentId===this.segmentId&&p.id!==excludeId)});let bestMatch=null;for(const p of this.points){if(p.id===excludeId||p.segmentId===this.segmentId||!p.descriptor)continue;const distance=descriptorDistance(p.descriptor,candidate.descriptor);if(!bestMatch||distance<bestMatch.distance)bestMatch={point:p,distance};}if(bestMatch?.distance>MARKPOINT.descriptorDistanceMax)bestMatch=null;return {...validation,bestMatch};}
  async place(candidate){
    if(this.points.length>=MARKPOINT.maxPoints)throw new Error(`Puoi salvare al massimo ${MARKPOINT.maxPoints} riferimenti`);
    const point={id:uid('mark'),logicalId:uid('landmark'),sessionId:this.sessionId,segmentId:this.segmentId,position:Array.from(candidate.position),normal:Array.from(candidate.normal||[0,1,0]),descriptor:null,quality:clamp(candidate.confidence??.45,0,1),validation:{valid:false,quality:0,reasons:['foto di conferma in attesa'],scores:{}},createdAt:Date.now(),frameId:null,referenceCameraPosition:Array.from(candidate.referenceCameraPosition||[0,0,0]),confirmations:[],status:'pending-photo',fixed:true};
    this.points.push(point);await this._persistPoint(point);this.worker?.postMessage({type:'markpoint',markpointId:point.id,position:point.position});await this.diag?.log('markpoint-spatially-placed',{id:point.id,position:point.position});return point;
  }
  async accept(candidate,validation){
    if(this.points.length>=MARKPOINT.maxPoints)throw new Error(`Puoi salvare al massimo ${MARKPOINT.maxPoints} riferimenti`);
    const point={id:uid('mark'),logicalId:validation.bestMatch?.point?.logicalId||uid('landmark'),matchedPriorId:validation.bestMatch?.point?.id||null,matchDescriptorDistance:validation.bestMatch?.distance??null,sessionId:this.sessionId,segmentId:this.segmentId,position:Array.from(candidate.position),normal:Array.from(candidate.normal||[0,1,0]),descriptor:candidate.descriptor,quality:validation.quality,validation,createdAt:Date.now(),frameId:candidate.frameId||null,referenceCameraPosition:Array.from(candidate.referenceCameraPosition||candidate.pose?.position||[0,0,0]),confirmations:[],status:validation.valid?'candidate':'weak',fixed:true};
    this.points.push(point);await this._persistPoint(point);this.worker?.postMessage({type:'markpoint',markpointId:point.id,position:point.position});await this.diag?.log('markpoint-created',{id:point.id,quality:point.quality,valid:validation.valid,reasons:validation.reasons});return point;
  }
  async pin(pointId,candidate,{move=false}={}){
    const point=this.points.find(p=>p.id===pointId);if(!point)throw new Error('Riferimento selezionato non trovato');const camera=Array.from(candidate.referenceCameraPosition||candidate.pose?.position||[0,0,0]),baseline=dist3(camera,point.referenceCameraPosition||camera),observation={frameId:candidate.frameId||null,time:Date.now(),position:Array.from(candidate.position),normal:Array.from(candidate.normal||[0,1,0]),cameraPosition:camera,baselineM:baseline,manual:true};
    if(!point.confirmations.some(c=>c.frameId&&c.frameId===observation.frameId))point.confirmations.push(observation);
    if(move){point.position=observation.position;point.normal=observation.normal;if(candidate.descriptor)point.descriptor=candidate.descriptor;point.referenceCameraPosition=camera;point.frameId=candidate.frameId||point.frameId;}
    point.status=point.confirmations.length>=MARKPOINT.validConfirmations?'valid':'candidate';await this._persistPoint(point);await this.repo.enqueueRecord(this.sessionId,'markpoint-update',{id:point.id,status:point.status,position:point.position,normal:point.normal,confirmations:point.confirmations,move},{key:`${this.sessionId}/markpoint-update/${point.id}/${Date.now()}`});this.worker?.postMessage({type:'markpoint',markpointId:point.id,position:point.position});await this.diag?.log(move?'markpoint-moved':'markpoint-pinned',{id:point.id,baselineM:baseline,confirmations:point.confirmations.length});return point;
  }
  async observeFrame({frameId,cameraPosition,projectedPatches=[]}){
    const updates=[];for(const obs of projectedPatches){const p=this.points.find(x=>x.id===obs.markpointId);if(!p)continue;const d=descriptorDistance(p.descriptor,obs.descriptor),baseline=dist3(cameraPosition,obs.referenceCameraPosition||cameraPosition);if(d<=MARKPOINT.descriptorDistanceMax&&baseline>=MARKPOINT.confirmationBaselineM){if(!p.confirmations.some(c=>c.frameId===frameId)){p.confirmations.push({frameId,time:Date.now(),descriptorDistance:d,baselineM:baseline});p.status=p.confirmations.length>=MARKPOINT.validConfirmations?'valid':'candidate';updates.push(p);}}}
    for(const p of updates){await this._persistPoint(p);await this.repo.enqueueRecord(this.sessionId,'markpoint-update',{id:p.id,status:p.status,confirmations:p.confirmations},{key:`${this.sessionId}/markpoint-update/${p.id}/${Date.now()}`});}return updates;
  }
  async refine(pointId,candidate,validation){const point=this.points.find(p=>p.id===pointId);if(!point)throw new Error('Riferimento da confermare non trovato');point.descriptor=candidate.descriptor||point.descriptor;point.quality=validation.quality??point.quality;point.validation=validation;point.frameId=candidate.frameId||point.frameId;point.status=validation.valid?(point.confirmations.length>=MARKPOINT.validConfirmations?'valid':'candidate'):'pending-photo';await this._persistPoint(point);await this.repo.enqueueRecord(this.sessionId,'markpoint-refined',{id:point.id,status:point.status,quality:point.quality,frameId:point.frameId,validation},{key:`${this.sessionId}/markpoint-refined/${point.id}/${Date.now()}`});await this.diag?.log('markpoint-photo-refined',{id:point.id,valid:validation.valid,quality:point.quality});return point;}
  async _persistPoint(point){await this.repo.enqueueRecord(this.sessionId,'markpoint',point,{key:`${this.sessionId}/markpoint/${point.id}`});}
}
function rgbToHsv(r,g,b){const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;let h=0;if(d){if(max===r)h=((g-b)/d)%6;else if(max===g)h=(b-r)/d+2;else h=(r-g)/d+4;h/=6;if(h<0)h+=1;}return {h,s:max?d/max:0,v:max};}
