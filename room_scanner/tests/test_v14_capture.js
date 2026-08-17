
'use strict';
const fs=require('fs'),assert=require('assert'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','room_scanner_v12.html'),'utf8');
function body(name,next){
  const a=html.indexOf(`function ${name}`); assert.ok(a>=0,`${name} missing`);
  const b=next?html.indexOf(`function ${next}`,a+1):html.indexOf('\nfunction ',a+1);
  return html.slice(a,b>0?b:html.length);
}
const capture=body('captureFrame','capturePanorama');
const fulfill=body('fulfillCaptureRequest','onXRFrame');
const raf=body('onXRFrame','floorAim');
// DOM click path must NEVER dereference a frame-scoped camera/depth object.
for(const forbidden of ['readCameraRGBA(','getCameraImage(','sampleDepthGrid(','S.currentFrame'])
  assert.ok(!capture.includes(forbidden),`captureFrame illegally uses ${forbidden}`);
assert.match(capture,/S\.captureRequest=\{role,cellId:c\.id,resolve,reject,timer/,'click must queue a request');
assert.match(capture,/pending\.then\(snap=>/,'slow finalization must run after the XR callback');
assert.match(capture,/rgbaToJpeg\(snap\.rgba/,'JPEG encoding belongs outside the XR callback');
assert.ok(!fulfill.includes('rgbaToJpeg('),'XR callback must not JPEG-encode');
assert.ok(!fulfill.includes('imageQuality('),'XR callback must not run image-quality analysis');
// The next active XR animation callback owns the synchronized copy.
assert.match(fulfill,/readCameraRGBA\(view,true,CFG\.captureLongEdge\)/);
assert.match(fulfill,/sampleDepthGrid\(frame,view\)/);
assert.match(fulfill,/projection:\[\.\.\.view\.projectionMatrix\]/);
assert.match(fulfill,/worldFromView:\[\.\.\.view\.transform\.matrix\]/);
assert.match(raf,/if\(S\.captureRequest\)fulfillCaptureRequest\(frame,view\)/);
// Session termination and capture errors must reject/clear queued requests.
assert.match(html,/if\(S\.captureRequest\)\{clearTimeout\(S\.captureRequest\.timer\);S\.captureRequest\.reject/);
assert.match(html,/timeout scatto WebXR/);
// Only frame-loop-owned paths are allowed to call the raw camera copier.
const calls=[...html.matchAll(/readCameraRGBA\(/g)].map(m=>m.index);
assert.equal(calls.length,3,'expected definition + capture fulfil + live preview only');
assert.ok(calls[1]>=fulfill.indexOf('readCameraRGBA')+html.indexOf('function fulfillCaptureRequest'));
console.log('V14 capture lifetime regression: PASS');
