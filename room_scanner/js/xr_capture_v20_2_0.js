import {BUILD,GRID} from './config_v20_2_0.js';
import {add3,angle3,cameraPositionFromMatrix,clamp,cross3,dist3,finiteArray,forwardFromMatrix,invert4,len3,norm3,projectWorldPoint,quantizedViewKey,scale3,sub3,transformDirection4,transformPoint4,uid} from './math_v20_2_0.js';
import {AdaptiveGridOverlay,summarizeCoverage} from './grid_v20_2_0.js';
import {computePatchDescriptor} from './markpoints_v20_2_0.js';


/**
 * Lightweight XR pose-motion tracker used by capture scheduling.
 *
 * V20.4.0 accidentally instantiated PoseMotionTracker without defining it,
 * causing an immediate ReferenceError when the XR capture controller was
 * constructed.  Keep the tracker local to this module so it cannot depend on
 * globals or script load order.
 *
 * The tracker intentionally filters frame-to-frame motion: raw XR poses can
 * contain tiny jitter that should not suppress photos/chirps, while a tracking
 * discontinuity or a long suspended frame must not be interpreted as a huge
 * physical velocity.  All timestamps are XR rAF timestamps in milliseconds.
 */
class PoseMotionTracker {
  constructor({linearTauS=0.12,angularTauS=0.10,maxGapMs=450}={}){
    this.linearTauS=linearTauS;
    this.angularTauS=angularTauS;
    this.maxGapMs=maxGapMs;
    this.reset();
  }

  reset(){
    this.previousPosition=null;
    this.previousQuaternion=null;
    this.previousForward=null;
    this.previousTime=null;
    this.linearSpeed=0;
    this.angularSpeed=0;
    this.stability=1;
  }

  _quaternion(orientation){
    if(!orientation)return null;
    const q=[Number(orientation.x),Number(orientation.y),Number(orientation.z),Number(orientation.w)];
    if(!q.every(Number.isFinite))return null;
    const n=Math.hypot(q[0],q[1],q[2],q[3]);
    if(n<1e-8)return null;
    return q.map(v=>v/n);
  }

  _angularDelta(q0,q1,forward0,forward1){
    if(q0&&q1){
      // q and -q represent the same rotation, therefore use |dot|.
      const d=Math.abs(q0[0]*q1[0]+q0[1]*q1[1]+q0[2]*q1[2]+q0[3]*q1[3]);
      return 2*Math.acos(clamp(d,-1,1));
    }
    if(forward0&&forward1)return angle3(forward0,forward1);
    return 0;
  }

  update(matrix,orientation,time){
    const position=cameraPositionFromMatrix(matrix);
    const quaternion=this._quaternion(orientation);
    const forward=norm3(forwardFromMatrix(matrix));
    const now=Number.isFinite(time)?time:performance.now();

    if(!this.previousPosition||!Number.isFinite(this.previousTime)){
      this.previousPosition=position.slice();
      this.previousQuaternion=quaternion;
      this.previousForward=forward;
      this.previousTime=now;
      return {position,linearSpeed:0,angularSpeed:0,stability:1,dtS:0,discontinuity:false};
    }

    const dtMs=now-this.previousTime;
    // Rebase after tab/compositor stalls. Dividing a large pose jump by a stale
    // timestamp creates false motion and used to suppress capture for seconds.
    if(!Number.isFinite(dtMs)||dtMs<=0||dtMs>this.maxGapMs){
      this.previousPosition=position.slice();
      this.previousQuaternion=quaternion;
      this.previousForward=forward;
      this.previousTime=now;
      this.linearSpeed*=0.35;
      this.angularSpeed*=0.35;
      this.stability=Math.max(0.55,this.stability*0.8);
      return {position,linearSpeed:this.linearSpeed,angularSpeed:this.angularSpeed,stability:this.stability,dtS:0,discontinuity:true};
    }

    const dtS=Math.max(0.001,dtMs/1000);
    const rawLinear=dist3(position,this.previousPosition)/dtS;
    const rawAngular=this._angularDelta(this.previousQuaternion,quaternion,this.previousForward,forward)/dtS;

    // Very large single-frame velocities are almost certainly relocalisation
    // jumps rather than the user physically moving the phone that fast.
    const discontinuity=rawLinear>6||rawAngular>12;
    if(discontinuity){
      this.linearSpeed*=0.5;
      this.angularSpeed*=0.5;
    }else{
      const aLin=1-Math.exp(-dtS/this.linearTauS);
      const aAng=1-Math.exp(-dtS/this.angularTauS);
      this.linearSpeed+=(rawLinear-this.linearSpeed)*aLin;
      this.angularSpeed+=(rawAngular-this.angularSpeed)*aAng;
    }

    // Deliberately permissive: the dense scanner should keep collecting while
    // walking. Stability is guidance/quality metadata, not a hard capture gate.
    const linearPenalty=Math.min(1,this.linearSpeed/1.6);
    const angularPenalty=Math.min(1,this.angularSpeed/3.2);
    this.stability=clamp(1-0.55*linearPenalty-0.45*angularPenalty,0,1);

    this.previousPosition=position.slice();
    this.previousQuaternion=quaternion;
    this.previousForward=forward;
    this.previousTime=now;

    return {position,linearSpeed:this.linearSpeed,angularSpeed:this.angularSpeed,stability:this.stability,dtS,discontinuity};
  }
}

/** Legacy compact point format retained for V20.2/V20.3 RAW compatibility. */
export function encodePointBatch(points,origin){
  const count=Math.floor(points.length/10),header=20,recordBytes=14,buffer=new ArrayBuffer(header+count*recordBytes),dv=new DataView(buffer);dv.setUint32(0,0x52535054,true);dv.setUint16(4,1,true);dv.setUint16(6,recordBytes,true);dv.setUint32(8,count,true);dv.setFloat32(12,GRID.sourceVoxelM,true);dv.setUint32(16,0,true);let o=header;
  for(let i=0;i<count;i++){const p=i*10;for(let k=0;k<3;k++)dv.setInt16(o+k*2,clamp(Math.round((points[p+k]-origin[k])*1000),-32767,32767),true);dv.setInt8(o+6,clamp(Math.round(points[p+3]*127),-127,127));dv.setInt8(o+7,clamp(Math.round(points[p+4]*127),-127,127));dv.setInt8(o+8,clamp(Math.round(points[p+5]*127),-127,127));dv.setUint8(o+9,clamp(Math.round(points[p+6]),0,255));dv.setUint8(o+10,clamp(Math.round(points[p+7]),0,255));dv.setUint8(o+11,clamp(Math.round(points[p+8]),0,255));dv.setUint8(o+12,clamp(Math.round(points[p+9]*255),0,255));dv.setUint8(o+13,0);o+=recordBytes;}return buffer;
}
export function decodePointBatch(buffer,origin){const dv=new DataView(buffer),magic=dv.getUint32(0,true);if(magic!==0x52535054)throw new Error('Point batch non valido');const count=dv.getUint32(8,true),stride=dv.getUint16(6,true),out=new Float32Array(count*10);let o=20;for(let i=0;i<count;i++,o+=stride){const p=i*10;out[p]=origin[0]+dv.getInt16(o,true)/1000;out[p+1]=origin[1]+dv.getInt16(o+2,true)/1000;out[p+2]=origin[2]+dv.getInt16(o+4,true)/1000;out[p+3]=dv.getInt8(o+6)/127;out[p+4]=dv.getInt8(o+7)/127;out[p+5]=dv.getInt8(o+8)/127;out[p+6]=dv.getUint8(o+9);out[p+7]=dv.getUint8(o+10);out[p+8]=dv.getUint8(o+11);out[p+9]=dv.getUint8(o+12)/255;}return out;}

/**
 * V20.4 raw ray format (RSRY v1), 14 bytes per sample.
 *
 * Each record stores normalized view UV, metric Z depth, a world-space normal,
 * RGB (when Raw Camera was sampled in the same XR frame) and confidence.  The
 * camera matrix + projection matrix live in the blob metadata, so a later
 * desktop/GPU process can reconstruct the exact 3-D ray rather than inheriting
 * an early surface simplification.
 */
export function encodeRayBatch(samples,{depthWidth=0,depthHeight=0}={}){
  const count=samples.length,header=24,stride=14,buffer=new ArrayBuffer(header+count*stride),dv=new DataView(buffer);dv.setUint32(0,0x52535259,true);dv.setUint16(4,1,true);dv.setUint16(6,stride,true);dv.setUint32(8,count,true);dv.setUint16(12,depthWidth,true);dv.setUint16(14,depthHeight,true);dv.setUint32(16,0,true);dv.setUint32(20,0,true);let o=header;
  for(const s of samples){dv.setUint16(o,clamp(Math.round(s.u*65535),0,65535),true);dv.setUint16(o+2,clamp(Math.round(s.v*65535),0,65535),true);dv.setUint16(o+4,clamp(Math.round(s.depthM*1000),0,65535),true);dv.setInt8(o+6,clamp(Math.round((s.normal?.[0]||0)*127),-127,127));dv.setInt8(o+7,clamp(Math.round((s.normal?.[1]||0)*127),-127,127));dv.setInt8(o+8,clamp(Math.round((s.normal?.[2]||0)*127),-127,127));dv.setUint8(o+9,clamp(Math.round(s.rgb?.[0]??145),0,255));dv.setUint8(o+10,clamp(Math.round(s.rgb?.[1]??145),0,255));dv.setUint8(o+11,clamp(Math.round(s.rgb?.[2]??145),0,255));dv.setUint8(o+12,clamp(Math.round((s.confidence??.5)*255),0,255));dv.setUint8(o+13,s.hasRgb?1:0);o+=stride;}return buffer;
}

export function decodeRayBatchToPoints(buffer,{cameraMatrix,projectionMatrix}={}){
  const dv=new DataView(buffer),magic=dv.getUint32(0,true);if(magic!==0x52535259)throw new Error('Ray batch non valido');const count=dv.getUint32(8,true),stride=dv.getUint16(6,true),invProj=invert4(projectionMatrix);if(!invProj||!cameraMatrix)throw new Error('Pose/proiezione mancanti per ray batch');const out=new Float32Array(count*10);let o=24;
  for(let i=0;i<count;i++,o+=stride){const u=dv.getUint16(o,true)/65535,v=dv.getUint16(o+2,true)/65535,depthM=dv.getUint16(o+4,true)/1000,far=transformPoint4(invProj,[u*2-1,1-v*2,1]),ray=norm3(far),k=ray[2]<-.001?depthM/(-ray[2]):0,world=k>0?transformPoint4(cameraMatrix,[ray[0]*k,ray[1]*k,ray[2]*k]):[NaN,NaN,NaN],p=i*10;out[p]=world[0];out[p+1]=world[1];out[p+2]=world[2];out[p+3]=dv.getInt8(o+6)/127;out[p+4]=dv.getInt8(o+7)/127;out[p+5]=dv.getInt8(o+8)/127;out[p+6]=dv.getUint8(o+9);out[p+7]=dv.getUint8(o+10);out[p+8]=dv.getUint8(o+11);out[p+9]=dv.getUint8(o+12)/255;}return out;
}

class RawCameraReader {
  constructor(gl,binding,{targetWidth=416,diagnostics}){this.gl=gl;this.binding=binding;this.targetWidth=targetWidth;this.diag=diagnostics;this.program=null;this.fbo=null;this.outputTexture=null;this.width=0;this.height=0;this.disabled=false;}
  _compile(type,source){const gl=this.gl,s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s)||'Shader camera non compilato');return s;}
  _init(width,height){const gl=this.gl;if(!(gl instanceof WebGL2RenderingContext))throw new Error('Raw camera readback richiede WebGL2');const vs=this._compile(gl.VERTEX_SHADER,'#version 300 es\nin vec2 a_position;out vec2 v_uv;void main(){v_uv=a_position*.5+.5;gl_Position=vec4(a_position,0.,1.);}');const fs=this._compile(gl.FRAGMENT_SHADER,'#version 300 es\nprecision mediump float;uniform sampler2D u_camera;in vec2 v_uv;out vec4 outColor;void main(){outColor=texture(u_camera,v_uv);}');const p=gl.createProgram();gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p)||'Programma camera non collegato');gl.deleteShader(vs);gl.deleteShader(fs);const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);this.program={p,b,a:gl.getAttribLocation(p,'a_position'),u:gl.getUniformLocation(p,'u_camera')};this.fbo=gl.createFramebuffer();this.outputTexture=gl.createTexture();this._resize(width,height);}
  _resize(width,height){const gl=this.gl;this.width=width;this.height=height;gl.bindTexture(gl.TEXTURE_2D,this.outputTexture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.bindFramebuffer(gl.FRAMEBUFFER,this.fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.outputTexture,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Framebuffer camera incompleto');gl.bindFramebuffer(gl.FRAMEBUFFER,null);}
  async read(view){
    if(this.disabled||!view.camera)return null;const gl=this.gl;try{const texture=this.binding.getCameraImage(view.camera);if(!texture)return null;const aspect=view.camera.width/view.camera.height,width=Math.max(160,Math.min(this.targetWidth,view.camera.width)),height=Math.max(120,Math.round(width/aspect));if(!this.program)this._init(width,height);else if(width!==this.width||height!==this.height)this._resize(width,height);const prevFbo=gl.getParameter(gl.FRAMEBUFFER_BINDING),prevViewport=gl.getParameter(gl.VIEWPORT),prevProgram=gl.getParameter(gl.CURRENT_PROGRAM);gl.bindFramebuffer(gl.FRAMEBUFFER,this.fbo);gl.viewport(0,0,width,height);gl.useProgram(this.program.p);gl.bindBuffer(gl.ARRAY_BUFFER,this.program.b);gl.enableVertexAttribArray(this.program.a);gl.vertexAttribPointer(this.program.a,2,gl.FLOAT,false,0,0);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(this.program.u,0);gl.drawArrays(gl.TRIANGLES,0,6);const pixels=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);gl.bindFramebuffer(gl.FRAMEBUFFER,prevFbo);gl.viewport(prevViewport[0],prevViewport[1],prevViewport[2],prevViewport[3]);gl.useProgram(prevProgram);const flipped=flipRows(pixels,width,height);return {rgba:flipped,width,height,cameraWidth:view.camera.width,cameraHeight:view.camera.height};}catch(error){this.disabled=true;this.diag?.error('raw-camera-disabled',error);return null;}
  }
  dispose(){const gl=this.gl;try{if(this.program){gl.deleteBuffer(this.program.b);gl.deleteProgram(this.program.p);}if(this.outputTexture)gl.deleteTexture(this.outputTexture);if(this.fbo)gl.deleteFramebuffer(this.fbo);}catch{}this.program=this.outputTexture=this.fbo=null;}
}


/**
 * GPU depth downsampler for runtimes that negotiate `gpu-optimized` depth.
 *
 * XRWebGLDepthInformation exposes an opaque WebGL texture, not CPU memory. We
 * sample that texture in a tiny RGBA8 framebuffer while the XR frame is active
 * and encode metric Z depth as 24-bit millimetres.  Only the downsampled buffer
 * crosses GPU->CPU, so the capture loop can still collect thousands of rays per
 * batch without a full-resolution readPixels stall.
 */
class GpuDepthReader {
  constructor(gl,{diagnostics}){this.gl=gl;this.diag=diagnostics;this.programCache=new Map();this.fbo=null;this.outputTexture=null;this.width=0;this.height=0;this.disabled=false;this.failures=0;}
  _compile(type,source){const gl=this.gl,s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const msg=gl.getShaderInfoLog(s)||'Shader GPU depth non compilato';gl.deleteShader(s);throw new Error(msg);}return s;}
  _program(dataFormat,textureType){
    const key=`${dataFormat}|${textureType}`;if(this.programCache.has(key))return this.programCache.get(key);const gl=this.gl,isArray=textureType==='texture-array';const isUint=dataFormat==='unsigned-short';const sampler=isUint?(isArray?'usampler2DArray':'usampler2D'):(isArray?'sampler2DArray':'sampler2D');
    const fetch=isArray?`texture(u_depth,vec3(duv,float(u_layer)))`:`texture(u_depth,duv)`;
    let decode;if(dataFormat==='luminance-alpha')decode=`vec4 t=${fetch}; float raw=dot(t.ra,vec2(255.0,65280.0));`;
    else if(dataFormat==='unsigned-short')decode=`uvec4 t=${fetch}; float raw=float(t.r);`;
    else decode=`vec4 t=${fetch}; float raw=t.r;`;
    const vs=`#version 300 es\nin vec2 a_position;out vec2 v_viewUv;void main(){vec2 uv=a_position*.5+.5;v_viewUv=vec2(uv.x,1.0-uv.y);gl_Position=vec4(a_position,0.0,1.0);}`;
    const fs=`#version 300 es\nprecision highp float;precision highp int;precision highp usampler2D;precision highp usampler2DArray;in vec2 v_viewUv;uniform ${sampler} u_depth;uniform mat4 u_uvTransform;uniform float u_rawToMeters;uniform int u_layer;out vec4 outColor;void main(){vec4 q=u_uvTransform*vec4(v_viewUv,0.0,1.0);vec2 duv=q.xy;if(any(lessThan(duv,vec2(0.0)))||any(greaterThan(duv,vec2(1.0)))){outColor=vec4(0.0);return;}${decode}float meters=raw*u_rawToMeters;if(!(meters>0.08&&meters<65.0)){outColor=vec4(0.0);return;}float mm=floor(clamp(meters*1000.0,0.0,16777215.0)+0.5);float r=floor(mm/65536.0);mm-=r*65536.0;float g=floor(mm/256.0);float b=mm-g*256.0;outColor=vec4(r,g,b,255.0)/255.0;}`;
    const sv=this._compile(gl.VERTEX_SHADER,vs),sf=this._compile(gl.FRAGMENT_SHADER,fs),p=gl.createProgram();gl.attachShader(p,sv);gl.attachShader(p,sf);gl.linkProgram(p);gl.deleteShader(sv);gl.deleteShader(sf);if(!gl.getProgramParameter(p,gl.LINK_STATUS)){const msg=gl.getProgramInfoLog(p)||'Programma GPU depth non collegato';gl.deleteProgram(p);throw new Error(msg);}const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);const out={p,b,a:gl.getAttribLocation(p,'a_position'),uDepth:gl.getUniformLocation(p,'u_depth'),uUv:gl.getUniformLocation(p,'u_uvTransform'),uScale:gl.getUniformLocation(p,'u_rawToMeters'),uLayer:gl.getUniformLocation(p,'u_layer'),target:isArray?gl.TEXTURE_2D_ARRAY:gl.TEXTURE_2D};this.programCache.set(key,out);return out;
  }
  _resize(width,height){const gl=this.gl;if(!this.fbo)this.fbo=gl.createFramebuffer();if(!this.outputTexture)this.outputTexture=gl.createTexture();this.width=width;this.height=height;gl.bindTexture(gl.TEXTURE_2D,this.outputTexture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.bindFramebuffer(gl.FRAMEBUFFER,this.fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.outputTexture,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Framebuffer GPU depth incompleto');}
  read(info,{maxPoints=6200,dataFormat='float32'}={}){
    if(this.disabled||!info?.texture)return null;const gl=this.gl;if(!(gl instanceof WebGL2RenderingContext)){this.disabled=true;return null;}try{
      const aspect=Math.max(.2,Math.min(5,(info.width||1)/Math.max(1,info.height||1))),target=Math.max(256,Math.min(maxPoints|0,14000)),width=Math.max(20,Math.round(Math.sqrt(target*aspect))),height=Math.max(16,Math.floor(target/width));if(width!==this.width||height!==this.height)this._resize(width,height);const prog=this._program(dataFormat,info.textureType||'texture');
      const state={fbo:gl.getParameter(gl.FRAMEBUFFER_BINDING),viewport:Array.from(gl.getParameter(gl.VIEWPORT)),program:gl.getParameter(gl.CURRENT_PROGRAM),active:gl.getParameter(gl.ACTIVE_TEXTURE),arrayBuffer:gl.getParameter(gl.ARRAY_BUFFER_BINDING),vao:gl.getParameter(gl.VERTEX_ARRAY_BINDING),scissor:gl.isEnabled(gl.SCISSOR_TEST),blend:gl.isEnabled(gl.BLEND),depth:gl.isEnabled(gl.DEPTH_TEST),colorMask:Array.from(gl.getParameter(gl.COLOR_WRITEMASK))};gl.activeTexture(gl.TEXTURE0);state.tex2d=gl.getParameter(gl.TEXTURE_BINDING_2D);state.tex2da=gl.getParameter(gl.TEXTURE_BINDING_2D_ARRAY);
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.fbo);gl.viewport(0,0,width,height);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.colorMask(true,true,true,true);gl.useProgram(prog.p);gl.bindVertexArray(null);gl.bindBuffer(gl.ARRAY_BUFFER,prog.b);gl.enableVertexAttribArray(prog.a);gl.vertexAttribPointer(prog.a,2,gl.FLOAT,false,0,0);gl.bindTexture(prog.target,info.texture);gl.uniform1i(prog.uDepth,0);gl.uniformMatrix4fv(prog.uUv,false,info.normDepthBufferFromNormView.matrix);gl.uniform1f(prog.uScale,Number(info.rawValueToMeters)||1);gl.uniform1i(prog.uLayer,Number(info.imageIndex)||0);gl.drawArrays(gl.TRIANGLES,0,6);const rgba=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
      // Restore every state touched by the downsample pass before leaving the
      // XR animation frame; this prevents our sensor readback from changing the
      // compositor/projection rendering state on device-specific runtimes.
      gl.bindTexture(gl.TEXTURE_2D,state.tex2d);gl.bindTexture(gl.TEXTURE_2D_ARRAY,state.tex2da);gl.bindFramebuffer(gl.FRAMEBUFFER,state.fbo);gl.viewport(...state.viewport);gl.useProgram(state.program);gl.bindBuffer(gl.ARRAY_BUFFER,state.arrayBuffer);gl.bindVertexArray(state.vao);state.scissor?gl.enable(gl.SCISSOR_TEST):gl.disable(gl.SCISSOR_TEST);state.blend?gl.enable(gl.BLEND):gl.disable(gl.BLEND);state.depth?gl.enable(gl.DEPTH_TEST):gl.disable(gl.DEPTH_TEST);gl.colorMask(...state.colorMask);gl.activeTexture(state.active);this.failures=0;
      const depthMeters=new Float32Array(width*height);let valid=0;for(let i=0,j=0;i<rgba.length;i+=4,j++){if(!rgba[i+3])continue;const mm=rgba[i]*65536+rgba[i+1]*256+rgba[i+2];if(mm>80){depthMeters[j]=mm/1000;valid++;}}return {depthMeters,width,height,valid,sourceWidth:info.width||0,sourceHeight:info.height||0,rawValueToMeters:Number(info.rawValueToMeters)||1,textureType:info.textureType||'texture',imageIndex:info.imageIndex??null};
    }catch(error){this.failures++;this.diag?.error('gpu-depth-readback-failed',error,{failures:this.failures,dataFormat,textureType:info?.textureType});if(this.failures>=3)this.disabled=true;return null;}
  }
  dispose(){const gl=this.gl;try{for(const x of this.programCache.values()){gl.deleteBuffer(x.b);gl.deleteProgram(x.p);}if(this.outputTexture)gl.deleteTexture(this.outputTexture);if(this.fbo)gl.deleteFramebuffer(this.fbo);}catch{}this.programCache.clear();this.outputTexture=this.fbo=null;}
}

export class XRCaptureController {
  constructor({canvas,overlayCanvas,repository,diagnostics,session,segmentId,profile,audioCapture,chirpScheduler,markpointManager,callbacks={}}){this.canvas=canvas;this.overlay=new AdaptiveGridOverlay(overlayCanvas,{maxVisibleTiles:profile.maxVisibleTiles});this.repo=repository;this.diag=diagnostics;this.sessionRecord=session;this.sessionId=session.id;this.segmentId=segmentId||session.currentSegmentId||'segment-0';this.profile=profile;this.audio=audioCapture;this.chirps=chirpScheduler;this.markpoints=markpointManager;this.cb=callbacks;this.xrSession=null;this.refSpace=null;this.viewerSpace=null;this.hitTestSource=null;this.gl=null;this.binding=null;this.cameraReader=null;this.gpuDepthReader=null;this.mapWorker=null;this.motion=new PoseMotionTracker();this.frameSeq=0;this.depthSeq=0;this.poseChunk=[];this.hitChunk=[];this.activeTasks=new Set();this.lastPoseWrite=0;this.lastDepthSample=0;this.lastPhoto=0;this.lastSnapshot=0;this.lastGridPersist=0;this.gridTiles=[];this.gridStats={};this.coverage={red:0,yellow:0,green:0,deep:0,total:0,score:0};this.closing=false;this.ended=false;this.forcePhoto=false;this.markpointRequest=false;this.latestFrameContext=null;this.lastDepthCandidate=null;this._snapshotRequest=0;this._endPromise=null;this.depthMode='none';this.depthDataFormat=null;this.depthReadDisabled=false;this._depthModeLogged=false;this.lastRayRgb=0;this.frameCameraCapture=null;this.rawRayCount=0;this.tileMemory=new Map();this.photoRetained=[];this.lastPhotoPosition=null;this.lastPhotoForward=null;this.deepTileLastPhoto=new Map();this.lastHitCandidate=null;}
  static async compatibility(){const out={secureContext:globalThis.isSecureContext,indexedDB:!!globalThis.indexedDB,mediaDevices:!!navigator.mediaDevices?.getUserMedia,webXR:!!navigator.xr,immersiveAR:false,rawCamera:'optional',depthSensing:'optional',audioWorklet:!!globalThis.AudioWorkletNode,offscreenCanvas:!!globalThis.OffscreenCanvas,compressionStream:!!globalThis.CompressionStream};if(navigator.xr)try{out.immersiveAR=await navigator.xr.isSessionSupported('immersive-ar');}catch(e){out.xrError=e.message;}return out;}
  static requestImmersiveSession(domRoot=document.body){
    if(!navigator.xr)throw new Error('WebXR non disponibile');
    const options={requiredFeatures:['local-floor'],optionalFeatures:['depth-sensing','camera-access','hit-test','anchors','dom-overlay'],depthSensing:{usagePreference:['cpu-optimized','gpu-optimized'],dataFormatPreference:['float32','unsigned-short','luminance-alpha'],depthTypeRequest:['raw','smooth'],matchDepthView:true},domOverlay:{root:domRoot}};
    // This function contains no await before requestSession. Call it directly
    // from the user click handler to preserve transient user activation.
    return navigator.xr.requestSession('immersive-ar',options);
  }
  async start({xrSession=null}={}){
    if(!navigator.xr)throw new Error('WebXR non disponibile');this.mapWorker=new Worker(new URL('../workers/map_worker_v20_4_0.js',import.meta.url));this.mapWorker.onmessage=e=>this._onMapMessage(e.data);this.mapWorker.onerror=e=>this.diag.error('map-worker-error',e.error||new Error(e.message));this.mapWorker.postMessage({type:'init',sessionId:this.sessionId,budget:this.profile.mapBudgetCells});
    await this.diag.transition('XR_REQUESTING',{preRequested:!!xrSession});this.xrSession=xrSession||await XRCaptureController.requestImmersiveSession(document.body);this.xrSession.addEventListener('end',()=>this._onSessionEnd(),{once:true});
    this.gl=this.canvas.getContext('webgl2',{xrCompatible:true,alpha:true,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false,desynchronized:true});if(!this.gl)throw new Error('WebGL2 non disponibile');await this.gl.makeXRCompatible?.();const baseLayer=new XRWebGLLayer(this.xrSession,this.gl,{alpha:true,antialias:false,depth:false,stencil:false,framebufferScaleFactor:.72});this.xrSession.updateRenderState({baseLayer,depthNear:.08,depthFar:12});this.binding=new XRWebGLBinding(this.xrSession,this.gl);try{this.depthMode=this.xrSession.depthUsage||'none';this.depthDataFormat=this.xrSession.depthDataFormat||null;}catch{this.depthMode='none';this.depthDataFormat=null;}this.cameraReader=new RawCameraReader(this.gl,this.binding,{targetWidth:this.profile.cameraWidth,diagnostics:this.diag});this.gpuDepthReader=new GpuDepthReader(this.gl,{diagnostics:this.diag});this.refSpace=await this.xrSession.requestReferenceSpace('local-floor');
    try{this.viewerSpace=await this.xrSession.requestReferenceSpace('viewer');this.hitTestSource=await this.xrSession.requestHitTestSource({space:this.viewerSpace});}catch(e){await this.diag.error('hit-test-unavailable',e);}
    await this.repo.patchSession(this.sessionId,{status:'capturing',xr:{startedAt:Date.now(),enabledFeatures:Array.from(this.xrSession.enabledFeatures||[]),depthUsage:this.depthMode,depthDataFormat:this.depthDataFormat,environmentBlendMode:this.xrSession.environmentBlendMode||null}});await this.diag.transition('XR_CAPTURING',{enabledFeatures:Array.from(this.xrSession.enabledFeatures||[])});this.xrSession.requestAnimationFrame((t,f)=>this._onXRFrame(t,f));return this;
  }
  _trackTask(promise,label='task'){const p=Promise.resolve(promise).catch(e=>this.diag.error(`${label}-failed`,e)).finally(()=>this.activeTasks.delete(p));this.activeTasks.add(p);return p;}
  requestPhoto(reason='user'){this.forcePhoto=true;this.photoReason=reason;}
  requestMarkpoint(){this.markpointRequest=true;this.forcePhoto=true;this.photoReason='markpoint';}
  async requestSafeExit(reason='user'){
    if(this.closing||this.ended)return this._endPromise;this.closing=true;this._endPromise=new Promise(resolve=>this._resolveEnd=resolve);await this.diag.transition('XR_EXIT_REQUESTED',{reason,pendingWrites:this.repo.pendingCount()});this.chirps?.stop();
    // Flush only the small worklet tail. Existing PCM/JPEG/depth chunks are
    // already committed, so this path cannot create a full-session copy.
    if(this.activeTasks.size){const before=this.activeTasks.size;await Promise.race([Promise.allSettled([...this.activeTasks]),new Promise(r=>setTimeout(r,420))]);if(this.activeTasks.size)await this.diag.log('capture-tasks-left-running',{before,remaining:this.activeTasks.size},'warn');}
    try{await Promise.race([this.audio?.flush?.(),new Promise(r=>setTimeout(r,180))]);}catch(e){await this.diag.error('pre-exit-audio-flush-failed',e);}
    try{await Promise.all([this._flushPoseChunk(),this._flushHitChunk()]);}catch(e){await this.diag.error('pre-exit-small-record-flush-failed',e);}
    try{await this.repo.patchSession(this.sessionId,{status:'xr-ending',lastExitReason:reason});}catch(e){await this.diag.error('pre-exit-session-patch-failed',e);}
    try{await this.xrSession?.end();}catch(e){await this.diag.error('xr-end-call-failed',e);await this._onSessionEnd();}return this._endPromise;
  }
  _onXRFrame(time,frame){
    if(this.ended)return;const session=frame.session;if(!this.closing)session.requestAnimationFrame((t,f)=>this._onXRFrame(t,f));try{const pose=frame.getViewerPose(this.refSpace);if(!pose?.views?.length)return;const view=pose.views[0];this._prepareXRFramebuffer(view);const matrix=finiteArray(view.transform.matrix),viewMatrix=finiteArray(view.transform.inverse.matrix),projection=finiteArray(view.projectionMatrix),motion=this.motion.update(matrix,view.transform.orientation,time),cameraPosition=motion.position;this.latestFrameContext={time,frame,view,pose,matrix,viewMatrix,projection,cameraPosition,motion};
      this._recordPose(time,view,motion);if(!this.closing&&time-this.lastDepthSample>(this.profile.depthIntervalMs||105))this._sampleDepth(frame,view,time,motion);if(!this.closing)this._sampleHitTest(frame,time,motion);
      if(!this.closing&&time-this.lastSnapshot>720){this.lastSnapshot=time;this.mapWorker?.postMessage({type:'snapshot',requestId:++this._snapshotRequest,cameraPosition,maxCells:3400,radius:9});}
      const guidance=this.overlay.render({viewMatrix,projectionMatrix:projection,cameraPosition});if(guidance)this.cb.onGuidance?.(guidance);this.cb.onMotion?.(motion);
      if(!this.closing&&this._shouldTakePhoto(time,guidance))this._trackTask(this._capturePhotoInFrame(view,time,motion,guidance),'photo-capture');
      if(!this.closing)this.chirps?.maybeSchedule({pose:this._compactPose(view,time),linearSpeed:motion.linearSpeed,angularSpeed:motion.angularSpeed,quality:motion.stability}).catch(e=>this.diag.error('chirp-schedule-failed',e));
      this.cb.onTelemetry?.({points:this.gridStats.totalPoints||0,rays:this.rawRayCount||0,gaussians:this.gridStats.cells||0,frames:this.frameSeq,chirps:this.chirps?.sequence||0,pendingWrites:this.repo.pendingCount(),coverage:this.coverage});
    }catch(error){this.diag.error('xr-frame-error',error);}
  }
  _prepareXRFramebuffer(view){
    // Immersive AR relies on transparent pixels in the XR projection layer to
    // reveal the device passthrough. Some runtimes leave a freshly-created
    // framebuffer opaque/black until the page explicitly clears it. Always
    // initialize the current eye viewport with alpha=0 before drawing any XR
    // content; the DOM overlay remains separate and is composited by WebXR.
    const gl=this.gl,layer=this.xrSession?.renderState?.baseLayer;if(!gl||!layer)return;
    try{
      gl.bindFramebuffer(gl.FRAMEBUFFER,layer.framebuffer);
      const vp=layer.getViewport(view);if(vp)gl.viewport(vp.x,vp.y,vp.width,vp.height);
      gl.disable(gl.SCISSOR_TEST);gl.colorMask(true,true,true,true);
      gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    }catch(error){if(!this._xrFramebufferErrorLogged){this._xrFramebufferErrorLogged=true;this.diag.error('xr-framebuffer-prepare-failed',error);}}
  }
  _recordPose(time,view,motion){if(time-this.lastPoseWrite<90)return;this.lastPoseWrite=time;const rec=this._compactPose(view,time,motion);this.poseChunk.push(rec);if(this.poseChunk.length>=20)this._flushPoseChunk().catch(e=>this.diag.error('pose-write-failed',e));}
  _compactPose(view,time,motion=null){return {seq:this.poseChunk.length,segmentId:this.segmentId,timeXR:time,timeEpoch:Date.now(),position:cameraPositionFromMatrix(view.transform.matrix),orientation:{x:view.transform.orientation.x,y:view.transform.orientation.y,z:view.transform.orientation.z,w:view.transform.orientation.w},matrix:finiteArray(view.transform.matrix),projectionMatrix:finiteArray(view.projectionMatrix),linearSpeed:motion?.linearSpeed??this.motion.linearSpeed,angularSpeed:motion?.angularSpeed??this.motion.angularSpeed};}
  async _flushPoseChunk(){if(!this.poseChunk.length)return;const chunk=this.poseChunk.splice(0);const key=`${this.sessionId}/poses/${String(chunk[0].seq??Date.now()).padStart(8,'0')}-${Date.now()}`;await this.repo.enqueueRecord(this.sessionId,'pose-chunk',{poses:chunk},{key});this.sessionRecord.counts.poses+=chunk.length;}
  async _flushHitChunk(){if(!this.hitChunk.length)return;const chunk=this.hitChunk.splice(0);await this.repo.enqueueRecord(this.sessionId,'hit-test-chunk',{segmentId:this.segmentId,hits:chunk},{key:`${this.sessionId}/hit-tests/${Date.now()}`});}
  _sampleDepth(frame,view,time,motion){
    this.lastDepthSample=time;if(this.depthReadDisabled)return;if(this.repo.pendingCount()>Math.max(8,this.profile.maxPendingWrites*2)){if(!this._depthBackpressureLogged||time-this._depthBackpressureLogged>2500){this._depthBackpressureLogged=time;this.diag.log('dense-ray-backpressure',{pendingWrites:this.repo.pendingCount(),action:'skip-one-depth-batch'},'warn');}return;}
    let info=null,sampled=null,depthWidth=0,depthHeight=0,source='xr-depth-cpu',extraMeta={};
    try{
      if(this.depthMode==='cpu-optimized'&&typeof frame.getDepthInformation==='function'){
        info=frame.getDepthInformation(view);if(!info)return;depthWidth=info.width;depthHeight=info.height;sampled=sampleCPUDepthRays(info,view,{stride:this.profile.depthStride,maxPoints:this.profile.maxPointBatch,cameraPosition:motion.position,dataFormat:this.depthDataFormat});
      }else if(this.depthMode==='gpu-optimized'){
        info=this.binding?.getDepthInformation?.(view);if(!info)return;depthWidth=info.width;depthHeight=info.height;const gpu=this.gpuDepthReader?.read(info,{maxPoints:this.profile.maxPointBatch,dataFormat:this.depthDataFormat});if(!gpu?.valid)return;sampled=sampleGPUReadbackRays(gpu,view,{maxPoints:this.profile.maxPointBatch,cameraPosition:motion.position});source='xr-depth-gpu-rays';extraMeta={gpuReadback:{width:gpu.width,height:gpu.height,valid:gpu.valid,textureType:gpu.textureType,imageIndex:gpu.imageIndex}};
        if(!this._depthModeLogged){this._depthModeLogged=true;this.diag.log('xr-depth-gpu-dense-enabled',{depthUsage:this.depthMode,dataFormat:this.depthDataFormat,readback:`${gpu.width}x${gpu.height}`,native:`${depthWidth}x${depthHeight}`});}
      }else return;
    }catch(error){this.diag.error('xr-depth-sample-failed',error,{depthUsage:this.depthMode,dataFormat:this.depthDataFormat});return;}
    if(!sampled?.points?.length)return;
    const wantRgb=!!view.camera&&time-this.lastRayRgb>(this.profile.rayRgbIntervalMs||520)&&this.repo.pendingCount()<this.profile.maxPendingWrites;const colorPromise=wantRgb?this._cameraCaptureForFrame(view,time):null;if(wantRgb)this.lastRayRgb=time;
    // Copy XR-owned properties while the XRFrame is active. The async finish
    // below only sees plain numeric data and our own typed arrays.
    const rawValueToMeters=Number(info?.rawValueToMeters)||null,origin=motion.position.slice(),seq=this.depthSeq++,meta={sequence:seq,segmentId:this.segmentId,timeXR:time,timeEpoch:Date.now(),origin,viewKey:quantizedViewKey(origin,.08),count:sampled.samples.length,source,projectionMatrix:finiteArray(view.projectionMatrix),cameraMatrix:finiteArray(view.transform.matrix),depthWidth,depthHeight,rawValueToMeters,depthUsage:this.depthMode,depthDataFormat:this.depthDataFormat,rayFormat:'RSRY-1',stridePx:sampled.step,hasRgb:false,...extraMeta};
    const finish=async()=>{
      let capture=null;try{capture=colorPromise?await colorPromise:null;}catch(error){await this.diag.error('xr-ray-rgb-read-failed',error);}if(capture){colorizeDepthSamples(sampled,capture);meta.hasRgb=sampled.rgbCount>0;meta.rgbCount=sampled.rgbCount;}
      const rayBuffer=encodeRayBatch(sampled.samples,{depthWidth,depthHeight});await this.repo.enqueueBlob(this.sessionId,'depth-rays',new Blob([rayBuffer],{type:'application/x-roomscan-rays'}),meta,`${this.sessionId}/depth/rays-${String(seq).padStart(7,'0')}.rsry`);await this.repo.enqueueRecord(this.sessionId,'depth-meta',meta,{key:`${this.sessionId}/depth-meta/${String(seq).padStart(7,'0')}`});this.lastDepthCandidate=extractCenterDepthCandidate(sampled.points,motion.position);if(this.lastDepthCandidate)this.lastDepthCandidate.timeXR=time;this.rawRayCount+=sampled.samples.length;this.mapWorker?.postMessage({type:'depthBatch',buffer:sampled.points.buffer,viewOrigin:origin,viewKey:meta.viewKey,source:this.depthMode==='gpu-optimized'?'xr-depth-gpu':'xr-depth-cpu',time:Date.now(),frameId:null,rayCount:sampled.samples.length},[sampled.points.buffer]);this.sessionRecord.counts.depthBatches++;
    };this._trackTask(finish(),'dense-ray-batch');
  }
  _cameraCaptureForFrame(view,time){if(this.frameCameraCapture?.time===time)return this.frameCameraCapture.promise;const promise=this.cameraReader?.read(view)||Promise.resolve(null);this.frameCameraCapture={time,promise};return promise;}
  _sampleHitTest(frame,time,motion){if(!this.hitTestSource||time-(this.lastHitTime||0)<420)return;this.lastHitTime=time;try{const hit=frame.getHitTestResults(this.hitTestSource)?.[0];const pose=hit?.getPose(this.refSpace);if(!pose)return;const m=pose.transform.matrix,p=[m[12],m[13],m[14]],n=norm3([m[4],m[5],m[6]]),toCam=sub3(motion.position,p),nn=(n[0]*toCam[0]+n[1]*toCam[1]+n[2]*toCam[2])<0?scale3(n,-1):n;const a=new Float32Array([p[0],p[1],p[2],nn[0],nn[1],nn[2],145,145,145,.36]);this.lastHitCandidate={position:p.slice(),normal:nn.slice(),depthM:dist3(motion.position,p),time};this.hitChunk.push({segmentId:this.segmentId,timeXR:time,timeEpoch:Date.now(),position:p,normal:nn,cameraPosition:motion.position});if(this.hitChunk.length>=24)this._flushHitChunk().catch(e=>this.diag.error('hit-test-write-failed',e));this.mapWorker?.postMessage({type:'depthBatch',buffer:a.buffer,viewOrigin:motion.position,viewKey:quantizedViewKey(motion.position),source:'hit-test',time:Date.now()},[a.buffer]);}catch(e){if(!this._hitErrorLogged){this._hitErrorLogged=true;this.diag.error('hit-test-frame-failed',e);}}
  }
  _shouldTakePhoto(time,guidance){
    if(this.repo.pendingCount()>=this.profile.maxPendingWrites)return false;
    if(this.forcePhoto)return time-this.lastPhoto>320;
    if(time-this.lastPhoto<this.profile.minPhotoIntervalMs)return false;
    const ctx=this.latestFrameContext,position=ctx?.cameraPosition||this.motion.position,forward=ctx?.matrix?forwardFromMatrix(ctx.matrix):null;
    const moved=!this.lastPhotoPosition||dist3(position,this.lastPhotoPosition)>=(this.profile.photoNoveltyTranslationM||.16);
    const rotated=!this.lastPhotoForward||!forward||angle3(forward,this.lastPhotoForward)*180/Math.PI>=(this.profile.photoNoveltyRotationDeg||11);
    const tile=guidance&&this.gridTiles.find(t=>t.id===guidance.tileId),cooldown=this.profile.deepTileCooldownMs||4000,lastForTile=tile?this.deepTileLastPhoto.get(tile.id)||0:0;
    const needsDeep=!!(tile?.needDeep&&time-lastForTile>cooldown&&this.motion.stability>.10&&(moved||rotated));
    const periodic=time-this.lastPhoto>(this.profile.denseRgbIntervalMs||4300)&&(moved||rotated)&&this.motion.linearSpeed<1.25&&this.motion.angularSpeed<2.5;
    return needsDeep||periodic;
  }
  async _capturePhotoInFrame(view,time,motion,guidance){
    this.lastPhoto=time;const reason=this.photoReason||((guidance&&'grid-deep')||'auto');this.forcePhoto=false;this.photoReason=null;const capture=await this._cameraCaptureForFrame(view,time);if(!capture){await this.diag.log('photo-skipped',{reason,cause:'raw-camera-unavailable'},'warn');return;}const quality=imageQuality(capture.rgba,capture.width,capture.height),frameId=uid('frame'),seq=this.frameSeq++;const blob=await rgbaToJpegBlob(capture.rgba,capture.width,capture.height,.78);const linkedTiles=this._visibleTileLinks(view.transform.inverse.matrix,view.projectionMatrix,capture.width,capture.height);const meta={id:frameId,sequence:seq,sessionId:this.sessionId,segmentId:this.segmentId,timeXR:time,timeEpoch:Date.now(),reason,pose:this._compactPose(view,time,motion),image:{width:capture.width,height:capture.height,cameraWidth:capture.cameraWidth,cameraHeight:capture.cameraHeight,mime:'image/jpeg',size:blob.size},quality,linkedTiles,metricAnchors:this.lastDepthCandidate?[this.lastDepthCandidate]:[],markpointCandidate:false};
    const blobKey=await this.repo.enqueueBlob(this.sessionId,'frame-jpeg',blob,meta,`${this.sessionId}/frames/${String(seq).padStart(7,'0')}-${frameId}.jpg`);const recordKey=await this.repo.enqueueRecord(this.sessionId,'frame-meta',meta,{key:`${this.sessionId}/frame-meta/${String(seq).padStart(7,'0')}`});this.mapWorker?.postMessage({type:'photoEvidence',frameId,sharpness:quality.sharpness,exposure:quality.exposureScore,hits:linkedTiles.map(t=>({key:t.tileId,uv:t.uv,rgb:sampleRgbAtUv(capture.rgba,capture.width,capture.height,t.uv)}))});this.sessionRecord.counts.frames++;this.lastPhotoPosition=motion.position.slice();this.lastPhotoForward=forwardFromMatrix(meta.pose.matrix);for(const t of linkedTiles)if(t.needDeep)this.deepTileLastPhoto.set(t.tileId,time);this.photoRetained.push({frameId,blobKey,recordKey,reason,score:frameRetentionScore(meta),time:Date.now()});if(this.photoRetained.length%(this.profile.photoCleanupEvery||64)===0)this._trackTask(this._prunePhotoStore(),'photo-prune');
    if(reason==='markpoint'||this.markpointRequest){this.markpointRequest=false;const pinAnchor=(this.lastDepthCandidate&&time-(this.lastDepthCandidate.timeXR||time)<1800)?this.lastDepthCandidate:((this.lastHitCandidate&&time-this.lastHitCandidate.time<1800)?this.lastHitCandidate:null);const candidate=buildMarkpointCandidate(capture,pinAnchor,meta);this.cb.onMarkpointCandidate?.(candidate);}
    // Re-observe accepted markpoints in ordinary keyframes. This creates real
    // multi-view evidence instead of trusting a single user tap.
    if(this.markpoints?.points?.length){const observations=[];for(const point of this.markpoints.points){if(point.segmentId!==this.segmentId)continue;const screen=projectWorldPoint(point.position,view.transform.inverse.matrix,view.projectionMatrix,capture.width,capture.height);if(!screen?.inside||screen.x<12||screen.y<12||screen.x>capture.width-12||screen.y>capture.height-12)continue;observations.push({markpointId:point.id,descriptor:computePatchDescriptor(capture.rgba,capture.width,capture.height,screen.x,screen.y,10),referenceCameraPosition:point.referenceCameraPosition});}if(observations.length)this.markpoints.observeFrame({frameId,cameraPosition:motion.position,projectedPatches:observations}).then(updates=>{if(updates.some(p=>p.status==='valid'))this.cb.onMarkpointValidated?.(updates);}).catch(e=>this.diag.error('markpoint-observation-failed',e));}
    this.cb.onPhoto?.(meta);await this.diag.log('frame-saved',{frameId,seq,size:blob.size,reason,quality,linkedTiles:linkedTiles.length});
    // Release the large RGBA array at the end of this task; only Blob and small
    // descriptors survive. This is essential on memory-constrained phones.
  }
  _visibleTileLinks(viewMatrix,projection,width,height){const links=[];for(const t of this.gridTiles){const p=projectWorldPoint(t.center,viewMatrix,projection,width,height);if(p?.inside)links.push({tileId:t.id,uv:[p.x/width,p.y/height],status:t.status,needDeep:t.needDeep});if(links.length>=180)break;}return links;}
  _mergeGridTiles(incoming){
    const now=Date.now();for(const t of incoming){this.tileMemory.set(t.id,{...t,_overlaySeen:now});}
    // Keep real/confirmed cells visible long enough to communicate convergence.
    // Predicted targets are short-lived so they cannot flood the HUD forever.
    for(const [id,t] of this.tileMemory){const ttl=t.predicted?9000:(t.status==='green'?90000:45000);if(now-(t._overlaySeen||now)>ttl)this.tileMemory.delete(id);}
    let out=[...this.tileMemory.values()];if(out.length>4200){out.sort((a,b)=>(b.status==='green'?1:0)-(a.status==='green'?1:0)||(b.gaussian?.confirmed?1:0)-(a.gaussian?.confirmed?1:0)||(b.lastSeen||0)-(a.lastSeen||0));out=out.slice(0,4200);this.tileMemory=new Map(out.map(t=>[t.id,t]));}
    return out;
  }
  async _prunePhotoStore(){
    const cap=this.profile.maxRetainedPhotos||420;if(this.photoRetained.length<=cap)return;
    const protectedItems=this.photoRetained.filter(f=>/manual|markpoint/i.test(f.reason||''));const candidates=this.photoRetained.filter(f=>!/manual|markpoint/i.test(f.reason||''));
    candidates.sort((a,b)=>b.score-a.score||b.time-a.time);const keepAuto=Math.max(0,cap-protectedItems.length),keep=new Set([...protectedItems,...candidates.slice(0,keepAuto)].map(f=>f.frameId)),remove=this.photoRetained.filter(f=>!keep.has(f.frameId));
    // Delete in small chunks to keep IndexedDB transactions short during XR.
    for(const f of remove.slice(0,Math.max(8,Math.min(48,remove.length)))){try{await this.repo.deleteBlobKey(f.blobKey);await this.repo.deleteRecordKey(f.recordKey);this.sessionRecord.counts.frames=Math.max(0,(this.sessionRecord.counts.frames||1)-1);}catch(error){await this.diag.error('photo-prune-failed',error,{frameId:f.frameId});}}
    const removedIds=new Set(remove.slice(0,Math.max(8,Math.min(48,remove.length))).map(f=>f.frameId));this.photoRetained=this.photoRetained.filter(f=>!removedIds.has(f.frameId));await this.diag.log('photo-prune',{retained:this.photoRetained.length,cap,removed:removedIds.size});
  }
  _onMapMessage(m){if(m.type==='snapshot'){if(m.requestId&&m.requestId<this._lastSnapshotAccepted)return;this._lastSnapshotAccepted=m.requestId||0;this.gridTiles=this._mergeGridTiles(m.tiles||[]);this.gridStats=m.stats||{};this.coverage=summarizeCoverage(this.gridTiles);this.overlay.setTiles(this.gridTiles);this.cb.onCoverage?.(this.coverage,this.gridTiles);const now=performance.now();if(now-this.lastGridPersist>this.profile.gridSnapshotIntervalMs){this.lastGridPersist=now;const compact={time:Date.now(),segmentId:this.segmentId,stats:this.gridStats,coverage:this.coverage,tiles:this.gridTiles};this.repo.enqueueRecord(this.sessionId,'grid-snapshot',compact,{key:`${this.sessionId}/grid-snapshot/${Date.now()}`}).catch(e=>this.diag.error('grid-snapshot-write-failed',e));this.sessionRecord.counts.gridSnapshots++;}}else if(m.type==='stats'){this.gridStats=m;}else if(m.type==='error')this.diag.error('map-worker-message-error',new Error(m.message),{stack:m.stack});}
  async _onSessionEnd(){
    if(this.ended)return;this.ended=true;const reason=this.closing?'requested':'unexpected';await this.diag.transition('XR_ENDED',{reason,pendingWrites:this.repo.pendingCount()});
    // The order below is deliberately small and deterministic. No worker for
    // Deep, plane fitting, ZIP creation or model reconstruction is started.
    try{this.hitTestSource?.cancel?.();}catch{}this.hitTestSource=null;try{this.cameraReader?.dispose();}catch{}this.cameraReader=null;try{this.gpuDepthReader?.dispose();}catch{}this.gpuDepthReader=null;try{this.gl?.getExtension('WEBGL_lose_context')?.loseContext();}catch{}this.canvas.width=this.canvas.height=1;this.overlay.clear();try{this.mapWorker?.terminate();}catch{}this.mapWorker=null;
    try{await this.audio?.stop?.({timeoutMs:520});}catch(e){await this.diag.error('audio-stop-after-xr-failed',e);}const drain=await this.repo.drain(1700);try{await this.repo.patchSession(this.sessionId,{status:reason==='requested'?'captured':'interrupted',flags:{xrEnded:true},xr:{endedAt:Date.now(),endReason:reason},counts:this.sessionRecord.counts,writeDrain:drain});}catch(e){await this.diag.error('final-session-patch-failed',e);}
    await this.diag.memory('after-xr-release');await this.diag.transition('CAPTURE_SAVED',{drain});this.cb.onEnded?.({reason,drain,sessionId:this.sessionId});this._resolveEnd?.({reason,drain});
  }
}

export function sampleCPUDepthRays(info,view,{stride=6,maxPoints=6200,cameraPosition=[0,0,0],dataFormat='float32'}={}){
  const w=info.width,h=info.height,invProj=invert4(view.projectionMatrix);if(!invProj||!w||!h)return {points:new Float32Array(0),samples:[],step:stride,rgbCount:0};const world=view.transform.matrix,depthTransform=info.normDepthBufferFromNormView?.matrix||null;
  let raw=null;try{if(info.data){if(dataFormat==='float32')raw=new Float32Array(info.data);else raw=new Uint16Array(info.data);}}catch{}
  const rawScale=Number(info.rawValueToMeters)||1;
  const depthAt=(u,v)=>{if(u<0||v<0||u>1||v>1)return NaN;let du=u,dv=v;if(depthTransform){const q=transformPoint4(depthTransform,[u,v,0]);du=q[0];dv=q[1];}if(du<0||dv<0||du>1||dv>1)return NaN;const x=clamp(Math.floor(du*w),0,w-1),y=clamp(Math.floor(dv*h),0,h-1);if(raw){const z=raw[y*w+x]*rawScale;return Number.isFinite(z)?z:NaN;}if(typeof info.getDepthInMeters==='function'){try{return info.getDepthInMeters(u,v);}catch{return NaN;}}return NaN;};
  const worldAt=(u,v)=>{const depth=depthAt(u,v);if(!Number.isFinite(depth)||depth<.10||depth>12)return null;const far=transformPoint4(invProj,[u*2-1,1-v*2,1]),ray=norm3(far);if(ray[2]>=-.001)return null;const k=depth/(-ray[2]),cam=[ray[0]*k,ray[1]*k,ray[2]*k];return {position:transformPoint4(world,cam),depthM:depth};};
  const nominal=Math.max(2,Math.floor(stride)),capacity=Math.max(64,maxPoints|0),adaptive=Math.max(nominal,Math.ceil(Math.sqrt((w*h)/capacity))),step=Math.max(2,adaptive),samples=[],records=[];let count=0;
  const du=Math.max(1,Math.floor(step*.72))/w,dv=Math.max(1,Math.floor(step*.72))/h;
  for(let y=Math.floor(step/2);y<h&&count<capacity;y+=step)for(let x=Math.floor(step/2);x<w&&count<capacity;x+=step){const u=(x+.5)/w,v=(y+.5)/h,c=worldAt(u,v);if(!c)continue;const px=worldAt(Math.min(.999999,u+du),v),py=worldAt(u,Math.min(.999999,v+dv));let normal=[0,0,0],local=.55;if(px&&py){const dx=sub3(px.position,c.position),dy=sub3(py.position,c.position),jump=Math.max(Math.abs(px.depthM-c.depthM),Math.abs(py.depthM-c.depthM)),tol=.035+.024*c.depthM;if(jump<tol){normal=norm3(cross3(dx,dy));if(dot(normal,sub3(cameraPosition,c.position))<0)normal=scale3(normal,-1);local=clamp(1-jump/tol,.35,1);}else local=.22;}if(len3(normal)<.5)normal=norm3(sub3(cameraPosition,c.position));const confidence=clamp((1-c.depthM/14)*(.45+.55*local),.10,1),sample={u,v,depthM:c.depthM,normal,rgb:[145,145,145],confidence,hasRgb:false,pointIndex:count};samples.push(sample);records.push(c.position[0],c.position[1],c.position[2],normal[0],normal[1],normal[2],145,145,145,confidence);count++;}
  return {points:new Float32Array(records),samples,step,rgbCount:0};
}

export function sampleGPUReadbackRays(gpu,view,{maxPoints=6200,cameraPosition=[0,0,0]}={}){
  const w=gpu.width,h=gpu.height,depth=gpu.depthMeters,invProj=invert4(view.projectionMatrix);if(!invProj||!w||!h||!depth?.length)return {points:new Float32Array(0),samples:[],step:1,rgbCount:0};const world=view.transform.matrix,capacity=Math.max(64,maxPoints|0),step=Math.max(1,Math.ceil(Math.sqrt((w*h)/capacity))),samples=[],records=[];let count=0;
  const at=(x,y)=>{if(x<0||x>=w||y<0||y>=h)return null;const z=depth[y*w+x];if(!Number.isFinite(z)||z<.10||z>12)return null;const u=(x+.5)/w,v=1-(y+.5)/h,far=transformPoint4(invProj,[u*2-1,1-v*2,1]),ray=norm3(far);if(ray[2]>=-.001)return null;const k=z/(-ray[2]);return {u,v,depthM:z,position:transformPoint4(world,[ray[0]*k,ray[1]*k,ray[2]*k])};};
  for(let y=Math.floor(step/2);y<h&&count<capacity;y+=step)for(let x=Math.floor(step/2);x<w&&count<capacity;x+=step){const c=at(x,y);if(!c)continue;const px=at(Math.min(w-1,x+Math.max(1,step)),y),py=at(x,Math.min(h-1,y+Math.max(1,step)));let normal=[0,0,0],local=.52;if(px&&py){const dx=sub3(px.position,c.position),dy=sub3(py.position,c.position),jump=Math.max(Math.abs(px.depthM-c.depthM),Math.abs(py.depthM-c.depthM)),tol=.040+.026*c.depthM;if(jump<tol){normal=norm3(cross3(dx,dy));if(dot(normal,sub3(cameraPosition,c.position))<0)normal=scale3(normal,-1);local=clamp(1-jump/tol,.34,1);}else local=.20;}if(len3(normal)<.5)normal=norm3(sub3(cameraPosition,c.position));const confidence=clamp((1-c.depthM/14)*(.42+.58*local),.10,1),sample={u:c.u,v:c.v,depthM:c.depthM,normal,rgb:[145,145,145],confidence,hasRgb:false,pointIndex:count};samples.push(sample);records.push(c.position[0],c.position[1],c.position[2],normal[0],normal[1],normal[2],145,145,145,confidence);count++;}
  return {points:new Float32Array(records),samples,step,rgbCount:0};
}
function colorizeDepthSamples(sampled,capture){if(!capture?.rgba?.length)return sampled;let rgbCount=0;for(const s of sampled.samples){const rgb=sampleRgbAtUv(capture.rgba,capture.width,capture.height,[s.u,s.v]);if(!rgb)continue;s.rgb=rgb;s.hasRgb=true;const p=s.pointIndex*10;sampled.points[p+6]=rgb[0];sampled.points[p+7]=rgb[1];sampled.points[p+8]=rgb[2];rgbCount++;}sampled.rgbCount=rgbCount;return sampled;}
function extractCenterDepthCandidate(points,camera){if(!points.length)return null;let best=null,bestAngle=Infinity;const forward=[0,0,-1];for(let i=0;i<points.length;i+=10){const p=[points[i],points[i+1],points[i+2]],dir=norm3(sub3(p,camera)),a=Math.acos(clamp(-dir[2],-1,1));if(a<bestAngle){bestAngle=a;best={position:p,normal:[points[i+3],points[i+4],points[i+5]],depthM:dist3(p,camera),confidence:points[i+9]};}}return best;}
function buildMarkpointCandidate(capture,depthCandidate,meta){const cx=Math.floor(capture.width/2),cy=Math.floor(capture.height/2),depthSamples=depthCandidate?[depthCandidate.depthM]:[];return {frameId:meta.id,position:depthCandidate?.position||meta.pose.position.map((v,i)=>v+(i===2?-1:0)),normal:depthCandidate?.normal||[0,0,1],depthSamples,rgba:capture.rgba,width:capture.width,height:capture.height,cx,cy,pose:meta.pose};}
function frameRetentionScore(meta){const q=meta.quality||{},links=meta.linkedTiles||[],unresolved=links.filter(t=>t.status!=='green').length,deep=links.filter(t=>t.needDeep).length;return .55*(q.sharpness||0)+.35*(q.exposureScore||0)+.018*Math.min(30,unresolved)+.028*Math.min(20,deep)+(/manual|markpoint/i.test(meta.reason||'')?10:0);}
function imageQuality(rgba,w,h){let sum=0,sum2=0,clip=0,edges=0,n=0;for(let y=2;y<h-2;y+=4)for(let x=2;x<w-2;x+=4){const i=(y*w+x)*4,l=(.2126*rgba[i]+.7152*rgba[i+1]+.0722*rgba[i+2])/255;sum+=l;sum2+=l*l;if(l<.03||l>.97)clip++;const ir=(y*w+x+2)*4,id=((y+2)*w+x)*4,lr=(.2126*rgba[ir]+.7152*rgba[ir+1]+.0722*rgba[ir+2])/255,ld=(.2126*rgba[id]+.7152*rgba[id+1]+.0722*rgba[id+2])/255;edges+=Math.abs(lr-l)+Math.abs(ld-l);n++;}const mean=sum/Math.max(1,n),std=Math.sqrt(Math.max(0,sum2/Math.max(1,n)-mean*mean));return {meanLuma:mean,contrast:std,clippedFraction:clip/Math.max(1,n),sharpness:clamp(edges/Math.max(1,n)/.18,0,1),exposureScore:clamp(1-Math.abs(mean-.5)*1.7-clip/Math.max(1,n)*2,0,1)};}
async function rgbaToJpegBlob(rgba,w,h,quality){const canvas=globalThis.OffscreenCanvas?new OffscreenCanvas(w,h):document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d',{alpha:false});ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer,rgba.byteOffset,rgba.byteLength),w,h),0,0);if(canvas.convertToBlob)return canvas.convertToBlob({type:'image/jpeg',quality});return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('JPEG encoding fallito')),'image/jpeg',quality));}
function flipRows(src,w,h){const out=new Uint8Array(src.length),row=w*4;for(let y=0;y<h;y++)out.set(src.subarray((h-1-y)*row,(h-y)*row),y*row);return out;}

function sampleRgbAtUv(rgba,w,h,uv){
  // Tiny 3x3 median-like average: enough to color a Gaussian without keeping
  // the full raw camera frame alive in the online map worker.
  if(!uv||!rgba?.length)return null;const cx=Math.max(1,Math.min(w-2,Math.round(uv[0]*(w-1)))),cy=Math.max(1,Math.min(h-2,Math.round(uv[1]*(h-1)))),sum=[0,0,0];let n=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const i=((cy+dy)*w+(cx+dx))*4;sum[0]+=rgba[i];sum[1]+=rgba[i+1];sum[2]+=rgba[i+2];n++;}return sum.map(v=>Math.round(v/n));
}
function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
