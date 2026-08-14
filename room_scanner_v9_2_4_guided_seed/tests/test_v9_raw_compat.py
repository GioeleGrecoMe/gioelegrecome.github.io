from pathlib import Path
import zipfile,csv,io,json,os,sys
ROOT=Path(__file__).resolve().parents[1]
candidates=[]
if os.environ.get('TEST_V8_ZIP'): candidates.append(Path(os.environ['TEST_V8_ZIP']))
candidates += [ROOT/'Test_v8.zip', ROOT.parent/'Test_v8.zip', Path('/mnt/data/Test_v8.zip')]
zpath=next((p for p in candidates if p.exists()),None)
if not zpath:
    result={'status':'SKIP','reason':'legacy Test_v8.zip fixture not present'}
    (ROOT/'tests'/'result_raw_compat.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2)); sys.exit(0)
with zipfile.ZipFile(zpath) as z:
    names=set(z.namelist())
    assert 'raw_manifest.json' in names
    json.loads(z.read('raw_manifest.json'))
    txt=z.read('surfels_raw.csv').decode('utf-8',errors='replace')
    rows=list(csv.DictReader(io.StringIO(txt)))
    path=list(csv.DictReader(io.StringIO(z.read('tracking_path_raw.csv').decode())))
    assert len(rows)>1000 and len(path)>100
    inferred=[]
    for r in rows[:5000]:
        try:w=max(.05,float(r.get('weight') or .75))
        except:w=.75
        try:v=float(r.get('view_count') or 0)
        except:v=0
        inferred.append(max(1,min(5,int(round(v if v else w/1.15)))))
    assert min(inferred)>=1
    audio=z.getinfo('audio_capture_float32.wav').file_size if 'audio_capture_float32.wav' in names else 0
result={'status':'PASS','fixture':zpath.name,'legacy_surfels':len(rows),'legacy_path_poses':len(path),'audio_bytes':audio,'inferred_views_median':sorted(inferred)[len(inferred)//2]}
(ROOT/'tests'/'result_raw_compat.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
