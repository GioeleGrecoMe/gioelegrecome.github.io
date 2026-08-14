from pathlib import Path
import json, math, random
ROOT=Path(__file__).resolve().parents[1]
# Synthetic guided-seed regression mirroring the browser policy:
# low-confidence visible points may receive semantic identity, but geometry probability is unchanged.
random.seed(924)
mask={(x,y) for y in range(2,7) for x in range(3,8)}
object_id=3
surfels=[]
for y in range(9):
    for x in range(11):
        z=2.0 + random.uniform(-.015,.015)
        p=.16 if (x,y) in mask else .12
        surfels.append({'cell':(x,y),'z':z,'existence':p,'objectId':None})
# background contaminant very close spatially but outside mask
for k in range(20):
    surfels.append({'cell':(9,k%9),'z':2.02,'existence':.95,'objectId':None})
# confirmation: semantic assignment only; no geometry promotion
before=[s['existence'] for s in surfels]
for s in surfels:
    if s['cell'] in mask and abs(s['z']-2.0) < .16:
        s['objectId']=object_id
assert before==[s['existence'] for s in surfels]
assert sum(s['objectId']==object_id for s in surfels)==len(mask)
# multi-view later confirms only some object points
for s in surfels:
    if s['objectId']==object_id:
        s['existence']=.72 + random.random()*.25
        s['x3']=s['cell'][0]*.08
        s['y3']=s['cell'][1]*.08
        s['z3']=s['z']
    else:
        s['x3']=s['cell'][0]*.08;s['y3']=s['cell'][1]*.08;s['z3']=s['z']
A=[s for s in surfels if s['objectId']==object_id and s['existence']>=.5]
assert len(A)==len(mask)
# refine uses associated points only, so adjacent high-prob background cannot expand the box.
def q(a,t):
    a=sorted(a); return a[max(0,min(len(a)-1,int((len(a)-1)*t)))]
mins=[q([s[k] for s in A],.04) for k in ['x3','y3','z3']]
maxs=[q([s[k] for s in A],.96) for k in ['x3','y3','z3']]
assert maxs[0] < .70  # background x ~= .72 is excluded
result={'status':'PASS','seed_mask_cells':len(mask),'assigned_visible':len(A),'background_outliers':20,'geometry_probability_promoted_by_SAM':False,'background_excluded_from_refine':True}
(ROOT/'tests/result_v924_seed_geometry_logic.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
