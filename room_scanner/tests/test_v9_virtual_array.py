import json, math, pathlib, random, statistics
random.seed(9)
OUT=pathlib.Path(__file__).with_name('result_virtual_array.json')
C=343.0
source=(-1.3,1.1,-0.7)
true=(0.0,1.05,1.25)  # point on a stable wall patch x=0
receivers=[(-1.7+0.22*i,1.15,-1.4+0.11*(i%4)) for i in range(14)]

def dist(a,b): return math.sqrt(sum((a[i]-b[i])**2 for i in range(3)))
def path(x,r): return dist(source,x)+dist(x,r)
# early-echo path observations with cm-scale path noise and two large outliers
obs=[]
for i,r in enumerate(receivers):
    noise=random.gauss(0,0.018)
    if i in (4,11): noise += (0.22 if i==4 else -0.19)
    obs.append(path(true,r)+noise)

def robust_score(x):
    residual=[abs(path(x,r)-o) for r,o in zip(receivers,obs)]
    med=statistics.median(residual)
    mad=statistics.median(abs(v-med) for v in residual)+1e-6
    gate=max(0.055,3.0*1.4826*mad)
    keep=[v for v in residual if v<=gate]
    support=len(keep)
    mean=sum(math.exp(-0.5*(v/0.050)**2) for v in keep)/max(1,len(receivers))
    return mean*(support/len(receivers)), support, statistics.median(keep) if keep else 9

# candidate Gaussian surfels on the same wall; virtual-array ellipsoids should peak near true patch
candidates=[]
for iy in range(9):
    y=0.65+iy*0.10
    for iz in range(17):
        z=0.45+iz*0.10
        x=(0.0,y,z)
        s,sup,med=robust_score(x)
        candidates.append((s,x,sup,med))
candidates.sort(reverse=True,key=lambda q:q[0])
best=candidates[0]
err=dist(best[1],true)
# deliberately wrong/off-wall candidates
bad=[(0.42,1.05,1.25),(0.0,1.9,-0.4),(0.0,0.4,2.2)]
bad_scores=[robust_score(x)[0] for x in bad]
result={
 'status':'PASS' if err<0.16 and best[2]>=11 and best[0]>max(bad_scores)*1.8 else 'FAIL',
 'best_candidate':list(best[1]),
 'localization_error_m':round(err,4),
 'support_receivers':best[2],
 'best_score':round(best[0],4),
 'max_wrong_score':round(max(bad_scores),4),
 'receivers':len(receivers),
 'injected_large_outliers':2
}
OUT.write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
if result['status']!='PASS': raise SystemExit(1)
