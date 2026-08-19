import {SlamEngine} from '../js/slam/slam_engine.js';
const engine=new SlamEngine({reset(){}}),descriptor=new Uint8Array([1,2,3,4]);engine.currentTracks={K:{width:100,height:200,cx:50,cy:100},trackIds:[17],xs:new Uint16Array([51]),ys:new Uint16Array([99]),descriptors:descriptor,descriptorBytes:4};
const visual=engine.pinCenter();if(!visual.ok||visual.metric||visual.mark.kind!=='visual-pending-depth'||visual.mark.trackId!==17||visual.mark.descriptor?.[3]!==4)throw new Error(`visual markpoint rejected ${JSON.stringify(visual)}`);
engine.landmarks.set(17,{p:[1,2,3],views:2});const metric=engine.pinCenter();if(!metric.ok||!metric.metric||metric.mark.kind!=='metric'||metric.mark.p[2]!==3)throw new Error(`metric markpoint failed ${JSON.stringify(metric)}`);
console.log('PASS slam_markpoints');
