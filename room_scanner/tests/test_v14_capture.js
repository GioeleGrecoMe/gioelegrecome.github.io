const fs=require('fs'),assert=require('assert'); const h=fs.readFileSync('room_scanner_v12.html','utf8');
function body(name){const i=h.indexOf(`function ${name}(`);assert(i>=0,name);let b=h.indexOf('{',i),d=0;for(let j=b;j<h.length;j++){if(h[j]==='{')d++;else if(h[j]==='}'&&!--d)return h.slice(b+1,j)}throw Error('body');}
const cap=body('captureFrame'); for(const bad of ['getCameraImage','readCameraRGBA','sampleDepthGrid','S.currentFrame']) assert(!cap.includes(bad),`captureFrame touches ${bad}`);
const full=body('fulfillCaptureRequest'); assert(full.includes('readCameraRGBA')); assert(full.includes('sampleDepthGrid')); assert(full.includes('projection')); assert(full.includes('worldFromView'));
assert(cap.includes('rgbaToJpeg'),'JPEG after frame callback');
const calls=(h.match(/readCameraRGBA\s*\(/g)||[]).length; assert(calls<=4,'raw camera access should stay localized');
console.log('capture lifetime ok', {rawCameraCalls:calls});
