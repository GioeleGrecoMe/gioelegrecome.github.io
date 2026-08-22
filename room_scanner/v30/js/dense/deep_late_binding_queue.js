/**
 * V30.45 bounded late-binding queue for Depth Anything.
 *
 * The queue has no authority over the camera/Alva/RGB fast lane.  It stores an
 * immutable exact-frame job and lets the caller decide when inference may run.
 * Jobs are deduplicated by frameId; a dense keyframe upgrades a survey job for
 * the same frame because it carries sparse/MVS context useful for calibration.
 */
export class DeepLateBindingQueue {
  constructor({maxItems=20}={}){
    this.maxItems=Math.max(1,Number(maxItems)||20);
    this.items=[];
    this.byFrame=new Map();
    this.inFlight=null;
    this.dropped=0;
    this.completed=0;
  }
  reset(){this.items.length=0;this.byFrame.clear();this.inFlight=null;this.dropped=0;this.completed=0;}
  _rank(x){return x?.kind==='keyframe'?2:1;}
  enqueue(job){
    const frameId=String(job?.frameId||'');if(!frameId)return {ok:false,reason:'missing-frame-id'};
    const frozen={...job,frameId,queuedAt:Number(job.queuedAt)||performance.now()};
    if(this.inFlight&&String(this.inFlight.frameId)===frameId)return {ok:true,deduplicated:true,inFlight:true,size:this.items.length};
    const old=this.byFrame.get(frameId);
    if(old){
      if(this._rank(frozen)>this._rank(old)){
        const i=this.items.indexOf(old);if(i>=0)this.items[i]=frozen;this.byFrame.set(frameId,frozen);return {ok:true,replaced:true,size:this.items.length};
      }
      return {ok:true,deduplicated:true,size:this.items.length};
    }
    if(this.items.length>=this.maxItems){this.dropped++;return {ok:false,reason:'queue-full',size:this.items.length};}
    this.items.push(frozen);this.byFrame.set(frameId,frozen);return {ok:true,size:this.items.length};
  }
  next(){
    if(this.inFlight||!this.items.length)return null;
    // Dense keyframes first, then FIFO within the same class.
    let best=0;for(let i=1;i<this.items.length;i++)if(this._rank(this.items[i])>this._rank(this.items[best]))best=i;
    const [job]=this.items.splice(best,1);this.byFrame.delete(job.frameId);this.inFlight=job;return job;
  }
  complete(jobId){
    if(this.inFlight&&String(this.inFlight.jobId)===String(jobId)){this.inFlight=null;this.completed++;return true;}return false;
  }
  fail(jobId){return this.complete(jobId);}
  stats(){const surveys=this.items.filter(x=>x.kind!=='keyframe').length,keyframes=this.items.length-surveys;return {queued:this.items.length,surveys,keyframes,inFlight:this.inFlight?1:0,inFlightKind:this.inFlight?.kind||null,inFlightJobId:this.inFlight?.jobId||null,dropped:this.dropped,completed:this.completed,maxItems:this.maxItems};}
}
