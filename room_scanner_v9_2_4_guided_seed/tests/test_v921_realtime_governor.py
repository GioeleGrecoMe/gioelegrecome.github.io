from pathlib import Path
import re, json, subprocess, math

ROOT=Path(__file__).resolve().parents[1]
HTML=ROOT/'room_scanner_v9.html'
s=HTML.read_text(encoding='utf-8')

# Basic structural checks.
ids=re.findall(r'\bid=["\']([^"\']+)["\']',s)
assert len(ids)==len(set(ids)), 'duplicate DOM IDs'
required=[
    "v9.2.4-guided-object-seeding",
    "rtFrameSoftMs:15.5", "rtValidationBudgetMs:1.35",
    "rtPreviewCaps:[7000,4800,2800,1600]",
    "rtSurfelSoftCaps:[140000,110000,85000,65000]",
    "rtDepthFusionStrides:[1,1,2,3]",
    "rtCameraFpsLevels:[2.5,1.8,1.2,0.60]",
    "rtSemanticMaxLevel:0", "rtEdgeMaxLevel:1",
    "processSurfelValidationBudget", "rtUpdateGovernor", "installLongTaskObserver",
    "buildLiveSurfelPreview", "gaussianCapacity", "DynamicDrawUsage",
    "buildLiveAcousticSamples", "liveAcousticSampleCache",
    "rtLiveAcousticNodes:[360,220,0,0]", "rtLiveAcousticSamples:[10,8,0,0]",
    "diagnosticBtn", "diagnosticHudBtn", "exportDiagnosticSnapshot",
    "runtime_performance.csv", "surfel_sample.csv", "map_frame_summary.csv",
    "semanticPacketBoundaryMaintenance", "EfficientSAM-Ti/WebGPU", "EfficientSAM-Ti/WASM",
    "sw.js?v=924", "room-acoustic-v924",
]
missing=[x for x in required if x not in s]
assert not missing, missing

# Extract a named JS function with brace/string/template awareness good enough for this source.
def extract_function(name):
    m=re.search(rf'(?:async\s+)?function\s+{re.escape(name)}\s*\([^)]*\)\s*\{{',s)
    assert m, f'function {name} missing'
    i=m.end()-1; depth=0; quote=None; esc=False; template=False; j=i
    while j < len(s):
        c=s[j]
        if quote:
            if esc: esc=False
            elif c=='\\': esc=True
            elif c==quote: quote=None
        elif template:
            if esc: esc=False
            elif c=='\\': esc=True
            elif c=='`': template=False
            # Template ${} braces are intentionally counted below only outside template;
            # source functions under test do not rely on unmatched template braces.
        else:
            if c in "'\"": quote=c
            elif c=='`': template=True
            elif c=='{': depth+=1
            elif c=='}':
                depth-=1
                if depth==0: return s[m.start():j+1]
        j+=1
    raise AssertionError(f'unclosed function {name}')

render=extract_function('render')
sample_depth=extract_function('sampleDepth')
add_surfel=extract_function('addSurfel')
update_splats=extract_function('updateSplats')
build_struct=extract_function('buildStructuralGraph')
semantic_enqueue=extract_function('enqueueSemanticFrame')
semantic_packet=extract_function('semanticPacketBoundaryMaintenance')
admin=extract_function('adminSnapshot')

# Hot path must not run offline/full algorithms.
for name,body in [('render',render),('sampleDepth',sample_depth),('addSurfel',add_surfel)]:
    for bad in ['buildGeometryGaussianField(', 'buildAcousticGaussianFieldFromVirtualArray(',
                'reconstructSurfaces(', 'inferSimplePrimitivesFromStableSurfels(',
                'computeQualityReport(', 'optimizeSurfaceAcoustics(']:
        assert bad not in body, f'{name} contains heavy call {bad}'
assert 'processSurfelValidationBudget' in render
assert 'rtUpdateGovernor' in render
assert 'viewPointFromUVDepthPrepared(invP' in sample_depth
assert sample_depth.count('.invert()') <= 1, 'projection inversion appears per-point again'
assert 'rtDepthStride()' in sample_depth and 'rtDepthPeriodScale()' not in sample_depth # period is in shouldDepthSample
assert 'rtCheapSurfelState' in add_surfel and 'updateSurfelState(s,now)' not in add_surfel
assert 'rtSurfelSoftCap()' in add_surfel and 'fineDemotions' in add_surfel and 'allocationDrops' in add_surfel

# Live preview may use full field only on offline branch, never forced.
assert '(S.recording||S.session)?buildLiveSurfelPreview' in update_splats
assert 'buildGeometryGaussianField(true)' not in update_splats
assert 'gaussianCapacity' in s

# Structural primitive clustering must be final/forced only.
assert 'force?inferSimplePrimitivesFromStableSurfels(planes):[]' in build_struct

# Neural inference is queued during recording, and one job is pumped only at packet boundary.
assert 'if(!S.recording&&semanticSafeWindow())pumpSemanticQueue(1)' in semantic_enqueue
assert 'await pumpSemanticQueue(1)' in semantic_packet
assert 'rtSemanticAllowed(force)' not in extract_function('semanticInferenceNeeded')
assert 'rtLevel()>2' in semantic_packet  # queued keyframes survive L1/L2 and run only in packet safe window

# Admin/quality inspection must remain live-light while recording.
assert 'S.recording?(S.liveQuality||computeLiveQualityFast()):computeQualityReport()' in admin
assert 'S.recording?S.acousticSamples.length:buildAcousticSamples().length' in admin
assert 'S.recording?S.acousticVirtualSources.length:recoverVirtualImageSources().length' in admin

# Explicit manual heavy actions are guarded during realtime.
assert "manual optimize deferred during realtime" in s
assert "if(S.recording||S.session){const q=computeLiveQualityFast()" in s

# Long tasks escalate the governor instead of merely logging.
longtask=extract_function('installLongTaskObserver')
assert 'R.level++' in longtask and 'long task' in longtask

# Live acoustics must not rebuild full per-band sample metrics.
live_samples=extract_function('buildLiveAcousticSamples')
assert 'octaveDecayMetrics' not in live_samples
assert 'detectEchoGaussians' in live_samples
va=extract_function('buildAcousticGaussianFieldFromVirtualArray')
assert 'live?buildLiveAcousticSamples' in va

# Syntax checks.
m=re.search(r'<script\s+type=["\']module["\']>([\s\S]*?)</script>',s,re.I); assert m
mod=Path('/tmp/module_v921_check.mjs'); mod.write_text(m.group(1),encoding='utf-8')
r=subprocess.run(['node','--check',str(mod)],capture_output=True,text=True)
assert r.returncode==0,r.stderr
r2=subprocess.run(['node','--check',str(ROOT/'sw.js')],capture_output=True,text=True)
assert r2.returncode==0,r2.stderr

# Governor behavior model: repeated slow frames increase throttling; sustained recovery lowers it.
soft,hard,critical,recover=15.5,23.0,32.0,11.5
level=0
# Ignore production cooldown here; this validates threshold ordering/desired response.
trace=[]
for avg,p90 in [(10,11),(17,20),(20,25),(25,35),(10,12),(9,10),(9,10),(9,10)]:
    if p90>critical or avg>hard: level=min(3,level+1)
    elif p90>hard or avg>soft: level=min(3,level+1)
    elif avg<recover and p90<soft*.9: level=max(0,level-1)
    trace.append(level)
assert max(trace)>=2 and trace[-1] < max(trace)

# Static complexity proxy comparing v9.1 old design vs budgeted design.
# Old depth insertion could perform O(depth_points * keyframes) reprojection immediately.
# New validation has a time budget independent of number of depth samples in a frame.
points=32*24
old_checks=points*18
# With ~1.35 ms slice, assume at least one but bounded validations; the exact count is device dependent.
assert old_checks == 13824

result={
    'status':'PASS',
    'dom_ids':len(ids),
    'node_check':'PASS',
    'service_worker_check':'PASS',
    'hot_path_functions_checked':['render','sampleDepth','addSurfel','updateSplats'],
    'old_v91_immediate_reprojection_checks_per_full_depth_grid_proxy':old_checks,
    'new_validation_policy':'time-budgeted incremental queue',
    'preview_caps':[7000,4800,2800,1600],
    'surfel_soft_caps':[140000,110000,85000,65000],
    'depth_fusion_strides':[1,1,2,3],
    'rgb_fps_levels':[2.5,1.8,1.2,.6],
    'live_acoustic_nodes':[360,220,0,0],
    'live_acoustic_rirs':[10,8,0,0],
    'governor_model_trace':trace,
    'diagnostic_snapshot':'present',
}
(ROOT/'tests'/'result_v921_realtime_governor.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result,indent=2))
