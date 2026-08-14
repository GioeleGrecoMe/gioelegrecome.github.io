from pathlib import Path
import subprocess, zipfile, json, tempfile

ROOT=Path(__file__).resolve().parents[1]
s=(ROOT/'room_scanner_v9.html').read_text(encoding='utf-8')
a=s.index('const CRC_TABLE=')
b=s.index('function u16le',a)
code=s[a:b]
out=Path('/tmp/diagnostic_zip_smoke.zip')
code += f'''\n(async()=>{{\n const z=await makeStoreZip([\n  {{name:'diagnostic_snapshot.json',data:JSON.stringify({{ok:true,build:'v9.2.1'}})}},\n  {{name:'runtime_performance.csv',data:'t_ms,frame_ms\\n0,12.4\\n500,14.1\\n'}},\n  {{name:'README.txt',data:'diagnostic smoke'}}\n ]);\n const fs=await import('node:fs');\n fs.writeFileSync({json.dumps(str(out))},Buffer.from(await z.arrayBuffer()));\n}})().catch(e=>{{console.error(e);process.exit(1)}});\n'''
js=Path('/tmp/diagnostic_zip_smoke.mjs'); js.write_text(code,encoding='utf-8')
r=subprocess.run(['node',str(js)],capture_output=True,text=True)
assert r.returncode==0,r.stderr
with zipfile.ZipFile(out) as z:
    assert z.testzip() is None
    assert z.namelist()==['diagnostic_snapshot.json','runtime_performance.csv','README.txt']
    d=json.loads(z.read('diagnostic_snapshot.json'))
    assert d['ok'] and d['build']=='v9.2.1'
result={'status':'PASS','entries':3,'zip_integrity':'PASS','snapshot_json':'PASS'}
(ROOT/'tests'/'result_v921_diagnostic_zip.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result,indent=2))
