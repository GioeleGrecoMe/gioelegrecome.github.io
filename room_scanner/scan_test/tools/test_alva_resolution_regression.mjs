#!/usr/bin/env node
/**
 * Regression for the failure captured in Scan Test v2.2.0.
 * It feeds the same dynamic fixture to AlvaAR using the old 320x240 path and
 * the corrected 640x480 path. Requires ffmpeg on PATH.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { AlvaAR } from '../vendor/alva_ar.js';

const here=dirname(fileURLToPath(import.meta.url));
const defaultVideo=resolve(here,'../fixtures/alva_dynamic_regression.mp4');
const video=process.argv[2] || defaultVideo;
if(!fs.existsSync(video)){console.error(`Video not found: ${video}`);process.exit(2);}

async function runCase({label,width,height,fps,horizontalFovDeg=60}){
  const alvaFovArgumentDeg=horizontalFovDeg * height / width;
  const tracker=await AlvaAR.Initialize(width,height,alvaFovArgumentDeg);
  const vf=`fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`;
  const ff=spawn('ffmpeg',['-hide_banner','-loglevel','error','-i',video,'-vf',vf,'-an','-sn','-dn','-f','rawvideo','-pix_fmt','rgba','pipe:1'],{stdio:['ignore','pipe','pipe']});
  const errors=[];ff.stderr.on('data',d=>errors.push(String(d)));
  const frameBytes=width*height*4;let pending=Buffer.alloc(0),frames=0,poses=0,firstPose=-1;const pointCounts=[];
  for await(const chunk of ff.stdout){
    pending=Buffer.concat([pending,chunk]);
    while(pending.length>=frameBytes){
      const b=pending.subarray(0,frameBytes);pending=pending.subarray(frameBytes);
      const image={data:new Uint8ClampedArray(b.buffer,b.byteOffset,b.byteLength),width,height};
      const pose=tracker.findCameraPose(image);const points=Array.from(tracker.getFramePoints?.()||[]);pointCounts.push(points.length);
      if(pose?.length>=16){poses++;if(firstPose<0)firstPose=frames;}frames++;
    }
  }
  const exitCode=await new Promise(resolveClose=>ff.exitCode!==null?resolveClose(ff.exitCode):ff.once('close',c=>resolveClose(c??0)));
  if(exitCode!==0)throw new Error(`ffmpeg failed (${exitCode}): ${errors.join('').trim()}`);
  pointCounts.sort((a,b)=>a-b);
  return {label,width,height,fps,frames,validPoses:poses,firstPoseFrame:firstPose,medianFramePoints:pointCounts.length?pointCounts[Math.floor(pointCounts.length/2)]:0,horizontalFovDeg,alvaFovArgumentDeg};
}

const oldPath=await runCase({label:'v2.2-like',width:320,height:240,fps:8});
const fullCadenceLowResolution=await runCase({label:'320x240-at-30fps',width:320,height:240,fps:30});
const corrected=await runCase({label:'v2.4-corrected',width:640,height:480,fps:30});
const result={video,oldPath,fullCadenceLowResolution,corrected,pass:oldPath.validPoses===0 && fullCadenceLowResolution.validPoses===0 && corrected.validPoses>0};
console.log(JSON.stringify(result,null,2));
if(!result.pass){console.error('Resolution regression did not reproduce the expected old-vs-new separation.');process.exitCode=1;}
