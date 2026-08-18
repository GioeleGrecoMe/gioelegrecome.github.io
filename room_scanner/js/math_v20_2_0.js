/** Lightweight vector, matrix and statistics helpers shared by capture/tests. */
export const EPS = 1e-9;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const deg = r => r * 180 / Math.PI;
export const rad = d => d * Math.PI / 180;
export const v3 = (x=0,y=0,z=0) => [x,y,z];
export const add3 = (a,b) => [a[0]+b[0],a[1]+b[1],a[2]+b[2]];
export const sub3 = (a,b) => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
export const scale3 = (a,s) => [a[0]*s,a[1]*s,a[2]*s];
export const dot3 = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const cross3 = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const len3 = a => Math.hypot(a[0],a[1],a[2]);
export const dist3 = (a,b) => len3(sub3(a,b));
export const norm3 = a => { const n=len3(a); return n>EPS?scale3(a,1/n):[0,0,0]; };
export const angle3 = (a,b) => Math.acos(clamp(dot3(norm3(a),norm3(b)),-1,1));
export const midpoint3 = (a,b) => scale3(add3(a,b),.5);

export function transformPoint4(m, p) {
  const x=p[0],y=p[1],z=p[2];
  const w=m[3]*x+m[7]*y+m[11]*z+m[15];
  const iw=Math.abs(w)>EPS?1/w:1;
  return [(m[0]*x+m[4]*y+m[8]*z+m[12])*iw,(m[1]*x+m[5]*y+m[9]*z+m[13])*iw,(m[2]*x+m[6]*y+m[10]*z+m[14])*iw];
}
export function transformDirection4(m, d) {
  return norm3([m[0]*d[0]+m[4]*d[1]+m[8]*d[2],m[1]*d[0]+m[5]*d[1]+m[9]*d[2],m[2]*d[0]+m[6]*d[1]+m[10]*d[2]]);
}
export function multiply4(a,b){
  const o=new Float32Array(16);
  for(let c=0;c<4;c++)for(let r=0;r<4;r++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s;}return o;
}
export function invert4(a){
  // General 4x4 inverse. Returning null is safer than emitting NaNs into the map.
  const out=new Float32Array(16);const m=a;
  const b00=m[0]*m[5]-m[1]*m[4],b01=m[0]*m[6]-m[2]*m[4],b02=m[0]*m[7]-m[3]*m[4];
  const b03=m[1]*m[6]-m[2]*m[5],b04=m[1]*m[7]-m[3]*m[5],b05=m[2]*m[7]-m[3]*m[6];
  const b06=m[8]*m[13]-m[9]*m[12],b07=m[8]*m[14]-m[10]*m[12],b08=m[8]*m[15]-m[11]*m[12];
  const b09=m[9]*m[14]-m[10]*m[13],b10=m[9]*m[15]-m[11]*m[13],b11=m[10]*m[15]-m[11]*m[14];
  let det=b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;if(Math.abs(det)<EPS)return null;det=1/det;
  out[0]=(m[5]*b11-m[6]*b10+m[7]*b09)*det;out[1]=(-m[1]*b11+m[2]*b10-m[3]*b09)*det;
  out[2]=(m[13]*b05-m[14]*b04+m[15]*b03)*det;out[3]=(-m[9]*b05+m[10]*b04-m[11]*b03)*det;
  out[4]=(-m[4]*b11+m[6]*b08-m[7]*b07)*det;out[5]=(m[0]*b11-m[2]*b08+m[3]*b07)*det;
  out[6]=(-m[12]*b05+m[14]*b02-m[15]*b01)*det;out[7]=(m[8]*b05-m[10]*b02+m[11]*b01)*det;
  out[8]=(m[4]*b10-m[5]*b08+m[7]*b06)*det;out[9]=(-m[0]*b10+m[1]*b08-m[3]*b06)*det;
  out[10]=(m[12]*b04-m[13]*b02+m[15]*b00)*det;out[11]=(-m[8]*b04+m[9]*b02-m[11]*b00)*det;
  out[12]=(-m[4]*b09+m[5]*b07-m[6]*b06)*det;out[13]=(m[0]*b09-m[1]*b07+m[2]*b06)*det;
  out[14]=(-m[12]*b03+m[13]*b01-m[14]*b00)*det;out[15]=(m[8]*b03-m[9]*b01+m[10]*b00)*det;return out;
}
export function cameraPositionFromMatrix(m){return [m[12],m[13],m[14]];}
export function forwardFromMatrix(m){return norm3([-m[8],-m[9],-m[10]]);}

export function projectWorldPoint(world, viewMatrix, projectionMatrix, width, height){
  const vp=multiply4(projectionMatrix,viewMatrix);const x=world[0],y=world[1],z=world[2];
  const cx=vp[0]*x+vp[4]*y+vp[8]*z+vp[12],cy=vp[1]*x+vp[5]*y+vp[9]*z+vp[13],cz=vp[2]*x+vp[6]*y+vp[10]*z+vp[14],cw=vp[3]*x+vp[7]*y+vp[11]*z+vp[15];
  if(cw<=EPS)return null;const nx=cx/cw,ny=cy/cw,nz=cz/cw;if(nz<-1.2||nz>1.2)return null;
  return {x:(nx*.5+.5)*width,y:(1-(ny*.5+.5))*height,ndc:[nx,ny,nz],inside:Math.abs(nx)<=1&&Math.abs(ny)<=1};
}

export class RunningStats {
  constructor(dim=1){this.dim=dim;this.n=0;this.mean=new Float64Array(dim);this.m2=new Float64Array(dim);}
  push(values,weight=1){const v=typeof values==='number'?[values]:values;for(let w=0;w<weight;w++){this.n++;for(let i=0;i<this.dim;i++){const d=v[i]-this.mean[i];this.mean[i]+=d/this.n;this.m2[i]+=d*(v[i]-this.mean[i]);}}}
  variance(i=0){return this.n>1?this.m2[i]/(this.n-1):Infinity;}
  std(i=0){return Math.sqrt(this.variance(i));}
}

export function quantile(values,q){if(!values.length)return NaN;const a=[...values].sort((x,y)=>x-y);const p=(a.length-1)*clamp(q,0,1);const i=Math.floor(p),f=p-i;return i+1<a.length?lerp(a[i],a[i+1],f):a[i];}
export function median(values){return quantile(values,.5);}
export function mad(values){if(!values.length)return NaN;const m=median(values);return 1.4826*median(values.map(v=>Math.abs(v-m)));}
export function hashCell(p,size){return `${Math.floor(p[0]/size)},${Math.floor(p[1]/size)},${Math.floor(p[2]/size)}`;}
export function parseCellKey(key,size){const a=key.split(',').map(Number);return [(a[0]+.5)*size,(a[1]+.5)*size,(a[2]+.5)*size];}
export function quantizedViewKey(p,step=.2){return `${Math.round(p[0]/step)},${Math.round(p[1]/step)},${Math.round(p[2]/step)}`;}
export function uid(prefix='id'){const c=globalThis.crypto;return c?.randomUUID?`${prefix}-${c.randomUUID()}`:`${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;}
export function serializableError(error){return {name:error?.name||'Error',message:String(error?.message||error),stack:String(error?.stack||''),cause:error?.cause?String(error.cause):undefined};}
export function finiteArray(a){return Array.from(a||[],v=>Number.isFinite(v)?v:0);}
