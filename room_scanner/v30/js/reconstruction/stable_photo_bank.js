/**
 * Stable RGB photo bank for post-scan processing.
 *
 * The bank is deliberately independent from Deep/MVS. During acquisition it
 * only freezes camera frames whose Alva pose is valid and whose instantaneous
 * camera motion is low enough to make motion blur unlikely. Every accepted
 * frame carries the exact Alva pose/intrinsics that existed at capture time.
 *
 * Frames are depthPlanned but are NOT matched into the live photo mosaic here:
 * expensive photo matching is deferred until the camera/Alva fast lane stops.
 */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export class StablePhotoBank{
  constructor({
    maxFrames=240,maxBytes=96*1024*1024,minIntervalMs=420,maxSide=336,
    maxTranslationSpeedMetric=0.28,maxTranslationSpeedAlva=0.42,maxAngularSpeedRad=0.55,
    minDetail=4.0,jumpTranslation=0.65,jumpRotationRad=0.70,jumpWindowMs=2200
  }={}){
    Object.assign(this,{maxFrames:Math.max(8,maxFrames|0),maxBytes:Math.max(8*1024*1024,Number(maxBytes)||96*1024*1024),minIntervalMs:Math.max(80,Number(minIntervalMs)||420),maxSide:Math.max(96,Number(maxSide)||336),maxTranslationSpeedMetric:Number(maxTranslationSpeedMetric)||.28,maxTranslationSpeedAlva:Number(maxTranslationSpeedAlva)||.42,maxAngularSpeedRad:Number(maxAngularSpeedRad)||.55,minDetail:Number(minDetail)||4,jumpTranslation:Number(jumpTranslation)||.65,jumpRotationRad:Number(jumpRotationRad)||.70,jumpWindowMs:Number(jumpWindowMs)||2200});
    this.reset();
  }
  reset(){this.frames=[];this.byFrame=new Map();this.bytes=0;this.lastAcceptedAt=0;this.prevMotion=null;this.accepted=0;this.rejectedMotion=0;this.rejectedBlur=0;this.rejectedInterval=0;this.rejectedTracking=0;this.rejectedCapacity=0;this.replaced=0;this.jumpSuspects=0;}
  stats(){return {frames:this.frames.length,bytes:this.bytes,maxFrames:this.maxFrames,maxBytes:this.maxBytes,accepted:this.accepted,rejectedMotion:this.rejectedMotion,rejectedBlur:this.rejectedBlur,rejectedInterval:this.rejectedInterval,rejectedTracking:this.rejectedTracking,rejectedCapacity:this.rejectedCapacity,replaced:this.replaced,jumpSuspects:this.jumpSuspects};}
  consider(frame,tracking,K,{metricLocked=false}={}){
    const at=Number(frame?.at)||performance.now(),pose=tracking?.pose;
    if(!frame?.frameId||!frame?.rgba?.length||!frame?.gray?.length||!K||!tracking?.trackingValid||!pose?.p||!pose?.q){this.rejectedTracking++;this._rememberMotion(pose,at);return {ok:false,reason:'tracking-invalid'};}
    const motion=this._motion(pose,at,metricLocked);this._rememberMotion(pose,at);
    if(at-(this.lastAcceptedAt||0)<this.minIntervalMs){this.rejectedInterval++;return {ok:false,reason:'interval',motion};}
    if(motion.valid&&(motion.translationSpeed>motion.translationLimit||motion.angularSpeed>this.maxAngularSpeedRad)){this.rejectedMotion++;return {ok:false,reason:'camera-moving',motion};}
    const detail=gradientDetail(frame.gray,frame.width,frame.height);
    if(detail<this.minDetail){this.rejectedBlur++;return {ok:false,reason:'low-detail-or-blur',detail,motion};}
    const compact=compactRaster(frame,this.maxSide,K),previous=this.frames[this.frames.length-1]||null,jump=poseJump(previous,pose,at,{translation:this.jumpTranslation,rotation:this.jumpRotationRad,windowMs:this.jumpWindowMs}),quality=stableQuality(detail,motion),entry={
      id:`stable-${frame.captureSeq||frame.frameId}`,frameId:String(frame.frameId),captureAt:at,at,
      pose:{p:[...pose.p],q:[...pose.q]},poseCov:tracking.poseCov||null,K:compact.K,width:compact.width,height:compact.height,
      gray:compact.gray,rgba:compact.rgba,features:tracking.featureObservations||tracking.newKeyframe?.features||[],metricLocked:!!metricLocked,
      trackingMode:tracking.trackingMode||'alvaar',trackingValid:true,depthPlanned:true,photoQuality:{detail,motion,stableQuality:quality},
      stability:{detail,translationSpeed:motion.translationSpeed,angularSpeed:motion.angularSpeed,dtMs:motion.dtMs,jumpSuspect:jump.suspect,jumpTranslation:jump.translation,jumpRotationRad:jump.rotationRad,jumpDtMs:jump.dtMs}
    };
    const retain=this._retain(entry,quality);if(!retain.ok){this.rejectedCapacity++;return {...retain,detail,motion};}
    this.lastAcceptedAt=at;this.accepted++;if(jump.suspect)this.jumpSuspects++;
    return {ok:true,entry,detail,motion,jump,replaced:retain.replaced||null,stats:this.stats()};
  }
  exportState(){return {format:'ROOMSCAN-STABLE-PHOTO-BANK-1',config:{maxFrames:this.maxFrames,maxBytes:this.maxBytes,minIntervalMs:this.minIntervalMs,maxSide:this.maxSide},stats:this.stats(),frames:this.frames.map(f=>({...f,gray:new Uint8Array(f.gray||[]),rgba:new Uint8ClampedArray(f.rgba||[])}))};}
  importState(s){this.reset();for(const raw of s?.frames||[]){if(!raw?.frameId||!raw?.rgba?.length)continue;const f={...raw,gray:new Uint8Array(raw.gray||[]),rgba:new Uint8ClampedArray(raw.rgba||[])};this.frames.push(f);this.byFrame.set(String(f.frameId),f);this.bytes+=frameBytes(f);}this.accepted=this.frames.length;this.jumpSuspects=this.frames.filter(f=>f.stability?.jumpSuspect).length;return this;}
  _motion(pose,at,metricLocked){const prev=this.prevMotion;if(!prev?.pose?.p||!prev?.pose?.q)return {valid:false,dtMs:0,translationSpeed:0,angularSpeed:0,translationLimit:metricLocked?this.maxTranslationSpeedMetric:this.maxTranslationSpeedAlva};const dt=Math.max(1,at-prev.at),translation=distance3(prev.pose.p,pose.p),rotationRad=quatAngle(prev.pose.q,pose.q);return {valid:dt<1200,dtMs:dt,translation,rotationRad,translationSpeed:translation/(dt/1000),angularSpeed:rotationRad/(dt/1000),translationLimit:metricLocked?this.maxTranslationSpeedMetric:this.maxTranslationSpeedAlva};}
  _rememberMotion(pose,at){if(pose?.p&&pose?.q)this.prevMotion={pose:{p:[...pose.p],q:[...pose.q]},at};}
  _retain(entry,quality){const id=String(entry.frameId);if(this.byFrame.has(id))return {ok:true,deduplicated:true};const bytes=frameBytes(entry);if(this.frames.length<this.maxFrames&&this.bytes+bytes<=this.maxBytes){this.frames.push(entry);this.byFrame.set(id,entry);this.bytes+=bytes;return {ok:true};}
    // Preserve late/novel coverage instead of becoming a first-N buffer. Replace
    // a redundant low-quality frame only when the new view is clearly better.
    let nearest=-1,nearestNovelty=Infinity;for(let i=0;i<this.frames.length;i++){const n=poseNovelty(entry,this.frames[i]);if(n<nearestNovelty){nearestNovelty=n;nearest=i;}}
    if(nearest>=0&&nearestNovelty<1.15){const old=this.frames[nearest],oldQ=Number(old.photoQuality?.stableQuality)||0;if(quality>oldQ+.08){this._replace(nearest,entry);return {ok:true,replaced:old.frameId};}return {ok:false,reason:'capacity-redundant'};}
    // Candidate is novel. Evict the lowest-quality member of an over-represented
    // local neighbourhood, never simply the oldest frame.
    let victim=-1,victimScore=Infinity;for(let i=0;i<this.frames.length;i++){const f=this.frames[i];let neighbours=0;for(let j=0;j<this.frames.length;j++){if(i!==j&&poseNovelty(f,this.frames[j])<1.15)neighbours++;}if(neighbours<1)continue;const score=(Number(f.photoQuality?.stableQuality)||0)-.06*neighbours;if(score<victimScore){victimScore=score;victim=i;}}
    if(victim>=0){const old=this.frames[victim];this._replace(victim,entry);return {ok:true,replaced:old.frameId};}
    return {ok:false,reason:'capacity-novel-no-redundant-victim'};
  }
  _replace(i,entry){const old=this.frames[i];this.bytes-=frameBytes(old);this.byFrame.delete(String(old.frameId));this.frames[i]=entry;this.byFrame.set(String(entry.frameId),entry);this.bytes+=frameBytes(entry);this.replaced++;this.frames.sort((a,b)=>(Number(a.at)||0)-(Number(b.at)||0));}
}

export function gradientDetail(gray,width,height){if(!gray?.length||width<3||height<3)return 0;const sx=Math.max(1,Math.floor(width/96)),sy=Math.max(1,Math.floor(height/144));let sum=0,n=0;for(let y=sy;y<height;y+=sy){const row=y*width,prev=(y-sy)*width;for(let x=sx;x<width;x+=sx){sum+=Math.abs(gray[row+x]-gray[row+x-sx])+Math.abs(gray[row+x]-gray[prev+x]);n+=2;}}return n?sum/n:0;}
export function quatAngle(a,b){if(!a||!b)return 0;const dot=Math.abs(Number(a[0])*Number(b[0])+Number(a[1])*Number(b[1])+Number(a[2])*Number(b[2])+Number(a[3])*Number(b[3]));return 2*Math.acos(clamp(dot,-1,1));}
export function poseJump(previous,pose,at,{translation=.65,rotation=.70,windowMs=2200}={}){if(!previous?.pose?.p||!previous?.pose?.q)return {suspect:false,translation:0,rotationRad:0,dtMs:0};const dt=Math.max(0,at-(Number(previous.at)||at)),tr=distance3(previous.pose.p,pose.p),rot=quatAngle(previous.pose.q,pose.q),suspect=dt<=windowMs&&(tr>translation||rot>rotation);return {suspect,translation:tr,rotationRad:rot,dtMs:dt};}

function stableQuality(detail,motion){const sharp=clamp((detail-2)/12,0,1),v=motion?.valid?clamp(1-(motion.translationSpeed/(motion.translationLimit||.3)),0,1):.7,w=motion?.valid?clamp(1-motion.angularSpeed/.8,0,1):.7;return .55*sharp+.25*v+.20*w;}
function poseNovelty(a,b){if(!a?.pose?.p||!b?.pose?.p)return Infinity;return distance3(a.pose.p,b.pose.p)/.08+quatAngle(a.pose.q,b.pose.q)/.12;}
function distance3(a,b){return Math.hypot(Number(a?.[0]||0)-Number(b?.[0]||0),Number(a?.[1]||0)-Number(b?.[1]||0),Number(a?.[2]||0)-Number(b?.[2]||0));}
function frameBytes(f){return Number(f?.rgba?.byteLength||0)+Number(f?.gray?.byteLength||0);}
function compactRaster(frame,maxSide,K){const w0=frame.width|0,h0=frame.height|0,scale=Math.min(1,maxSide/Math.max(w0,h0)),w=Math.max(2,Math.round(w0*scale)),h=Math.max(2,Math.round(h0*scale));if(w===w0&&h===h0)return {width:w,height:h,gray:new Uint8Array(frame.gray),rgba:new Uint8ClampedArray(frame.rgba),K:{...K}};const gray=new Uint8Array(w*h),rgba=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++){const sy=Math.min(h0-1,Math.floor((y+.5)*h0/h));for(let x=0;x<w;x++){const sx=Math.min(w0-1,Math.floor((x+.5)*w0/w)),si=sy*w0+sx,di=y*w+x;gray[di]=frame.gray[si];rgba[4*di]=frame.rgba[4*si];rgba[4*di+1]=frame.rgba[4*si+1];rgba[4*di+2]=frame.rgba[4*si+2];rgba[4*di+3]=255;}}const sx=w/w0,sy=h/h0;return {width:w,height:h,gray,rgba,K:{fx:Number(K.fx)*sx,fy:Number(K.fy)*sy,cx:Number(K.cx)*sx,cy:Number(K.cy)*sy}};}
