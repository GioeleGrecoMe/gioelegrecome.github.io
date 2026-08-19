/* Wrapper for the freestanding V30 WASM visual front-end. */
export class WasmVisionFrontend{
 constructor(url='./wasm/slam_core.wasm'){this.url=url;this.instance=null;this.prevFeatureCount=0;this.limits={maxWidth:640,maxHeight:480,maxPixels:640*480};}
 async init(){const r=await fetch(this.url);if(!r.ok)throw new Error(`WASM HTTP ${r.status}`);const bytes=await r.arrayBuffer();const {instance}=await WebAssembly.instantiate(bytes,{});this.instance=instance;const e=instance.exports;this.limits={maxWidth:e.max_width?.()||640,maxHeight:e.max_height?.()||480,maxPixels:e.max_pixels?.()||640*480};return this;}
 reset(){this.instance?.exports.reset();this.prevFeatureCount=0;}
 process(gray,w,h,{maxFeatures=900,threshold=18}={}){
  if(!this.instance)throw new Error('WASM frontend not initialized');const e=this.instance.exports,mem=e.memory;
  if(gray.length<w*h)throw new Error(`gray buffer smaller than frame: ${gray.length} < ${w*h}`);
  const L=this.limits;if(w<32||h<24||w>L.maxWidth||h>L.maxHeight||w*h>L.maxPixels)throw new Error(`WASM frame dimensions unsupported: ${w}x${h}; max ${L.maxWidth}x${L.maxHeight}, ${L.maxPixels} px`);
  new Uint8Array(mem.buffer,e.input_ptr(),w*h).set(gray.subarray(0,w*h));
  const previousCount=this.prevFeatureCount,n=e.process_frame(w,h,maxFeatures,threshold);if(n<0)throw new Error(`WASM rejected frame ${w}x${h}; max ${L.maxWidth}x${L.maxHeight}`);const mc=e.match_count(),db=e.descriptor_bytes();
  const xs=new Uint16Array(mem.buffer,e.curr_x_ptr(),n).slice(),ys=new Uint16Array(mem.buffer,e.curr_y_ptr(),n).slice(),scores=new Uint16Array(mem.buffer,e.curr_score_ptr(),n).slice(),desc=new Uint8Array(mem.buffer,e.curr_desc_ptr(),n*db).slice();
  const mi=new Int16Array(mem.buffer,e.match_curr_ptr(),mc).slice(),mp=new Int16Array(mem.buffer,e.match_prev_ptr(),mc).slice(),md=new Uint16Array(mem.buffer,e.match_dist_ptr(),mc).slice();
  this.prevFeatureCount=n;return {count:n,previousCount,xs,ys,scores,descriptors:desc,descriptorBytes:db,matches:{count:mc,curr:mi,prev:mp,distance:md}};
 }
}

function qToMat(q){const [x,y,z,w]=q,xx=x*x,yy=y*y,zz=z*z,xy=x*y,xz=x*z,yz=y*z,wx=w*x,wy=w*y,wz=w*z;return [1-2*(yy+zz),2*(xy-wz),2*(xz+wy),2*(xy+wz),1-2*(xx+zz),2*(yz-wx),2*(xz-wy),2*(yz+wx),1-2*(xx+yy)];}
function matToQ(m){const tr=m[0]+m[4]+m[8];let x,y,z,w;if(tr>0){const s=Math.sqrt(tr+1)*2;w=.25*s;x=(m[7]-m[5])/s;y=(m[2]-m[6])/s;z=(m[3]-m[1])/s;}else if(m[0]>m[4]&&m[0]>m[8]){const s=Math.sqrt(1+m[0]-m[4]-m[8])*2;w=(m[7]-m[5])/s;x=.25*s;y=(m[1]+m[3])/s;z=(m[2]+m[6])/s;}else if(m[4]>m[8]){const s=Math.sqrt(1+m[4]-m[0]-m[8])*2;w=(m[2]-m[6])/s;x=(m[1]+m[3])/s;y=.25*s;z=(m[5]+m[7])/s;}else{const s=Math.sqrt(1+m[8]-m[0]-m[4])*2;w=(m[3]-m[1])/s;x=(m[2]+m[6])/s;y=(m[5]+m[7])/s;z=.25*s;}const n=Math.hypot(x,y,z,w)||1;return [x/n,y/n,z/n,w/n];}
function transpose3(m){return [m[0],m[3],m[6],m[1],m[4],m[7],m[2],m[5],m[8]];}
WasmVisionFrontend.prototype.optimizePose=function(initialPose,correspondences,K,{iterations=5,maxPoints=180}={}){
 const e=this.instance?.exports;if(!e?.pnp_optimize||correspondences.length<8)return null;let corr=correspondences.filter(c=>c.world&&Number.isFinite(c.u)&&Number.isFinite(c.v));if(corr.length>maxPoints){const step=corr.length/maxPoints;corr=Array.from({length:maxPoints},(_,i)=>corr[Math.floor(i*step)]);}const mem=e.memory,wp=new Float32Array(mem.buffer,e.pnp_world_ptr(),corr.length*3),uv=new Float32Array(mem.buffer,e.pnp_uv_ptr(),corr.length*2);for(let i=0;i<corr.length;i++){wp.set(corr[i].world,i*3);uv[i*2]=corr[i].u;uv[i*2+1]=corr[i].v;}
 const Rwc=qToMat(initialPose.q),Rcw=transpose3(Rwc),p=initialPose.p,t=[-(Rcw[0]*p[0]+Rcw[1]*p[1]+Rcw[2]*p[2]),-(Rcw[3]*p[0]+Rcw[4]*p[1]+Rcw[5]*p[2]),-(Rcw[6]*p[0]+Rcw[7]*p[1]+Rcw[8]*p[2])],pose=new Float32Array(mem.buffer,e.pnp_pose_ptr(),12);pose.set(Rcw,0);pose.set(t,9);const inliers=e.pnp_optimize(corr.length,K.fx,K.fy,K.cx,K.cy,iterations),rmse=e.pnp_rmse(),Rcw2=Array.from(pose.slice(0,9)),Rwc2=transpose3(Rcw2),t2=Array.from(pose.slice(9,12)),p2=[-(Rwc2[0]*t2[0]+Rwc2[1]*t2[1]+Rwc2[2]*t2[2]),-(Rwc2[3]*t2[0]+Rwc2[4]*t2[1]+Rwc2[5]*t2[2]),-(Rwc2[6]*t2[0]+Rwc2[7]*t2[1]+Rwc2[8]*t2[2])];return {pose:{p:p2,q:matToQ(Rwc2)},inliers,rmse,ok:inliers>=10};
};
