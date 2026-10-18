#!/usr/bin/env python3
from pathlib import Path
base=Path(__file__).resolve().parent
out=base.parent/'index.html'
engine=(base/'engine.js').read_text().replace('/*@@SOMA_ADAPTIVE_LIBRARY@@*/',(base/'adaptive_feedback.js').read_text()+'\n'+(base/'harmonic_navigation.js').read_text()+'\n'+(base/'somatic_onset.js').read_text())
s=(base/'ui_template.html').read_text()
for marker,src in {'@@SOMA_ENGINE@@':engine,'@@SOMA_AMBIENT_LIBRARY@@':(base/'ambient_harmony.js').read_text(),
 '@@SOMA_SPECTRAL_LIBRARY@@':(base/'spectral_lab.js').read_text(),'@@SOMA_SPECTRAL_UI@@':(base/'spectral_ui.js').read_text(),
 '@@SOMA_ADAPTIVE_UI@@':(base/'adaptive_ui.js').read_text(),'@@SOMA_HARMONIC_UI@@':(base/'harmonic_ui.js').read_text()+'\n'+(base/'somatic_ui.js').read_text()}.items():
 assert s.count(marker)==1,marker
 s=s.replace(marker,src)
s=s.replace('<title>SOMA 26 — Cells into Music</title>','<title>SOMA 31 — Somatic Onset</title>')
assert '@@SOMA' not in s
out.write_text(s, encoding='utf-8')
print('Generated',out,out.stat().st_size)
