/*
 * Room Scanner V30 - dependency-free 3D Gaussian splat viewer.
 * It renders each map Gaussian as an oriented elliptical billboard. This is a
 * real splat representation (mean/scale/normal/color/opacity), but not the
 * differentiable CUDA training renderer from the original 3DGS paper.
 */
const VERT=`#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 aCenter;
layout(location=2) in vec3 aScale;
layout(location=3) in vec3 aNormal;
layout(location=4) in vec3 aColor;
layout(location=5) in float aOpacity;
uniform mat4 uView,uProj;
uniform float uPointScale;
out vec2 vUV;out vec3 vColor;out float vOpacity;
void main(){
 vec3 cv=(uView*vec4(aCenter,1.0)).xyz;
 vec3 n=normalize(mat3(uView)*aNormal);
 if(length(n)<0.1)n=vec3(0.0,0.0,1.0);
 vec3 ref=abs(n.y)<0.92?vec3(0.0,1.0,0.0):vec3(1.0,0.0,0.0);
 vec3 t1=normalize(cross(ref,n));vec3 t2=normalize(cross(n,t1));
 float s1=max(0.006,max(aScale.x,aScale.z))*uPointScale;
 float s2=max(0.006,max(aScale.y,aScale.z))*uPointScale;
 vec3 p=cv+t1*(aCorner.x*s1*2.2)+t2*(aCorner.y*s2*2.2);
 gl_Position=uProj*vec4(p,1.0);vUV=aCorner;vColor=aColor;vOpacity=aOpacity;
}`;
const FRAG=`#version 300 es
precision highp float;in vec2 vUV;in vec3 vColor;in float vOpacity;out vec4 o;
void main(){float r2=dot(vUV,vUV);if(r2>1.0)discard;float a=exp(-3.8*r2)*vOpacity;if(a<0.018)discard;o=vec4(vColor,a);}`;
const MESH_VERT=`#version 300 es
precision highp float;layout(location=0) in vec3 aPosition;layout(location=1) in vec3 aColor;layout(location=2) in float aConfidence;
uniform mat4 uView,uProj;out vec3 vColor;out float vConfidence;
void main(){gl_Position=uProj*uView*vec4(aPosition,1.0);vColor=aColor;vConfidence=aConfidence;}`;
const MESH_FRAG=`#version 300 es
precision highp float;in vec3 vColor;in float vConfidence;out vec4 o;
void main(){float shade=.56+.44*clamp(vConfidence,0.0,1.0);o=vec4(vColor*shade,.94);}`;

function mat4Perspective(fovy,aspect,near,far){const f=1/Math.tan(fovy/2),nf=1/(near-far);return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*nf,-1,0,0,2*far*near*nf,0]);}
function vsub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}function vnorm(a){const n=Math.hypot(...a)||1;return a.map(v=>v/n);}function vcross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
function lookAt(eye,target,up=[0,1,0]){const z=vnorm(vsub(eye,target)),x=vnorm(vcross(up,z)),y=vcross(z,x);return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-x[0]*eye[0]-x[1]*eye[1]-x[2]*eye[2],-y[0]*eye[0]-y[1]*eye[1]-y[2]*eye[2],-z[0]*eye[0]-z[1]*eye[1]-z[2]*eye[2],1]);}
function shader(gl,type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}function program(gl,vert=VERT,frag=FRAG){const p=gl.createProgram();gl.attachShader(p,shader(gl,gl.VERTEX_SHADER,vert));gl.attachShader(p,shader(gl,gl.FRAGMENT_SHADER,frag));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));return p;}

export class GaussianRenderer{
 constructor(canvas){this.canvas=canvas;this.gl=canvas.getContext('webgl2',{alpha:false,antialias:false,preserveDrawingBuffer:false});this.count=0;this.pointScale=1;this.target=[0,0,0];this.yaw=.65;this.pitch=.35;this.distance=4;this.pan=[0,0,0];this.mode='orbit';this._raf=0;this._init();this._controls();}
 _fallback(error){this.initError=error?.message||String(error||'WebGL unavailable');this.fallback=true;this.gl=null;this.ctx=this.canvas.getContext('2d');}
 _init(){const gl=this.gl;if(!gl){this._fallback('WebGL2 unavailable');return;}try{this.prog=program(gl);this.vao=gl.createVertexArray();gl.bindVertexArray(this.vao);const corners=new Float32Array([-1,-1,1,-1,1,1,-1,-1,1,1,-1,1]);const cb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,cb);gl.bufferData(gl.ARRAY_BUFFER,corners,gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);this.buffers=[];for(let loc=1;loc<=5;loc++){const b=gl.createBuffer();this.buffers.push(b);gl.bindBuffer(gl.ARRAY_BUFFER,b);const size=loc<=4?3:1;gl.bufferData(gl.ARRAY_BUFFER,4*size,gl.DYNAMIC_DRAW);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,0,0);gl.vertexAttribDivisor(loc,1);}gl.bindVertexArray(null);this.meshProg=program(gl,MESH_VERT,MESH_FRAG);this.meshVao=gl.createVertexArray();gl.bindVertexArray(this.meshVao);this.meshBuffers=[gl.createBuffer(),gl.createBuffer(),gl.createBuffer()];for(let loc=0;loc<3;loc++){gl.bindBuffer(gl.ARRAY_BUFFER,this.meshBuffers[loc]);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,loc<2?3:1,gl.FLOAT,false,0,0);}this.meshIndex=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.meshIndex);gl.bindVertexArray(null);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.clearColor(.025,.03,.04,1);this.uView=gl.getUniformLocation(this.prog,'uView');this.uProj=gl.getUniformLocation(this.prog,'uProj');this.uPointScale=gl.getUniformLocation(this.prog,'uPointScale');this.meshUView=gl.getUniformLocation(this.meshProg,'uView');this.meshUProj=gl.getUniformLocation(this.meshProg,'uProj');}catch(e){this._fallback(e);}}
 setMesh(mesh){if(!mesh?.positions||!mesh?.indices)return;const positions=mesh.positions instanceof Float32Array?mesh.positions:new Float32Array(mesh.positions),colors=mesh.colors instanceof Float32Array?mesh.colors:new Float32Array(mesh.colors||positions.length),confidence=mesh.confidence instanceof Float32Array?mesh.confidence:new Float32Array(mesh.confidence||positions.length/3),indices=mesh.indices instanceof Uint32Array?mesh.indices:new Uint32Array(mesh.indices),n=Math.floor(positions.length/3);if(!n)return;this.mesh={positions,colors,confidence,indices,vertexCount:n,triangleCount:Math.floor(indices.length/3),sealed:!!mesh.sealed};let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<positions.length;i+=3)for(let k=0;k<3;k++){min[k]=Math.min(min[k],positions[i+k]);max[k]=Math.max(max[k],positions[i+k]);}if(this.gl){const gl=this.gl;[positions,colors,confidence].forEach((a,i)=>{gl.bindBuffer(gl.ARRAY_BUFFER,this.meshBuffers[i]);gl.bufferData(gl.ARRAY_BUFFER,a,gl.DYNAMIC_DRAW);});gl.bindVertexArray(this.meshVao);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.meshIndex);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,indices,gl.DYNAMIC_DRAW);gl.bindVertexArray(null);}this.count=n;this._meshBounds={min,max};this._fitMesh();this.requestRender();}
 _fitMesh(){const b=this._meshBounds;if(!b)return;this.target=[(b.min[0]+b.max[0])/2,(b.min[1]+b.max[1])/2,(b.min[2]+b.max[2])/2];this.distance=Math.max(1.2,Math.hypot(b.max[0]-b.min[0],b.max[1]-b.min[1],b.max[2]-b.min[2])*.9);}
 setData(snapshot){if(!snapshot?.data)return;this.mesh=null;const a=snapshot.data,stride=snapshot.stride||16,n=Math.floor(a.length/stride);this.count=n;if(!n)return;const center=new Float32Array(n*3),scale=new Float32Array(n*3),normal=new Float32Array(n*3),color=new Float32Array(n*3),opacity=new Float32Array(n);let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<n;i++){const s=i*stride,j=i*3;center[j]=a[s];center[j+1]=a[s+1];center[j+2]=a[s+2];scale[j]=a[s+3];scale[j+1]=a[s+4];scale[j+2]=a[s+5];normal[j]=a[s+6];normal[j+1]=a[s+7];normal[j+2]=a[s+8];color[j]=a[s+9];color[j+1]=a[s+10];color[j+2]=a[s+11];opacity[i]=a[s+12];for(let k=0;k<3;k++){min[k]=Math.min(min[k],center[j+k]);max[k]=Math.max(max[k],center[j+k]);}}
  this._arrays={center,scale,normal,color,opacity};if(this.gl){const gl=this.gl;[center,scale,normal,color,opacity].forEach((arr,i)=>{gl.bindBuffer(gl.ARRAY_BUFFER,this.buffers[i]);gl.bufferData(gl.ARRAY_BUFFER,arr,gl.DYNAMIC_DRAW);});}
  if(!this._fitDone){this.target=[(min[0]+max[0])/2,(min[1]+max[1])/2,(min[2]+max[2])/2];this.distance=Math.max(1.2,Math.hypot(max[0]-min[0],max[1]-min[1],max[2]-min[2])*.9);this._fitDone=true;}this.requestRender();}
 requestRender(){if(!this._raf)this._raf=requestAnimationFrame(()=>{this._raf=0;this.render();});}
 render(){this._resize();if(this.fallback)return this._render2d();const gl=this.gl;gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);if(!this.count)return;const cp=Math.cos(this.pitch),eye=[this.target[0]+this.pan[0]+this.distance*cp*Math.sin(this.yaw),this.target[1]+this.pan[1]+this.distance*Math.sin(this.pitch),this.target[2]+this.pan[2]+this.distance*cp*Math.cos(this.yaw)],target=[this.target[0]+this.pan[0],this.target[1]+this.pan[1],this.target[2]+this.pan[2]],view=lookAt(eye,target),proj=mat4Perspective(Math.PI/3,this.canvas.width/this.canvas.height,.03,100);if(this.mesh){if(this.mesh.triangleCount){gl.useProgram(this.meshProg);gl.uniformMatrix4fv(this.meshUView,false,view);gl.uniformMatrix4fv(this.meshUProj,false,proj);gl.bindVertexArray(this.meshVao);gl.drawElements(gl.TRIANGLES,this.mesh.indices.length,gl.UNSIGNED_INT,0);gl.bindVertexArray(null);}return;}gl.useProgram(this.prog);gl.uniformMatrix4fv(this.uView,false,view);gl.uniformMatrix4fv(this.uProj,false,proj);gl.uniform1f(this.uPointScale,this.pointScale);gl.bindVertexArray(this.vao);gl.depthMask(false);gl.drawArraysInstanced(gl.TRIANGLES,0,6,this.count);gl.depthMask(true);gl.bindVertexArray(null);}
 _render2d(){const c=this.ctx;if(!c)return;c.fillStyle='#07090d';c.fillRect(0,0,this.canvas.width,this.canvas.height);const p=this.mesh?.positions||this._arrays?.center;if(!p)return;c.fillStyle='#ddd';const n=p.length/3,scale=Math.min(this.canvas.width,this.canvas.height)/(this.distance*2.2);for(let i=0;i<n;i+=Math.max(1,Math.floor(n/25000))){const j=i*3,x=this.canvas.width/2+(p[j]-this.target[0])*scale,y=this.canvas.height/2-(p[j+2]-this.target[2])*scale;c.fillRect(x,y,1.5,1.5);}}
 _resize(){const dpr=Math.min(2,devicePixelRatio||1),w=Math.max(2,Math.floor(this.canvas.clientWidth*dpr)),h=Math.max(2,Math.floor(this.canvas.clientHeight*dpr));if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}}
 fit(){if(this.mesh){this._fitMesh();this.requestRender();return;}this._fitDone=false;if(this._arrays)this.setData({data:this._packCurrent(),stride:16});}
 _packCurrent(){const {center,scale,normal,color,opacity}=this._arrays||{},a=new Float32Array(this.count*16);for(let i=0;i<this.count;i++){const s=i*16,j=i*3;a.set(center.subarray(j,j+3),s);a.set(scale.subarray(j,j+3),s+3);a.set(normal.subarray(j,j+3),s+6);a.set(color.subarray(j,j+3),s+9);a[s+12]=opacity[i];}return a;}
 setMode(m){this.mode=m;}
 _controls(){let pointers=new Map(),lastDist=0,lastMid=null;this.canvas.addEventListener('pointerdown',e=>{this.canvas.setPointerCapture?.(e.pointerId);pointers.set(e.pointerId,[e.clientX,e.clientY]);});this.canvas.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId))return;const prev=pointers.get(e.pointerId),cur=[e.clientX,e.clientY];pointers.set(e.pointerId,cur);if(pointers.size===1){const dx=cur[0]-prev[0],dy=cur[1]-prev[1];if(this.mode==='pan'||e.shiftKey||e.buttons===2){const s=this.distance*.0018;this.pan[0]-=dx*s;this.pan[1]+=dy*s;}else{this.yaw-=dx*.007;this.pitch=Math.max(-1.45,Math.min(1.45,this.pitch-dy*.007));}}else if(pointers.size>=2){const ps=[...pointers.values()],dx=ps[1][0]-ps[0][0],dy=ps[1][1]-ps[0][1],d=Math.hypot(dx,dy),mid=[(ps[0][0]+ps[1][0])/2,(ps[0][1]+ps[1][1])/2];if(lastDist)this.distance*=lastDist/d;if(lastMid){const s=this.distance*.0015;this.pan[0]-=(mid[0]-lastMid[0])*s;this.pan[1]+=(mid[1]-lastMid[1])*s;}lastDist=d;lastMid=mid;}this.requestRender();});const up=e=>{pointers.delete(e.pointerId);if(pointers.size<2){lastDist=0;lastMid=null;}};this.canvas.addEventListener('pointerup',up);this.canvas.addEventListener('pointercancel',up);this.canvas.addEventListener('wheel',e=>{e.preventDefault();this.distance*=Math.exp(e.deltaY*.001);this.distance=Math.max(.2,Math.min(80,this.distance));this.requestRender();},{passive:false});this.canvas.addEventListener('dblclick',()=>{this.pan=[0,0,0];this.requestRender();});}
}
