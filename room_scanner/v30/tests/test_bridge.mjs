import {locateAnchor} from '../js/xr/metric_bridge.js';
const w=180,h=120,N=16,gray=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)gray[y*w+x]=(x*11+y*7+((x>>3)^(y>>2))*29)&255;
const cx=90,cy=58,size=18,patch=new Uint8Array(N*N);for(let oy=0;oy<N;oy++)for(let ox=0;ox<N;ox++){const sx=Math.round(cx-size/2+(ox+.5)*size/N),sy=Math.round(cy-size/2+(oy+.5)*size/N);patch[oy*N+ox]=gray[sy*w+sx];}
const a={uv:[cx/w,cy/h],patch:Array.from(patch),patchSize:N,patchRel:size/Math.min(w,h)};const r=locateAnchor(gray,w,h,a,{searchFrac:.05,minScore:.45});if(!r.ok||Math.hypot(r.u-cx,r.v-cy)>5)throw new Error(JSON.stringify(r));console.log(`PASS metric_bridge_template score=${r.score.toFixed(3)} at=${r.u.toFixed(1)},${r.v.toFixed(1)}`);
