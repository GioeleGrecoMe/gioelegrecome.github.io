#!/usr/bin/env python3
"""End-to-end regression: real <input type=file> -> app -> continuous decoder -> Alva.
Serves the scan-test directory over localhost because modern Chromium blocks
module navigation from file:// in hardened environments.
Usage: python tools/test_app_file_video.py [video.mp4] [min_live_poses]
"""
from playwright.sync_api import sync_playwright
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from threading import Thread
import sys,time,json
root=Path(__file__).resolve().parents[1]
video=str(Path(sys.argv[1]).resolve()) if len(sys.argv)>1 else str(root/'fixtures/alva_dynamic_regression.mp4')
min_poses=int(sys.argv[2]) if len(sys.argv)>2 else 1
handler=partial(SimpleHTTPRequestHandler,directory=str(root))
server=ThreadingHTTPServer(('127.0.0.1',0),handler)
Thread(target=server.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{server.server_port}/index.html'
try:
  with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-gpu','--autoplay-policy=no-user-gesture-required'])
    page=browser.new_page(viewport={'width':1000,'height':900}); console=[]; page.on('console',lambda m: console.append(f'{m.type}: {m.text}'))
    try:
      page.goto(url,wait_until='domcontentloaded',timeout=20000)
      page.set_input_files('#videoFile',video)
      deadline=time.time()+120
      done=False
      while time.time()<deadline:
        log=page.locator('#log').inner_text()
        if any(x in log for x in ['uploaded-video-native-decode-complete','uploaded-video-processing-failed']):
          done=True; break
        time.sleep(.5)
      out={'done':done,'status':page.locator('#runtimeStatus').inner_text(),'poses':page.locator('#poseCount').inner_text(),'frames':page.locator('#frameCount').inner_text(),'offline':page.locator('#offlineBadge').inner_text(),'log':page.locator('#log').inner_text()[:18000],'console':console[-60:]}
      print(json.dumps(out,indent=2))
      if not done or int(out['poses'] or 0)<min_poses: sys.exit(1)
    finally: browser.close()
finally:
  server.shutdown(); server.server_close()
