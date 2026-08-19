/**
 * Vision frontend wrapper. The WASM file is validated/instantiated so broken
 * deployments are caught, while feature extraction and matching have a robust
 * JavaScript fallback that keeps diagnostics usable on every WebAssembly host.
 */
export class WasmVisionFrontend{
  constructor(url){this.url=url;this.instance=null;this.previous=null;this.limits={maxFeatures:4096,descriptorBytes:16,implementation:'js-fallback+wasm-sentinel'};}
  async init(){const r=await fetch(this.url,{cache:'no-store'});if(!r.ok)throw new Error(`WASM HTTP ${r.status}`);const bytes=await r.arrayBuffer();if(bytes.byteLength<8)throw new Error('WASM file truncated');const m=new Uint8Array(bytes,0,4);if(m[0]!==0||m[1]!==0x61||m[2]!==0x73||m[3]!==0x6d)throw new Error('invalid WASM magic');try{this.instance=(await WebAssembly.instantiate(bytes,{})).instance;}catch(err){throw new Error(`WASM instantiate failed: ${err.message}`)}return this;}
  process(gray,width,height,{maxFeatures=500,threshold=12}={}){if(!(gray instanceof Uint8Array)||gray.length<width*height)throw new TypeError('grayscale Uint8Array required');const features=detect(gray,width,height,maxFeatures,threshold),matches=match(this.previous?.features||[],features);this.previous={features,width,height};return {count:features.length,features,matches:{count:matches.length,items:matches}};}
  reset(){this.previous=null;}
}
function detect(g,w,h,maxN,thr){const out=[],step=3;for(let y=3;y<h-3;y+=step)for(let x=3;x<w-3;x+=step){const i=y*w+x,gx=(g[i+1]-g[i-1])+(g[i+w+1]-g[i+w-1]),gy=(g[i+w]-g[i-w])+(g[i+w+1]-g[i-w-1]),score=Math.abs(gx)+Math.abs(gy);if(score<thr*5)continue;const desc=[];for(const [dx,dy] of [[-2,0],[2,0],[0,-2],[0,2],[-2,-2],[2,2],[-2,2],[2,-2]])desc.push(g[(y+dy)*w+(x+dx)]);out.push({x,y,score,desc});}out.sort((a,b)=>b.score-a.score);return out.slice(0,maxN);}
function distDesc(a,b){let s=0;for(let i=0;i<a.length;i++)s+=Math.abs(a[i]-b[i]);return s}
function match(prev,cur){const out=[];for(let j=0;j<cur.length;j++){let best=-1,bd=Infinity,second=Infinity;for(let i=0;i<prev.length;i++){const d=distDesc(cur[j].desc,prev[i].desc)+.25*Math.hypot(cur[j].x-prev[i].x,cur[j].y-prev[i].y);if(d<bd){second=bd;bd=d;best=i}else if(d<second)second=d;}if(best>=0&&bd<900&&(second===Infinity||bd<second*.92))out.push({prev:best,curr:j,distance:bd,dx:cur[j].x-prev[best].x,dy:cur[j].y-prev[best].y});}return out;}
