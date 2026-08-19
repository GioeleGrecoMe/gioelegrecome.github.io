import {projectionToIntrinsics,xrPoseToSlam,xrPointToSlam,patchDetailScore,projectSlamPointToUv} from '../js/xr/xr_calibration.js';
const proj=new Float32Array(16);proj[0]=2;proj[5]=3;proj[8]=.1;proj[9]=-.2;const K=projectionToIntrinsics(proj,1000,800);if(K.fx!==1000||K.fy!==1200||Math.abs(K.cx-450)>.001||Math.abs(K.cy-480)>.001)throw new Error(JSON.stringify(K));
const T=xrPoseToSlam({position:{x:1,y:2,z:-3},orientation:{x:0,y:0,z:0,w:1}});if(T.p.join(',')!=='1,2,3'||Math.abs(T.q[3]-1)>.001)throw new Error(JSON.stringify(T));const p=xrPointToSlam({x:1,y:2,z:-4});if(p[2]!==4)throw new Error('point convention');
const K2={fx:200,fy:200,cx:100,cy:80,width:200,height:160},uv=projectSlamPointToUv({p:[0,0,0],q:[0,0,0,1]},[0,0,2],K2);if(!uv||Math.abs(uv.u-.5)>.001||Math.abs(uv.v-.5)>.001)throw new Error(`projection ${JSON.stringify(uv)}`);
const blank=new Uint8Array(12*12).fill(120),texture=new Uint8Array(12*12);for(let y=0;y<12;y++)for(let x=0;x<12;x++)texture[y*12+x]=((x*31)^(y*47)^((x+y)&1?180:20))&255;if(!(patchDetailScore(texture,12)>patchDetailScore(blank,12)+5))throw new Error('candidate detail score weak');
console.log('PASS xr_selected_landmark_primitives');
