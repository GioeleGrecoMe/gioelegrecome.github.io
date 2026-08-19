import test from 'node:test';
import assert from 'node:assert/strict';

import {SlamEngine} from '../js/slam/slam_engine.js';

/**
 * Runtime regression for the on-device V30.11.3 failure that only appeared
 * after metric lock. A syntax check cannot detect using `this` before super()
 * in a derived constructor, so this test must instantiate SlamEngine and drive
 * the first metric/tracking calls exactly as the Scan transition does.
 */
test('SlamEngine derived constructor is runtime-safe after metric lock',()=>{
  const frontend={
    process(){
      return {
        count:3,
        features:[{x:1,y:1}],
        matches:{count:1,items:[{dx:2,dy:-1}]}
      };
    }
  };

  const slam=new SlamEngine({
    frontend,
    K:{fx:320,fy:320,cx:160,cy:240,width:320,height:480},
    keyframeIntervalMs:1
  });

  let metricEvent=false;
  slam.addEventListener('metric',()=>{metricEvent=true;});
  slam.setMetricScale(1);
  const result=slam.process({
    gray:new Uint8Array(320*2),
    width:320,
    height:2,
    at:1
  });

  assert.equal(metricEvent,true);
  assert.equal(result.metricLocked,true);
  assert.equal(result.matches,1);
  assert.equal(result.keyframes,1);
  assert.equal(slam.metricScale,1);
});
