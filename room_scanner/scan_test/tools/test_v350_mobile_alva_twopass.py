#!/usr/bin/env python3
"""Low-level browser regression for the v3.5 mobile two-pass invariant.
Requires Playwright + Chromium. It does not load the full app or Deep.
Usage: python tools/test_v350_mobile_alva_twopass.py [video.mp4] [dense_frames]
"""
from playwright.sync_api import sync_playwright
from pathlib import Path
import json, sys
root=Path(__file__).resolve().parents[1]
video=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else root/'fixtures/alva_dynamic_regression.mp4'
dense=int(sys.argv[2]) if len(sys.argv)>2 else 48
cam=(root/'camera.js').read_text(); alva=(root/'vendor/alva_ar.js').read_text()
ua='Mozilla/5.0 (Linux; Android 16; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-gpu','--autoplay-policy=no-user-gesture-required'])
    ctx=browser.new_context(user_agent=ua,viewport={'width':412,'height':915},is_mobile=True,has_touch=True)
    page=ctx.new_page(); page.set_content('<input id=f type=file><video id=v muted playsinline></video>'); page.set_input_files('#f',str(video))
    out=page.evaluate("""async ({cam,alva,dense})=>{
      const {CameraController}=await import(URL.createObjectURL(new Blob([cam],{type:'text/javascript'})));
      const {AlvaAR}=await import(URL.createObjectURL(new Blob([alva],{type:'text/javascript'})));
      const v=document.querySelector('#v'), file=document.querySelector('#f').files[0]; v.src=URL.createObjectURL(file); v.muted=true; v.playsInline=true;
      const capture=new CameraController({video:v,longSide:960,source:'file'}); await capture.start({autoplay:false});
      const saved=[]; let callbacks=0,lastPF=null,drops=0;
      const decode=await capture.consumeDecodedFrames((frame)=>{ callbacks++; const pf=Number(frame.presentedFrames); if(Number.isFinite(pf)&&Number.isFinite(lastPF))drops+=Math.max(0,pf-lastPF-1); if(Number.isFinite(pf))lastPF=pf; if(saved.length<dense)saved.push(new Uint8ClampedArray(frame.rgba)); },{timeout:120000,playbackRate:.25,includeInitial:true});
      v.pause();
      const tracker=await AlvaAR.Initialize(capture.width,capture.height,45); let poses=0,resets=0,zero=0,first=-1; const points=[];
      for(let i=0;i<saved.length;i++){ const pose=tracker.findCameraPose(new ImageData(saved[i],capture.width,capture.height)); const n=tracker.getFramePoints().length; const st=Number(tracker.getLastStatus?.() ?? tracker.lastStatus ?? -1); points.push(n); if(!n)zero++; if(st===2)resets++; if(pose?.length>=16){poses++;if(first<0)first=i;} }
      return {raster:[capture.width,capture.height],decode,callbacks,saved:saved.length,drops,poses,first,resets,zero,pointMin:Math.min(...points),pointMax:Math.max(...points)};
    }""",{'cam':cam,'alva':alva,'dense':dense})
    browser.close()
print(json.dumps(out,indent=2))
if out['saved'] < 20 or out['poses'] < 5 or out['resets'] > 0 or out['zero'] > max(2,out['saved']//10): sys.exit(1)
