#!/usr/bin/env python3
"""Check static GH Pages package without opening network connections."""
from pathlib import Path
import re
root=Path(__file__).resolve().parent
p=root/'index.html'
assert p.is_file(), 'index.html mancante nella radice'
assert (root/'.nojekyll').is_file(), '.nojekyll mancante'
s=p.read_text(encoding='utf-8')
assert '<!DOCTYPE html>' in s and '<title>SOMA 31' in s
assert s.count('id="engine-source"')==1
assert 'registerProcessor(\'soma-ecology\'' in s
assert 'registerProcessor(\'soma-mic-tap\'' in s
assert 'audioWorklet.addModule' in s
assert 'navigator.mediaDevices.getUserMedia' in s
assert 'URL.createObjectURL' in s
assert '@@SOMA' not in s
assert 'http://localhost:8000' not in s
assert 'index.html' in (root/'soma31/rebuild.py').read_text()
assert not re.search(r'<(?:script|link|img|audio|source)\b[^>]+(?:src|href)=["\']/[^/]',s,re.I), 'Risorsa con percorso assoluto nel documento'
print('PASS: index.html completo, worklet, microfono, nessun path web assoluto, .nojekyll, build coerente')
