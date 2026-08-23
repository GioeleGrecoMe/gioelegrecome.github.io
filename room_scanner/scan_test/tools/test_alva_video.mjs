#!/usr/bin/env node
/**
 * Feed consecutive decoded MP4 frames directly to the bundled AlvaAR tracker.
 * Requires ffmpeg on PATH. The resize/crop matches CameraController object-fit:cover.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { AlvaAR } from '../vendor/alva_ar.js';

const [videoPath, fovArg='60', maxFramesArg='300', minPosesArg='1'] = process.argv.slice(2);
if (!videoPath) {
  console.error('Usage: node tools/test_alva_video.mjs <video> [horizontalFovDeg=60] [maxFrames=300] [minValidPoses=1]');
  process.exit(2);
}
if (!fs.existsSync(videoPath)) {
  console.error(`Video not found: ${videoPath}`);
  process.exit(2);
}

const W=640, H=480;
const horizontalFovDeg=Number(fovArg)||60;
const maxFrames=Math.max(1, Number(maxFramesArg)||300);
const minValidPoses=Math.max(0, Number(minPosesArg)||0);
// The wrapper treats the supplied FOV as the vertical value for landscape and
// derives horizontal FOV linearly with aspect ratio. Mirror app.js conversion.
const alvaFovArgumentDeg=horizontalFovDeg * H / W;
const tracker=await AlvaAR.Initialize(W,H,alvaFovArgumentDeg);
if (!tracker?.findCameraPose) throw new Error('AlvaAR.Initialize did not return a tracker');

// Force exactly the same target raster semantics as CameraController: scale to
// cover 640x480, then center crop. `setsar=1` removes non-square source SAR.
const vf=`scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`;
const ff=spawn('ffmpeg',[
  '-hide_banner','-loglevel','error','-i',videoPath,
  '-vf',vf,'-an','-sn','-dn','-f','rawvideo','-pix_fmt','rgba','pipe:1'
],{stdio:['ignore','pipe','pipe']});
const errors=[]; ff.stderr.on('data',d=>errors.push(String(d)));
const frameBytes=W*H*4;
let pending=Buffer.alloc(0), frames=0, validPoses=0, firstPoseFrame=-1;
const pointCounts=[];

function makeImageData(buffer){
  // Alva only needs .data/.width/.height; this avoids requiring browser ImageData in Node.
  return { data:new Uint8ClampedArray(buffer.buffer, buffer.byteOffset, buffer.byteLength), width:W, height:H };
}
function processFrame(buffer){
  if (frames>=maxFrames) return false;
  const pose=tracker.findCameraPose(makeImageData(buffer));
  const points=Array.from(tracker.getFramePoints?.()||[]);
  pointCounts.push(points.length);
  if (pose?.length>=16) {
    validPoses++;
    if (firstPoseFrame<0) firstPoseFrame=frames;
  }
  frames++;
  return frames<maxFrames;
}

let stoppedEarly=false;
for await (const chunk of ff.stdout) {
  pending=Buffer.concat([pending,chunk]);
  while (pending.length>=frameBytes) {
    const frame=pending.subarray(0,frameBytes);
    pending=pending.subarray(frameBytes);
    if (!processFrame(frame)) {
      stoppedEarly=true;
      ff.kill('SIGTERM');
      break;
    }
  }
  if (stoppedEarly) break;
}
const exitCode=await new Promise(resolve=>{
  if (ff.exitCode!==null || ff.signalCode!==null) resolve(ff.exitCode??0);
  else ff.once('close',code=>resolve(code??0));
});
if (!stoppedEarly && exitCode!==0) throw new Error(`ffmpeg failed (${exitCode}): ${errors.join('').trim()}`);

const sorted=pointCounts.slice().sort((a,b)=>a-b);
const medianFramePoints=sorted.length ? sorted[Math.floor(sorted.length/2)] : 0;
const result={
  video:videoPath,
  frames,
  validPoses,
  poseRatio:frames?validPoses/frames:0,
  firstPoseFrame,
  medianFramePoints,
  horizontalFovDeg,
  alvaFovArgumentDeg,
  minValidPoses,
};
console.log(JSON.stringify(result,null,2));
if (validPoses < minValidPoses) {
  console.error(`Regression failed: ${validPoses} valid poses < required ${minValidPoses}.`);
  process.exitCode=1;
}
