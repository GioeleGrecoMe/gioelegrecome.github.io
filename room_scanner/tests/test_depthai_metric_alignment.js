const fs=require('fs');
const src=fs.readFileSync('room_scanner_v10.html','utf8');
const start=src.indexOf('function depthAISample('), end=src.indexOf('function depthAIRgbAt(',start);
if(start<0||end<0)throw new Error('DepthAI fit block not found');
const CFG={minDepth:.15,maxDepth:12,depthAIMinAnchors:18,depthAIMaxMedianRelError:.16,depthAIMaxP90RelError:.32};
const clamp01=x=>Math.max(0,Math.min(1,x));
const clampNum=(x,a,b)=>Math.max(a,Math.min(b,x));
eval(src.slice(start,end));
const cautiousStart=src.indexOf('function v10BuildAnchoredReviewFit('),cautiousEnd=src.indexOf('function v10DiscardManualPhoto(',cautiousStart);
if(cautiousStart<0||cautiousEnd<0)throw new Error('V10 cautious review fit not found');
eval(src.slice(cautiousStart,cautiousEnd));
const W=518,H=518,C=32,R=24;
function zAt(u,v){return 1.2+1.7*u+.45*v;}
function makeFrame(){const d=new Float32Array(C*R);for(let y=0;y<R;y++)for(let x=0;x<C;x++)d[y*C+x]=zAt((x+.5)/C,(y+.5)/R);return {cols:C,rows:R,depth:d};}
function makePred(mode){const a=mode==='inverse'?.8:1.7,b=mode==='inverse'?.2:.3,p=new Float32Array(W*H);for(let y=0;y<H;y++)for(let x=0;x<W;x++){const z=zAt(x/(W-1),y/(H-1));p[y*W+x]=mode==='inverse'?(1/z-b)/a:(z-b)/a;}return p;}
const F=makeFrame();
const inv=depthAIFitMetric(F,makePred('inverse'),W,H);if(!inv||inv.mode!=='inverse'||inv.medianRel>.02)throw new Error('inverse fit failed '+JSON.stringify(inv));
const direct=depthAIFitMetric(F,makePred('depth'),W,H);if(!direct||direct.mode!=='depth'||direct.medianRel>.02)throw new Error('direct fit failed '+JSON.stringify(direct));
const bad=new Float32Array(W*H);let seed=1234567;for(let i=0;i<bad.length;i++){seed=(1664525*seed+1013904223)>>>0;bad[i]=.05+3*(seed/0xffffffff);}const reject=depthAIFitMetric(F,bad,W,H);if(reject)throw new Error('uncorrelated depth should be rejected '+JSON.stringify(reject));
const small={cols:3,rows:2,depth:new Float32Array([1.475,1.875,2.275,1.625,2.025,2.425])};
const smallPred=new Float32Array(W*H);for(let y=0;y<H;y++)for(let x=0;x<W;x++){const z=1.2+1.2*x/(W-1)+.3*y/(H-1);smallPred[y*W+x]=(z-.3)/1.7;}
const cautious=v10BuildAnchoredReviewFit(small,smallPred,W,H);if(!cautious||!cautious.manualCautious||cautious.anchors!==6||cautious.medianRel>.05)throw new Error('six-anchor cautious fit failed '+JSON.stringify(cautious));
console.log(JSON.stringify({status:'PASS',inverseMedian:inv.medianRel,directMedian:direct.medianRel,badRejected:true,cautiousAnchors:cautious.anchors,cautiousMedian:cautious.medianRel}));
