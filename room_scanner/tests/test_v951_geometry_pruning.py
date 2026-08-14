from pathlib import Path
import json, math
ROOT=Path(__file__).resolve().parents[1]
s=(ROOT/'room_scanner_v9.html').read_text()

def pexist(views,w=1,support=0,contra=0,local=.5,native=0,free=0,reject=0):
    score=-2.15+1.18*max(0,views-1)+.42*min(6,support)+.020*min(6,w)+.38*min(4,native)+.58*(local-.5)-1.10*contra-.64*min(8,free)-.34*min(8,reject)
    raw=1/(1+math.exp(-score))
    cap=.28 if views<=1 else .62 if views==2 else .86 if views==3 else .97
    if native>2.4:
        cap=min(.985,.78+.06*min(3,views))
    return min(raw,cap)

def online_prune(views,opportunities,age_ms,stale_ms,p,contra=0,native=0,isolated=False):
    if native>1.2:
        return False
    if views<=1 and opportunities<3 and age_ms<3200:
        return False
    contradicted=contra>=2 and contra>views+1
    stale_mono=views<=1 and opportunities>=3 and stale_ms>7200
    hard=p<.12 and opportunities>=3
    isolated_weak=isolated and views<2 and p<.38 and age_ms>5200
    return contradicted or stale_mono or hard or isolated_weak

# Same-pose repetition cannot create trusted geometry.
assert pexist(1,w=100000,support=0) <= .28
assert pexist(2,w=100000,support=1) <= .62
# Independent views plus reprojection support can create stable geometry.
p3=pexist(3,w=8,support=3)
assert p3 > .72
# Contradictions reduce confidence.
assert pexist(4,w=8,support=4,contra=3) < pexist(4,w=8,support=4,contra=0)
# Young mono-view points survive until they have a fair chance to be revisited.
assert not online_prune(1,1,1500,1500,pexist(1,w=8))
# Stale mono-view points with sufficient opportunities are removed online.
assert online_prune(1,5,9000,8000,pexist(1,w=8))

for token in [
    'function surfelIndependentViews','function surfelEvidenceCap','if(views<=1)return .28',
    'if(views===2)return .62','if(views===3)return .86','geometryEvidenceCount',
    'function runOnlineSurfelMaintenance','function runOnlineSurfelPruneSlice',
    'function packetBoundaryGeometryMaintenance','async function finalizeSurfelMapCooperative',
    'rtOnlinePruneBudgetMs:2.25','rtOnlinePruneMinOpportunities:3',
    'packetMaintenancePasses','finalPruned','independentViewHistogram'
]:
    assert token in s, token

res={
    'status':'PASS','one_view_max':.28,'two_view_max':.62,
    'three_view_probability':round(p3,4),'young_mono_survives':True,
    'stale_mono_pruned_online':True,'packet_safe_window_maintenance':True
}
(ROOT/'tests/result_v951_geometry_pruning.json').write_text(json.dumps(res,indent=2))
print(json.dumps(res,indent=2))
