import json, math

# Semantic fallback regression: a clean depth discontinuity must be a boundary,
# while constant-depth interiors must remain mostly unmarked.
cols, rows = 32, 24
depth = [2.0 if x < cols//2 else 3.2 for y in range(rows) for x in range(cols)]
DEPTH_EDGE_BASE = 0.095

def edge(i,j):
    a,b=depth[i],depth[j]
    if not (a>0 and b>0): return True
    tol=DEPTH_EDGE_BASE + 0.025*min(a,b)
    return abs(a-b)>tol

boundary=[0]*(cols*rows)
for y in range(rows):
    for x in range(cols):
        i=y*cols+x
        ns=[]
        if x+1<cols: ns.append(i+1)
        if x: ns.append(i-1)
        if y+1<rows: ns.append(i+cols)
        if y: ns.append(i-cols)
        if any(edge(i,j) for j in ns): boundary[i]=1
split_hits=sum(boundary[y*cols+cols//2-1] or boundary[y*cols+cols//2] for y in range(rows))
interior=sum(boundary[y*cols+x] for y in range(2,rows-2) for x in list(range(2,cols//2-3))+list(range(cols//2+3,cols-2)))

# Structural regression: Manhattan estimator must recover two orthogonal wall families.
theta_true=math.radians(17.0)
planes=[]
for k in range(12):
    a=theta_true + (k%2)*math.pi/2 + math.radians(((k*7)%5-2)*0.25)
    planes.append({'kind':'wall','normal':[math.cos(a),0,math.sin(a)],'confidence':0.75+0.02*(k%4)})
sx=sz=0.0
for p in planes:
    n=p['normal']; a=math.atan2(n[2],n[0]); w=p['confidence']
    sx += math.cos(4*a)*w; sz += math.sin(4*a)*w
theta=.25*math.atan2(sz,sx)
# Manhattan orientation has pi/2 periodicity.
def periodic_err(a,b,period=math.pi/2):
    d=(a-b+period/2)%period-period/2
    return abs(d)
err_deg=math.degrees(periodic_err(theta,theta_true))

# Simple connected occupancy component: furniture-sized block should survive,
# isolated cells should not become a primitive.
cell=0.14
occupied=set()
for ix in range(4,9):
    for iy in range(2,6):
        for iz in range(7,11): occupied.add((ix,iy,iz))
# add isolated noise
occupied |= {(30,2,4),(1,20,5),(17,3,25)}
seen=set(); comps=[]
for seed in list(occupied):
    if seed in seen: continue
    q=[seed]; seen.add(seed); c=[]
    while q:
        a=q.pop(); c.append(a)
        x,y,z=a
        for d in ((1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)):
            b=(x+d[0],y+d[1],z+d[2])
            if b in occupied and b not in seen:
                seen.add(b);q.append(b)
    comps.append(c)
large=[c for c in comps if len(c)>=4]

result={
  'status':'PASS' if split_hits==rows and interior==0 and err_deg<1.0 and len(large)==1 and len(large[0])==80 else 'FAIL',
  'semantic_depth_split_rows_detected':split_hits,
  'semantic_interior_false_edges':interior,
  'manhattan_error_deg':round(err_deg,4),
  'primitive_components':len(large),
  'primitive_support_cells':len(large[0]) if large else 0,
}
print(json.dumps(result,indent=2))
if result['status']!='PASS': raise SystemExit(1)
