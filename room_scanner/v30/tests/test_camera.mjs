import {fitAnalysisSize} from '../js/camera.js';
for(const [w,h,expect] of [[720,1280,[270,480]],[1280,720,[320,180]],[1080,1920,[270,480]]]){const got=fitAnalysisSize(w,h,{maxWidth:320,maxHeight:480});if(got.width!==expect[0]||got.height!==expect[1]||got.width>320||got.height>480)throw new Error(`bad fit ${w}x${h}: ${JSON.stringify(got)}`);}
console.log('PASS camera_analysis_fit');
