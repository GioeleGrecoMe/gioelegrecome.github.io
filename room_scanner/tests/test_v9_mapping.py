import math, random, statistics, json
random.seed(7)

def logistic(x): return 1/(1+math.exp(-x))
def prob(views,w,native,free,reject,rs,rc,local=.8):
    score=-1.85+1.03*max(0,views-1)+.66*min(5,rs)+.19*min(10,w)+.52*min(4,native)+.55*(local-.45)-1.02*min(6,rc)-.68*min(8,free)-.39*min(8,reject)
    return logistic(score)

# True surface: repeated independent confirmations should become stable.
true=[]
for views in range(1,7):
    true.append(prob(views, w=views*.85, native=0, free=0, reject=0, rs=views, rc=0, local=.92))
assert true[0] < .5
assert true[2] > .72, true
assert true[-1] > .95, true

# Ghosts: one accidental depth sample followed by contradictory views should die.
ghost=prob(views=1,w=.9,native=0,free=1,reject=1,rs=0,rc=3,local=.2)
assert ghost < .12, ghost

# Occlusion is deliberately neutral: no contradiction count, so an old stable point
# is not destroyed merely because a foreground object appears in front of it.
occluded=prob(views=4,w=4,native=0,free=0,reject=0,rs=4,rc=0,local=.9)
assert occluded > .9

# Corner layers must have distinct normal buckets even in the same position cell.
def bucket(n):
    x,y,z=n; ax,ay,az=map(abs,n)
    if ax>=ay and ax>=az: return 'px' if x>=0 else 'nx'
    if ay>=az: return 'py' if y>=0 else 'ny'
    return 'pz' if z>=0 else 'nz'
assert bucket((1,0,0)) != bucket((0,1,0)) != bucket((0,0,1))

# Adaptive densification: new geometry, large depth/RGB residuals or semantic
# boundaries become fine surfels; an explained stable region stays coarse.
def fine(new,depth,rgb,boundary): return new or depth>.070 or rgb>.22 or boundary>=.55
assert fine(True,0,0,0)
assert fine(False,.09,0,0)
assert fine(False,0,.30,0)
assert fine(False,0,0,.9)
assert not fine(False,.02,.05,.1)

print(json.dumps({
  'status':'PASS',
  'true_surface_probability_by_views':[round(x,4) for x in true],
  'ghost_probability':round(ghost,4),
  'occluded_stable_probability':round(occluded,4),
  'normal_buckets':[bucket((1,0,0)),bucket((0,1,0)),bucket((0,0,1))]
},indent=2))
