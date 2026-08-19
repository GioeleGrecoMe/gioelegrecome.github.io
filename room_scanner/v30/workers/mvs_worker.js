/*
 * V30.7 camera-only semi-dense MVS worker.
 *
 * A compact inverse-depth plane sweep scores small zero-mean grayscale patches
 * between two metric keyframes. Accepted samples are back-projected in the
 * reference camera, transformed to world coordinates, and emitted as RGB
 * point-Gaussian observations plus a conservative local triangle mesh.
 *
 * This is intentionally classical geometry: no DeepAI / monocular network.
 */
let cfg={near:.30,far:9,depthSteps:36,gridStep:7,maxPoints:5200,minScore:.54,maxSecondRatio:.96};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function qrot(q,v){const [x,y,z,w]=q,[vx,vy,vz]=v,tx=2*(y*vz-z*vy),ty=2*(z*vx-x*vz),tz=2*(x*vy-y*vx);return [vx+w*tx+(y*tz-z*ty),vy+w*ty+(z*tx-x*tz),vz+w*tz+(x*ty-y*tx)];}
function qconj(q){return [-q[0],-q[1],-q[2],q[3]];}
function camToWorld(T,p){const r=qrot(T.q,p);return [r[0]+T.p[0],r[1]+T.p[1],r[2]+T.p[2]];}
function worldToCam(T,p){return qrot(qconj(T.q),[p[0]-T.p[0],p[1]-T.p[1],p[2]-T.p[2]]);}
function back(u,v,z,K){return [(u-K.cx)*z/K.fx,-(v-K.cy)*z/K.fy,z];}
function proj(p,K){if(p[2]<=.06)return null;return [K.fx*p[0]/p[2]+K.cx,K.cy-K.fy*p[1]/p[2]];}
function norm(v){const n=Math.hypot(...v)||1;return [v[0]/n,v[1]/n,v[2]/n];}
function patchScore(A,Aw,Ah,ax,ay,B,Bw,Bh,bx,by){const r=2,ixa=Math.round(ax),iya=Math.round(ay),ixb=Math.round(bx),iyb=Math.round(by);if(ixa<r||iya<r||ixa>=Aw-r||iya>=Ah-r||ixb<r||iyb<r||ixb>=Bw-r||iyb>=Bh-r)return -1;let ma=0,mb=0,n=0;for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){ma+=A[(iya+dy)*Aw+ixa+dx];mb+=B[(iyb+dy)*Bw+ixb+dx];n++;}ma/=n;mb/=n;let num=0,da=0,db=0;for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const va=A[(iya+dy)*Aw+ixa+dx]-ma,vb=B[(iyb+dy)*Bw+ixb+dx]-mb;num+=va*vb;da+=va*va;db+=vb*vb;}if(da<80||db<80)return -1;return num/Math.sqrt(da*db);}
function gradient(gray,w,h,x,y){if(x<1||y<1||x>=w-1||y>=h-1)return 0;return Math.abs(gray[y*w+x+1]-gray[y*w+x-1])+Math.abs(gray[(y+1)*w+x]-gray[(y-1)*w+x]);}
function processPair(m){
  const ref=m.ref,cur=m.cur,A=new Uint8Array(ref.gray),B=new Uint8Array(cur.gray),rgb=new Uint8Array(ref.rgb),Aw=ref.width,Ah=ref.height,Bw=cur.width,Bh=cur.height,step=m.config?.gridStep||cfg.gridStep,depthSteps=m.config?.depthSteps||cfg.depthSteps,near=m.config?.near||cfg.near,far=m.config?.far||cfg.far,maxPoints=m.config?.maxPoints||cfg.maxPoints;
  const points=[],mesh=[],grid=new Map(),invN=1/near,invF=1/far;let tested=0,rejectedTexture=0,rejectedAmbiguous=0;
  outer:for(let y=step;y<Ah-step;y+=step){for(let x=step;x<Aw-step;x+=step){if(gradient(A,Aw,Ah,x,y)<24){rejectedTexture++;continue;}tested++;let best=-2,second=-2,bestZ=0;for(let di=0;di<depthSteps;di++){const t=depthSteps===1?0:di/(depthSteps-1),z=1/(invN*(1-t)+invF*t),pw=camToWorld(ref.pose,back(x+.5,y+.5,z,ref.K)),pc=worldToCam(cur.pose,pw),uv=proj(pc,cur.K);if(!uv)continue;const s=patchScore(A,Aw,Ah,x,y,B,Bw,Bh,uv[0],uv[1]);if(s>best){second=best;best=s;bestZ=z;}else if(s>second)second=s;}
      if(best<cfg.minScore||second>best*cfg.maxSecondRatio){rejectedAmbiguous++;continue;}const pc=back(x+.5,y+.5,bestZ,ref.K),pw=camToWorld(ref.pose,pc),toCam=[ref.pose.p[0]-pw[0],ref.pose.p[1]-pw[1],ref.pose.p[2]-pw[2]],nw=norm(toCam),ci=(y*Aw+x)*3,confidence=clamp((best-.45)/.45,0,1)*clamp((best-second)/.10,0,1),idx=points.length;
      points.push({p:pw,n:nw,c:[rgb[ci]||128,rgb[ci+1]||128,rgb[ci+2]||128],q:confidence,z:bestZ,gx:Math.round(x/step),gy:Math.round(y/step)});grid.set(`${Math.round(x/step)},${Math.round(y/step)}`,idx);if(points.length>=maxPoints)break outer;
    }}
  for(const [k,i0] of grid){const [gx,gy]=k.split(',').map(Number),i1=grid.get(`${gx+1},${gy}`),i2=grid.get(`${gx},${gy+1}`),i3=grid.get(`${gx+1},${gy+1}`);if(i1==null||i2==null||i3==null)continue;const a=points[i0],b=points[i1],c=points[i2],d=points[i3],zs=[a.z,b.z,c.z,d.z],zmin=Math.min(...zs),zmax=Math.max(...zs);if(zmax-zmin>Math.max(.10,zmin*.09))continue;const edge=(u,v)=>Math.hypot(u.p[0]-v.p[0],u.p[1]-v.p[1],u.p[2]-v.p[2]);if(Math.max(edge(a,b),edge(a,c),edge(b,d),edge(c,d))>.28)continue;mesh.push(i0,i1,i2,i1,i3,i2);}
  const stride=10,out=new Float32Array(points.length*stride),verts=new Float32Array(points.length*3);for(let i=0;i<points.length;i++){const p=points[i],o=i*stride;out[o]=p.p[0];out[o+1]=p.p[1];out[o+2]=p.p[2];out[o+3]=p.n[0];out[o+4]=p.n[1];out[o+5]=p.n[2];out[o+6]=p.c[0];out[o+7]=p.c[1];out[o+8]=p.c[2];out[o+9]=p.q;verts.set(p.p,i*3);}const indices=new Uint32Array(mesh);
  postMessage({type:'result',pairId:m.pairId,refId:ref.id,curId:cur.id,pointCount:points.length,triangleCount:indices.length/3,stride,points:out.buffer,meshVertices:verts.buffer,meshIndices:indices.buffer,stats:{tested,rejectedTexture,rejectedAmbiguous,accepted:points.length}},[out.buffer,verts.buffer,indices.buffer]);
}
self.onmessage=e=>{const m=e.data||{};try{if(m.type==='init'){cfg={...cfg,...m.config};postMessage({type:'ready',config:cfg});}else if(m.type==='pair')processPair(m);}catch(err){postMessage({type:'error',message:err.message,stack:err.stack,pairId:m.pairId});}};
