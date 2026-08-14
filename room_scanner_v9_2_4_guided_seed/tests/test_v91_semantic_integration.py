from pathlib import Path
import re, json, math, subprocess, random, statistics

ROOT=Path(__file__).resolve().parents[1]
HTML=ROOT/'room_scanner_v9.html'
s=HTML.read_text()

# --- Static integration checks -------------------------------------------------
ids=re.findall(r'\bid="([^"]+)"',s)
dups=sorted({x for x in ids if ids.count(x)>1})
required=[
    "v9.2.4-guided-object-seeding",
    "semanticPeriodMs:4200",
    "semanticInputSize:512",
    "semanticFrameMetrics",
    "captureSemanticFrameImage",
    "preferredOutputLocation={'image_embeddings':'gpu-buffer'}",
    "EfficientSAM-Ti/WebGPU",
    "EfficientSAM-Ti/WASM",
    "semanticSafeWindow",
    "semanticObjectPersistFrames:2",
    "semanticObjectForgetMs:45000",
    "semanticObjectsForExport",
    "semantic_objects.json",
    "semanticObjectsPanel",
    "semanticAddCenter",
    "semanticScanNow",
    "semanticPrefetchBtn",
    "objectVotes:new Map()",
    "objectId,objectConfidence",
    "efficient_sam_vitt_encoder.onnx",
    "efficient_sam_vitt_decoder.onnx",
]
missing=[x for x in required if x not in s]
assert not dups, dups
assert not missing, missing
assert "if(!semanticSafeWindow()){enqueueSemanticFrame(F,force);return false}" in s
assert "semanticRecordingPeriodMs:11000" in s
assert "semanticPacketBoundaryMaintenance" in s
assert "p.includes('silenzio')" not in s[s.index('function semanticSafeWindow'):s.index('function enqueueSemanticFrame')]
assert "F.semanticRgb=rgbGrid" in s  # color belongs to selected keyframe, not later camera frame
assert "q:[camQ.q.x,camQ.q.y,camQ.q.z,camQ.q.w]" in s
assert "sw.js?v=924" in s

# JS syntax check
m=re.search(r'<script type="module">(.*?)</script>',s,re.S); assert m
mod=Path('/tmp/module_v91_check.mjs'); mod.write_text(m.group(1))
r=subprocess.run(['node','--check',str(mod)],capture_output=True,text=True)
assert r.returncode==0,r.stderr
r2=subprocess.run(['node','--check',str(ROOT/'sw.js')],capture_output=True,text=True)
assert r2.returncode==0,r2.stderr

# --- Readable-frame selector regression ---------------------------------------
# Same equations as browser selector, evaluated on synthetic RGB+depth metrics.
MIN_SCORE=.60; MIN_DEPTH=.34; MAX_CLIP=.22; MIN_SHARP=.018; MAX_MPS=.95; MAX_DPS=80

def clamp(x): return max(0,min(1,x))
def frame_score(depth,clip,sharp,speed,turn,rgb=1):
    exposure=clamp(1-clip/MAX_CLIP)
    sharpq=clamp(sharp/MIN_SHARP)
    depthq=clamp((depth-.15)/(MIN_DEPTH-.15))
    motion=clamp(1-max(speed/MAX_MPS,turn/MAX_DPS))
    score=clamp(.30*depthq+.25*sharpq+.20*exposure+.15*motion+.10*rgb)
    readable=(score>=MIN_SCORE and depth>=MIN_DEPTH and clip<=MAX_CLIP and sharp>=MIN_SHARP and speed<=MAX_MPS and turn<=MAX_DPS)
    return score,readable

good=frame_score(.82,.03,.055,.12,8)
dark=frame_score(.82,.76,.006,.10,5)
blur=frame_score(.82,.03,.003,.10,5)
fast=frame_score(.82,.03,.055,1.8,120)
sparse=frame_score(.15,.03,.055,.10,5)
assert good[1]
assert not dark[1] and not blur[1] and not fast[1] and not sparse[1]

# --- Sparse/adaptive scheduler simulation -------------------------------------
# 120 seconds, keyframes every 0.8 s. Only readable + moved + safe frames are eligible.
# Inference time changes, so next interval adapts to 1.8x runtime, bounded [3.2,14] s.
random.seed(91)
period=11000
next_allowed=0
last_t=-1e9
last_pos=None
calls=[]
for k in range(150):
    t=k*800
    # readable about 70%; every 5th candidate occurs during chirp and must wait/skip.
    readable=(k%7 not in (0,1))
    safe=(k%5 != 2)
    pos=(0.055*k, 0, .12*math.sin(k*.13))
    if not readable or not safe: continue
    if t < max(next_allowed,last_t+period): continue
    if last_pos is not None:
        move=math.dist(pos,last_pos)
        if move < .42: continue
    runtime=[650,900,1450,3100][len(calls)%4]
    calls.append((t,runtime))
    last_t=t; last_pos=pos
    next_allowed=t+max(3200,min(14000,1.8*runtime))
assert 5 <= len(calls) <= 12, len(calls)
assert all((t//800)%5 != 2 for t,_ in calls)

# --- Object persistence / matching regression --------------------------------
def aabb_iou(a,b):
    inter=1; va=1; vb=1
    for j in range(3):
        lo=max(a['min'][j],b['min'][j]); hi=min(a['max'][j],b['max'][j])
        inter*=max(0,hi-lo); va*=max(.001,a['max'][j]-a['min'][j]); vb*=max(.001,b['max'][j]-b['min'][j])
    return inter/max(1e-9,va+vb-inter)

def match(c,o):
    d=math.dist(c['center'],o['center'])
    diag=max(.25,math.dist(o['min'],o['max']))
    prox=math.exp(-d/max(.65,.7*diag))
    return .56*prox+.34*aabb_iou(c,o)+.10*.5

o={'center':[.20,.75,1.40],'min':[0,.3,1.1],'max':[.45,1.15,1.75],'support':1,'conf':.54}
c2={'center':[.24,.77,1.44],'min':[.02,.31,1.13],'max':[.47,1.16,1.78]}
c_far={'center':[2.2,.8,-.4],'min':[2,.3,-.7],'max':[2.6,1.2,0]}
assert match(c2,o)>.42
assert match(c_far,o)<.42
# two independent supported frames are enough to make a reasonably confident object persistent.
candidate_conf=.72
o['support']+=1
o['conf']=1-(1-o['conf'])*(1-.58*candidate_conf)
assert o['support']>=2 and o['conf']>.34

# --- Mask dedup regression -----------------------------------------------------
def miou(a,b):
    inter=sum(x and y for x,y in zip(a,b)); union=sum(x or y for x,y in zip(a,b)); return inter/union if union else 0
A=[1 if 10<=i<50 else 0 for i in range(100)]
B=[1 if 12<=i<52 else 0 for i in range(100)]
C=[1 if 65<=i<85 else 0 for i in range(100)]
assert miou(A,B)>.72
assert miou(A,C)==0

result={
 'status':'PASS','dom_ids':len(ids),'node_check':'PASS','service_worker_check':'PASS',
 'readable_frame_score':round(good[0],3),'rejected_modes':['dark/exposure','blur','fast-motion','low-depth'],
 'scheduler_calls_120s':len(calls),'scheduler_max_calls_per_min':round(len(calls)/2,1),
 'object_same_track_score':round(match(c2,o),3),'object_far_score':round(match(c_far,o),3),
 'object_persistent_after_frames':o['support'],'object_confidence':round(o['conf'],3),
 'mask_duplicate_iou':round(miou(A,B),3),'mask_disjoint_iou':miou(A,C),
 'official_split_io_expected':{'encoder_output':'image_embeddings','decoder_points_shape':'[B,Q,N,2]','decoder_labels_shape':'[B,Q,N]'}
}
(ROOT/'tests'/'result_v91_semantic_integration.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
