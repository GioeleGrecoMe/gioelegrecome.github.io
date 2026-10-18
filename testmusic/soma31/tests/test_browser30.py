from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[2]
with sync_playwright() as pw:
 browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 try:
  for width in (1280,390):
   page=browser.new_page(viewport={'width':width,'height':850})
   errors=[];page.on('pageerror',lambda err:errors.append(str(err)))
   page.set_content((root/'index.html').read_text(),wait_until='load')
   assert page.title()=='SOMA 31 — Somatic Onset',page.title()
   for id in ('harmonicLab','harmonicEnabled','harmonyKey','harmonyPlan','harmonyHistory','adaptiveLab','outStftCanvas','roomResponseCanvas'):
    assert page.locator('#'+id).count()==1,id
   assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 2')
   assert page.evaluate('typeof harmonicUpdate')=='function'
   assert page.evaluate('typeof adaptiveUpdate')=='function'
   page.locator('#harmonicEnabled').uncheck();assert not page.locator('#harmonicEnabled').is_checked()
   page.locator('#harmonicEnabled').check()
   assert not errors,errors
   page.screenshot(path=str(root/'soma31'/f'ui_static_{width}.png'),full_page=True)
   print('PASS static browser',width)
   page.close()
 finally:browser.close()
