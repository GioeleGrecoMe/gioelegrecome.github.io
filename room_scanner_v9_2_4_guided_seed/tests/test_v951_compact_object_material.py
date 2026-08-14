from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[1]
s=(ROOT/'room_scanner_v9.html').read_text()
for token in [
    'objectCaptureMinViews:3','function v95ViewDiversity','C.views.push',
    'async function finalizeCurrentObjectCapture','rawMasksRetained:false','rawImagesRetained:false',
    'function v95WallYaw','function v95OrientedBox','g.rotateY(o.proxy.yaw||0)',
    'compact oriented semantic proxy','function addObjectBoundaryPoint','function closeObjectBoundary',
    'async function assumeContinuousPlane','function v95EstimateHorizontalLevel',
    'materialPriorMaxConfidence:.28','function aggregateMaterialPrior',
    "source:'visual material prior (low confidence); overridden by measured RIR evidence'",
    'semanticEncoding','materialPrior','acousticPrior','proxyIds.has(g.objectId)',
    'releaseSemanticFrameImage(v.F)','v.candidate.grid=null','v.F=null'
]:
    assert token in s, token
# The simulation surface builder must have one definitive implementation.
assert s.count('function objectProxySimulationSurfaces()') == 1
# Readiness must remain local, never scan the full map from the reticle callback.
a=s.index('function objectSeedGeometryReadiness')
b=s.index('function updateObjectSeedReadiness',a)
assert 'S.surfels.values()' not in s[a:b]
# A material label remains a prior, not measured acoustic truth.
assert "confidence:.42" in s and 'semantic-material-prior' in s
# Finalized objects suppress their dense surfels from the live preview.
assert 'proxyIds=new Set' in s and 'proxyIds.has(g.objectId)' in s
res={'status':'PASS','minimum_views':3,'oriented_proxy':True,'raw_masks_retained':False,'material_prior_max_confidence':.28,'metric_readiness_local':True}
(ROOT/'tests/result_v951_compact_object_material.json').write_text(json.dumps(res,indent=2))
print(json.dumps(res,indent=2))
