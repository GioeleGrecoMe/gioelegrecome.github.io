import test from 'node:test';
import assert from 'node:assert/strict';
import {refinePosePnP} from '../js/metric/pnp_pose.js';
import {projectPoint,qNormalize} from '../js/slam/math.js';

test('short-lived pin PnP recovers metric camera pose from >=3 known 3D pins',()=>{
  const K={fx:420,fy:418,cx:160,cy:120,width:320,height:240},truth={p:[.15,.08,-.1],q:[0,0,0,1]};
  const pts=[[-.4,-.2,2.2],[.5,-.15,2.5],[-.35,.35,2.8],[.45,.3,3.1],[0,.1,1.9]];
  const observations=pts.map(world=>{const p=projectPoint(truth,K,world);return {world,u:p.u,v:p.v};});
  const initial={p:[.19,.04,-.05],q:qNormalize([.01,-.015,.008,.9998])};
  const out=refinePosePnP({initialPose:initial,K,observations,maxIterations:20,huberPx:10});
  assert.equal(out.ok,true);assert.ok(out.rmsePx<1e-5);assert.ok(Math.hypot(...out.pose.p.map((v,i)=>v-truth.p[i]))<1e-5);
});
