#!/usr/bin/env python3
"""Browser regression for CameraController.consumeDecodedFrames + bundled AlvaAR.
Requires Playwright + Chromium. Usage: python tools/test_alva_browser_path.py video.mp4 [min_poses]
"""
from playwright.sync_api import sync_playwright
from pathlib import Path
import json, sys
root=Path(__file__).resolve().parents[1]
video=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else root/'fixtures/alva_dynamic_regression.mp4'
min_poses=int(sys.argv[2]) if len(sys.argv)>2 else 1
playback_rate=float(sys.argv[3]) if len(sys.argv)>3 else .25
cam=(root/'camera.js').read_text(); alva=(root/'vendor/alva_ar.js').read_text()
with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-gpu','--autoplay-policy=no-user-gesture-required'])
  page=browser.new_page(); page.set_content('<input id=f type=file><video id=v muted playsinline></video>'); page.set_input_files('#f',str(video))
  out=page.evaluate("""async ({cam,alva,playbackRate})=>{
    const {CameraController}=await import(URL.createObjectURL(new Blob([cam],{type:'text/javascript'})));
    const {AlvaAR}=await import(URL.createObjectURL(new Blob([alva],{type:'text/javascript'})));
    const v=document.querySelector('#v'), file=document.querySelector('#f').files[0]; v.src=URL.createObjectURL(file); v.muted=true; v.playsInline=true;
    const capture=new CameraController({video:v,longSide:960,source:'file'}); await capture.start({autoplay:false});
    const tracker=await AlvaAR.Initialize(capture.width,capture.height); let poses=0,first=-1,n=0; const times=[],points=[];
    const decode=await capture.consumeDecodedFrames((frame)=>{ n++; times.push(frame.mediaTime); const pose=tracker.findCameraPose(frame.imageData); const pc=tracker.getFramePoints().length; points.push(pc); if(pose?.length>=16){poses++; if(first<0)first=n-1;} },{timeout:180000,playbackRate,includeInitial:true});
    const gaps=[]; for(let i=1;i<times.length;i++)gaps.push(times[i]-times[i-1]); gaps.sort((a,b)=>a-b); const med=gaps.length?gaps[gaps.length>>1]:null;
    return {source:[v.videoWidth,v.videoHeight],raster:[capture.width,capture.height],frames:n,poses,poseRatio:n?poses/n:0,firstPose:first,firstTimes:times.slice(0,12),lastMediaTime:times.at(-1),medianGap:med,decode};
  }""",{'cam':cam,'alva':alva,'playbackRate':playback_rate})
  browser.close()
print(json.dumps(out,indent=2))
if out['poses'] < min_poses: sys.exit(1)
