/*
 * Room Scanner V20.4.2 - lightweight 3D model preview.
 *
 * Goals:
 * - never depend on Three.js or another network resource;
 * - render the dense RGB evidence (surfels / point Gaussians) first;
 * - render structural surfaces as a secondary derived layer;
 * - auto-fit the camera even when the model is sparse or oddly oriented;
 * - remain usable on a phone (bounded draw count, orbit/pinch controls);
 * - degrade to a CPU canvas preview if WebGL is unavailable.
 */

const DEFAULT_MAX_POINTS = 180000;
const DEFAULT_POINT_SIZE = 2.2;

export class ModelPreview3D {
  constructor(canvas, { statusElement = null, maxPoints = DEFAULT_MAX_POINTS } = {}) {
    this.canvas = canvas;
    this.statusElement = statusElement;
    this.maxPoints = Math.max(2000, maxPoints | 0);
    this.model = null;
    this.data = null;
    this.yaw = Math.PI * 0.23;
    this.pitch = -Math.PI * 0.18;
    this.distance = 4;
    this.target = [0, 1, 0];
    this.radius = 2;
    this.pointSize = DEFAULT_POINT_SIZE;
    this.showPoints = true;
    this.showSurfaces = true;
    this.showObjects = true;
    this.pointer = new Map();
    this.dragState = null;
    this.raf = 0;
    this.gl = this._createGL();
    this.fallback2d = !this.gl ? canvas.getContext('2d', { alpha: false }) : null;
    if (this.gl) this._initGL();
    this._bindInteraction();
    if (globalThis.ResizeObserver) { this._resizeObserver = new ResizeObserver(() => this.requestRender()); this._resizeObserver.observe(canvas); }
    else { this._resizeHandler=()=>this.requestRender(); globalThis.addEventListener?.('resize',this._resizeHandler); }
    this._setStatus(this.gl ? 'Viewer 3D pronto.' : 'WebGL non disponibile: fallback 2D attivo.');
  }

  dispose() {
    this._resizeObserver?.disconnect(); if(this._resizeHandler)globalThis.removeEventListener?.('resize',this._resizeHandler);
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (!this.gl) return;
    const gl = this.gl;
    for (const key of ['pointBuffer', 'pointColorBuffer', 'lineBuffer', 'surfaceBuffer', 'surfaceColorBuffer', 'objectLineBuffer', 'objectSurfaceBuffer', 'objectSurfaceColorBuffer']) {
      const b = this[key]; if (b) gl.deleteBuffer(b);
    }
    for (const p of [this.pointProgram, this.lineProgram, this.surfaceProgram]) if (p) gl.deleteProgram(p);
  }

  setModel(model) {
    this.model = model || null;
    this.data = buildPreviewData(model, this.maxPoints);
    if (!this.data.positions.length && !this.data.lines.length && !this.data.surfaces.length) {
      this._setStatus('Il modello non contiene ancora geometria visualizzabile.');
      this._clear();
      return;
    }
    const { center, radius } = this.data.bounds;
    this.target = center.slice();
    this.radius = Math.max(0.35, radius);
    this.distance = Math.max(0.8, this.radius * 2.25);
    this.yaw = Math.PI * 0.23;
    this.pitch = -Math.PI * 0.16;
    if (this.gl) this._upload();
    this._setStatus(`${this.data.pointCount.toLocaleString('it-IT')} punti RGB · ${this.data.surfaceCount} superfici · ${this.data.objectCount} oggetti`);
    this.requestRender();
  }

  resetView() {
    if (!this.data) return;
    this.target = this.data.bounds.center.slice();
    this.radius = Math.max(0.35, this.data.bounds.radius);
    this.distance = Math.max(0.8, this.radius * 2.25);
    this.yaw = Math.PI * 0.23;
    this.pitch = -Math.PI * 0.16;
    this.requestRender();
  }

  setPointSize(value) {
    const n = Number(value);
    if (Number.isFinite(n)) this.pointSize = Math.max(1, Math.min(8, n));
    this.requestRender();
  }

  setLayer(name, enabled) {
    if (name === 'points') this.showPoints = !!enabled;
    else if (name === 'surfaces') this.showSurfaces = !!enabled;
    else if (name === 'objects') this.showObjects = !!enabled;
    this.requestRender();
  }

  requestRender() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); });
  }

  render() {
    if (!this.data) { this._clear(); return; }
    if (!this.gl) { this._renderFallback2D(); return; }
    const gl = this.gl;
    const { width, height } = resizeCanvasToDisplaySize(this.canvas, 2);
    if (width < 2 || height < 2) return;
    gl.viewport(0, 0, width, height);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0.018, 0.035, 0.043, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = width / Math.max(1, height);
    const eye = orbitEye(this.target, this.distance, this.yaw, this.pitch);
    const view = lookAt(eye, this.target, [0, 1, 0]);
    const near = Math.max(0.02, this.distance - this.radius * 2.2);
    const far = Math.max(30, this.distance + this.radius * 6 + 10);
    const proj = perspective(Math.PI / 3.25, aspect, near, far);
    const mvp = multiply4(proj, view);

    if (this.showSurfaces && this.surfaceVertexCount) {
      gl.useProgram(this.surfaceProgram);
      gl.uniformMatrix4fv(this.surfaceLoc.mvp, false, mvp);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.surfaceBuffer);
      gl.enableVertexAttribArray(this.surfaceLoc.position);
      gl.vertexAttribPointer(this.surfaceLoc.position, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.surfaceColorBuffer);
      gl.enableVertexAttribArray(this.surfaceLoc.color);
      gl.vertexAttribPointer(this.surfaceLoc.color, 4, gl.FLOAT, false, 0, 0);
      gl.depthMask(false);
      gl.drawArrays(gl.TRIANGLES, 0, this.surfaceVertexCount);
      gl.depthMask(true);
    }

    if (this.showPoints && this.pointVertexCount) {
      gl.useProgram(this.pointProgram);
      gl.uniformMatrix4fv(this.pointLoc.mvp, false, mvp);
      gl.uniform1f(this.pointLoc.pointSize, this.pointSize * Math.min(2, globalThis.devicePixelRatio || 1));
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuffer);
      gl.enableVertexAttribArray(this.pointLoc.position);
      gl.vertexAttribPointer(this.pointLoc.position, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pointColorBuffer);
      gl.enableVertexAttribArray(this.pointLoc.color);
      gl.vertexAttribPointer(this.pointLoc.color, 4, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.POINTS, 0, this.pointVertexCount);
    }

    if (this.lineVertexCount) {
      gl.useProgram(this.lineProgram);
      gl.uniformMatrix4fv(this.lineLoc.mvp, false, mvp);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
      gl.enableVertexAttribArray(this.lineLoc.position);
      gl.vertexAttribPointer(this.lineLoc.position, 3, gl.FLOAT, false, 0, 0);
      gl.uniform4f(this.lineLoc.color, 0.48, 0.88, 0.79, 0.82);
      gl.drawArrays(gl.LINES, 0, this.lineVertexCount);
    }

    if (this.showObjects && this.objectSurfaceVertexCount) {
      gl.useProgram(this.surfaceProgram);
      gl.uniformMatrix4fv(this.surfaceLoc.mvp, false, mvp);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.objectSurfaceBuffer);
      gl.enableVertexAttribArray(this.surfaceLoc.position);
      gl.vertexAttribPointer(this.surfaceLoc.position, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.objectSurfaceColorBuffer);
      gl.enableVertexAttribArray(this.surfaceLoc.color);
      gl.vertexAttribPointer(this.surfaceLoc.color, 4, gl.FLOAT, false, 0, 0);
      gl.depthMask(false); gl.drawArrays(gl.TRIANGLES, 0, this.objectSurfaceVertexCount); gl.depthMask(true);
    }
    if (this.showObjects && this.objectLineVertexCount) {
      gl.useProgram(this.lineProgram);
      gl.uniformMatrix4fv(this.lineLoc.mvp, false, mvp);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.objectLineBuffer);
      gl.enableVertexAttribArray(this.lineLoc.position);
      gl.vertexAttribPointer(this.lineLoc.position, 3, gl.FLOAT, false, 0, 0);
      gl.uniform4f(this.lineLoc.color, 1.0, .78, .27, .9);
      gl.drawArrays(gl.LINES, 0, this.objectLineVertexCount);
    }
  }

  _createGL() {
    // WebGL 1 is sufficient for this viewer and has the widest Android support.
    return this.canvas.getContext('webgl', { alpha: false, antialias: true, depth: true, powerPreference: 'high-performance' }) ||
      this.canvas.getContext('experimental-webgl', { alpha: false, antialias: true, depth: true });
  }

  _initGL() {
    const gl = this.gl;
    this.pointProgram = program(gl, POINT_VS, POINT_FS);
    this.lineProgram = program(gl, LINE_VS, LINE_FS);
    this.surfaceProgram = program(gl, SURFACE_VS, SURFACE_FS);
    this.pointLoc = {
      position: gl.getAttribLocation(this.pointProgram, 'a_position'),
      color: gl.getAttribLocation(this.pointProgram, 'a_color'),
      mvp: gl.getUniformLocation(this.pointProgram, 'u_mvp'),
      pointSize: gl.getUniformLocation(this.pointProgram, 'u_pointSize')
    };
    this.lineLoc = {
      position: gl.getAttribLocation(this.lineProgram, 'a_position'),
      mvp: gl.getUniformLocation(this.lineProgram, 'u_mvp'),
      color: gl.getUniformLocation(this.lineProgram, 'u_color')
    };
    this.surfaceLoc = {
      position: gl.getAttribLocation(this.surfaceProgram, 'a_position'),
      color: gl.getAttribLocation(this.surfaceProgram, 'a_color'),
      mvp: gl.getUniformLocation(this.surfaceProgram, 'u_mvp')
    };
    this.pointBuffer = gl.createBuffer();
    this.pointColorBuffer = gl.createBuffer();
    this.lineBuffer = gl.createBuffer();
    this.surfaceBuffer = gl.createBuffer();
    this.surfaceColorBuffer = gl.createBuffer();
    this.objectLineBuffer = gl.createBuffer();
    this.objectSurfaceBuffer = gl.createBuffer();
    this.objectSurfaceColorBuffer = gl.createBuffer();
  }

  _upload() {
    const gl = this.gl, d = this.data;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(d.positions), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(d.colors), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(d.lines), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.surfaceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(d.surfaces), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.surfaceColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(d.surfaceColors), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.objectLineBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(d.objectLines), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.objectSurfaceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(d.objectSurfaces), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.objectSurfaceColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(d.objectSurfaceColors), gl.STATIC_DRAW);
    this.pointVertexCount = d.positions.length / 3;
    this.lineVertexCount = d.lines.length / 3;
    this.surfaceVertexCount = d.surfaces.length / 3;
    this.objectLineVertexCount = d.objectLines.length / 3;
    this.objectSurfaceVertexCount = d.objectSurfaces.length / 3;
  }

  _bindInteraction() {
    const c = this.canvas;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture?.(e.pointerId);
      this.pointer.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointer.size === 1) this.dragState = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch };
      else if (this.pointer.size === 2) this._pinchStart = pinchState(this.pointer, this.distance);
    });
    c.addEventListener('pointermove', e => {
      if (!this.pointer.has(e.pointerId)) return;
      this.pointer.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointer.size === 1 && this.dragState) {
        const dx = e.clientX - this.dragState.x, dy = e.clientY - this.dragState.y;
        this.yaw = this.dragState.yaw - dx * 0.008;
        this.pitch = clamp(this.dragState.pitch - dy * 0.008, -1.48, 1.48);
        this.requestRender();
      } else if (this.pointer.size === 2 && this._pinchStart) {
        const now = pinchState(this.pointer, this.distance);
        if (now.span > 2) this.distance = clamp(this._pinchStart.distance * this._pinchStart.span / now.span, this.radius * 0.22, this.radius * 12 + 2);
        this.requestRender();
      }
    });
    const end = e => {
      this.pointer.delete(e.pointerId);
      if (this.pointer.size === 1) {
        const p = [...this.pointer.values()][0];
        this.dragState = { x: p.x, y: p.y, yaw: this.yaw, pitch: this.pitch };
      } else this.dragState = null;
      if (this.pointer.size !== 2) this._pinchStart = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', e => {
      e.preventDefault();
      this.distance = clamp(this.distance * Math.exp(e.deltaY * 0.0012), this.radius * 0.22, this.radius * 12 + 2);
      this.requestRender();
    }, { passive: false });
    c.addEventListener('dblclick', () => this.resetView());
  }

  _renderFallback2D() {
    const ctx = this.fallback2d;
    const { cssWidth: w, cssHeight: h } = resizeCanvasToDisplaySize2D(this.canvas, 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#050b0d'; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const sx = this.canvas.width / Math.max(1, w), sy = this.canvas.height / Math.max(1, h);
    ctx.scale(sx, sy);
    const eye = orbitEye(this.target, this.distance, this.yaw, this.pitch);
    const view = lookAt(eye, this.target, [0, 1, 0]);
    const proj = perspective(Math.PI / 3.25, w / Math.max(1, h), 0.02, Math.max(30, this.distance + this.radius * 6 + 10));
    const mvp = multiply4(proj, view);
    const pos = this.data.positions, col = this.data.colors, step = Math.max(1, Math.floor((pos.length / 3) / 30000));
    for (let i = 0; i < pos.length / 3; i += step) {
      const p = projectMVP([pos[i*3], pos[i*3+1], pos[i*3+2]], mvp, w, h); if (!p || p.z < -1 || p.z > 1) continue;
      const j = i * 4; ctx.fillStyle = `rgba(${Math.round(col[j]*255)},${Math.round(col[j+1]*255)},${Math.round(col[j+2]*255)},${Math.max(.2,col[j+3])})`;
      ctx.fillRect(p.x, p.y, 2, 2);
    }
  }

  _clear() {
    if (this.gl) {
      const gl = this.gl; const { width, height } = resizeCanvasToDisplaySize(this.canvas, 2); gl.viewport(0,0,width,height); gl.clearColor(.018,.035,.043,1); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    } else if (this.fallback2d) {
      const { cssWidth:w, cssHeight:h }=resizeCanvasToDisplaySize2D(this.canvas,2); this.fallback2d.fillStyle='#050b0d'; this.fallback2d.fillRect(0,0,w,h);
    }
  }

  _setStatus(text) { if (this.statusElement) this.statusElement.textContent = text; }
}

export function buildPreviewData(model, maxPoints = DEFAULT_MAX_POINTS) {
  const g = model?.geometry || {};
  // Never spread a dense 100k-300k point array into push(...): on mobile that
  // can exceed the JS argument limit before the viewer even draws a frame.
  let all = Array.isArray(g.surfels) ? g.surfels :
    (Array.isArray(g.pointGaussians) ? g.pointGaussians :
      (Array.isArray(g.gaussians) ? g.gaussians : null));

  // If the dense evidence was trimmed out of a legacy model, object point clouds
  // still provide meaningful geometry for the preview.
  if (!all || !all.length) {
    const fallback=[]; for (const o of g.objects || []) for (const p of o.points || []) fallback.push(p); all=fallback;
  }

  const pointCountRaw = all.length;
  const step = Math.max(1, Math.ceil(pointCountRaw / Math.max(1, maxPoints)));
  const positions = [], colors = [], boundPoints = [];
  for (let i = 0; i < pointCountRaw; i += step) {
    const p = normalizedPoint(all[i]); if (!p) continue;
    positions.push(...p.position); colors.push(...p.color); boundPoints.push(p.position);
  }

  const lines = [], surfaces = [], surfaceColors = [], objectLines = [], objectSurfaces = [], objectSurfaceColors = [];
  let surfaceCount = 0;
  for (const s of g.structuralSurfaces || []) {
    const poly = s?.geometry?.bounds?.polygon || s?.bounds?.polygon || [];
    const valid = poly.filter(validVec3);
    if (valid.length >= 2) {
      surfaceCount++;
      for (let i=0;i<valid.length;i++) lines.push(...valid[i], ...valid[(i+1)%valid.length]);
      boundPoints.push(...valid);
    }
    if (valid.length >= 3) {
      const c = surfaceColor(s.kind, s.confidence);
      for (let i=1;i+1<valid.length;i++) {
        surfaces.push(...valid[0], ...valid[i], ...valid[i+1]);
        surfaceColors.push(...c, ...c, ...c);
      }
    }
  }

  let objectCount = 0;
  for (const o of g.objects || []) {
    objectCount++;
    const verts = (o?.mesh?.vertices || []).map(v => Array.isArray(v) ? v : v?.position).filter(validVec3);
    const tris = o?.mesh?.triangles || [];
    if (verts.length && tris.length) {
      const c = [1, .78, .27, .14];
      for (const t of tris) {
        const a=verts[t[0]],b=verts[t[1]],cc=verts[t[2]]; if(!a||!b||!cc)continue;
        objectSurfaces.push(...a,...b,...cc); objectSurfaceColors.push(...c,...c,...c);
      }
      boundPoints.push(...verts);
    } else if (o?.obb?.center && o?.obb?.size) {
      const box = obbCorners(o.obb); for (const [a,b] of BOX_EDGES) objectLines.push(...box[a],...box[b]); boundPoints.push(...box);
    }
  }

  // Camera path is deliberately subtle but invaluable for debugging scale and
  // tracking. Limit to 2000 poses to keep the preview cheap.
  const path = model?.trajectory || model?.poses || model?.capture?.poses || [];
  if (Array.isArray(path) && path.length > 1) {
    const stride = Math.max(1, Math.ceil(path.length / 2000)); let prev = null;
    for (let i=0;i<path.length;i+=stride) {
      const q = path[i]?.position || path[i]?.pose?.position || matrixPosition(path[i]?.matrix || path[i]?.pose?.matrix);
      if (!validVec3(q)) continue; if (prev) lines.push(...prev,...q); prev=q; boundPoints.push(q);
    }
  }

  // A small ground cross prevents an otherwise valid sparse cloud from looking
  // like a blank canvas and gives immediate metric orientation.
  const bounds = computeBounds(boundPoints.length ? boundPoints : [[-1,0,-1],[1,2,1]]);
  const gridHalf = Math.max(1, Math.min(10, Math.ceil(bounds.radius)));
  const y = Number.isFinite(bounds.min[1]) ? bounds.min[1] : 0;
  for (let k=-gridHalf;k<=gridHalf;k++) {
    lines.push(-gridHalf,y,k, gridHalf,y,k, k,y,-gridHalf, k,y,gridHalf);
  }

  return {
    positions, colors, lines, surfaces, surfaceColors, objectLines, objectSurfaces, objectSurfaceColors, bounds,
    pointCount: positions.length / 3,
    rawPointCount: pointCountRaw,
    surfaceCount, objectCount
  };
}

function normalizedPoint(p) {
  const position = p?.position || p?.mean || p?.gaussian?.mean;
  if (!validVec3(position)) return null;
  const rgb = p?.rgb || p?.color || p?.gaussian?.rgbMean || [150, 185, 192];
  const confidence = finite01(p?.gaussian?.confidence ?? p?.quality ?? p?.confidence ?? .65);
  return { position: [Number(position[0]),Number(position[1]),Number(position[2])], color: [finiteColor(rgb[0]),finiteColor(rgb[1]),finiteColor(rgb[2]), .22 + .78*confidence] };
}
function finiteColor(v){const n=Number(v);return Number.isFinite(n)?clamp(n/255,0,1):.58;}
function finite01(v){const n=Number(v);return Number.isFinite(n)?clamp(n,0,1):.5;}
function validVec3(v){return (Array.isArray(v)||ArrayBuffer.isView(v))&&v.length>=3&&Number.isFinite(Number(v[0]))&&Number.isFinite(Number(v[1]))&&Number.isFinite(Number(v[2]));}
function matrixPosition(m){return (Array.isArray(m)||ArrayBuffer.isView(m))&&m.length>=16?[m[12],m[13],m[14]]:null;}
function surfaceColor(kind,confidence=.5){const a=.055+.095*finite01(confidence);if(kind==='floor')return [.32,.62,.58,a];if(kind==='ceiling')return [.50,.60,.72,a];return [.32,.87,.72,a];}
function obbCorners(o){const c=o.center,axes=o.axes||[[1,0,0],[0,1,0],[0,0,1]],s=o.size.map(v=>v/2),out=[];for(const a of [-1,1])for(const b of [-1,1])for(const d of [-1,1])out.push([c[0]+axes[0][0]*s[0]*a+axes[1][0]*s[1]*b+axes[2][0]*s[2]*d,c[1]+axes[0][1]*s[0]*a+axes[1][1]*s[1]*b+axes[2][1]*s[2]*d,c[2]+axes[0][2]*s[0]*a+axes[1][2]*s[1]*b+axes[2][2]*s[2]*d]);return out;}
const BOX_EDGES=[[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]];

function computeBounds(points){let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const p of points){if(!validVec3(p))continue;for(let i=0;i<3;i++){const x=Number(p[i]);if(x<min[i])min[i]=x;if(x>max[i])max[i]=x;}}if(!Number.isFinite(min[0])){min=[-1,0,-1];max=[1,2,1];}const center=min.map((v,i)=>(v+max[i])/2),dx=max[0]-min[0],dy=max[1]-min[1],dz=max[2]-min[2],radius=Math.max(.25,.5*Math.hypot(dx,dy,dz));return{min,max,center,radius};}
function orbitEye(t,d,yaw,pitch){const cp=Math.cos(pitch);return[t[0]+d*cp*Math.sin(yaw),t[1]+d*Math.sin(pitch),t[2]+d*cp*Math.cos(yaw)];}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function sub(a,b){return[a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
function cross(a,b){return[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
function norm(a){const l=Math.hypot(...a)||1;return a.map(v=>v/l);}
function lookAt(eye,target,up){const z=norm(sub(eye,target)),x=norm(cross(up,z)),y=cross(z,x);return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1]);}
function perspective(fovy,aspect,near,far){const f=1/Math.tan(fovy/2),nf=1/(near-far);return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*nf,-1,0,0,2*far*near*nf,0]);}
function multiply4(a,b){const o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s;}return o;}
function projectMVP(p,m,w,h){const x=p[0],y=p[1],z=p[2],cx=m[0]*x+m[4]*y+m[8]*z+m[12],cy=m[1]*x+m[5]*y+m[9]*z+m[13],cz=m[2]*x+m[6]*y+m[10]*z+m[14],cw=m[3]*x+m[7]*y+m[11]*z+m[15];if(cw<=1e-5)return null;return{x:(cx/cw*.5+.5)*w,y:(1-(cy/cw*.5+.5))*h,z:cz/cw};}
function pinchState(map,distance){const a=[...map.values()];return{span:a.length>=2?Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y):0,distance};}
function resizeCanvasToDisplaySize(canvas,maxDpr=2){const dpr=Math.min(maxDpr,globalThis.devicePixelRatio||1),cssWidth=Math.max(1,Math.round(canvas.clientWidth||800)),cssHeight=Math.max(1,Math.round(canvas.clientHeight||420)),width=Math.max(1,Math.round(cssWidth*dpr)),height=Math.max(1,Math.round(cssHeight*dpr));if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}return{width,height,cssWidth,cssHeight};}
function resizeCanvasToDisplaySize2D(canvas,maxDpr=2){return resizeCanvasToDisplaySize(canvas,maxDpr);}
function shader(gl,type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const msg=gl.getShaderInfoLog(s)||'shader compile failed';gl.deleteShader(s);throw new Error(msg);}return s;}
function program(gl,vs,fs){const p=gl.createProgram(),v=shader(gl,gl.VERTEX_SHADER,vs),f=shader(gl,gl.FRAGMENT_SHADER,fs);gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);if(!gl.getProgramParameter(p,gl.LINK_STATUS)){const msg=gl.getProgramInfoLog(p)||'program link failed';gl.deleteProgram(p);throw new Error(msg);}return p;}

const POINT_VS=`
attribute vec3 a_position;
attribute vec4 a_color;
uniform mat4 u_mvp;
uniform float u_pointSize;
varying vec4 v_color;
void main(){gl_Position=u_mvp*vec4(a_position,1.0);gl_PointSize=u_pointSize;v_color=a_color;}`;
const POINT_FS=`
precision mediump float;
varying vec4 v_color;
void main(){vec2 d=gl_PointCoord-vec2(.5);if(dot(d,d)>.25)discard;gl_FragColor=v_color;}`;
const LINE_VS=`
attribute vec3 a_position;uniform mat4 u_mvp;void main(){gl_Position=u_mvp*vec4(a_position,1.0);}`;
const LINE_FS=`
precision mediump float;uniform vec4 u_color;void main(){gl_FragColor=u_color;}`;
const SURFACE_VS=`
attribute vec3 a_position;attribute vec4 a_color;uniform mat4 u_mvp;varying vec4 v_color;void main(){gl_Position=u_mvp*vec4(a_position,1.0);v_color=a_color;}`;
const SURFACE_FS=`
precision mediump float;varying vec4 v_color;void main(){gl_FragColor=v_color;}`;
