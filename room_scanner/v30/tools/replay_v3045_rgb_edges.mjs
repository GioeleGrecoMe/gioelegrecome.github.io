import fs from 'node:fs';
import {ProbabilisticFactorGraph} from '../js/probabilistic/factor_graph.js';
import {estimatePhotoTranslationDirection} from '../js/probabilistic/rgb_translation_direction.js';
const file=process.argv[2]||'/mnt/data/roomscan-1787388793897.r30';
const session=JSON.parse(fs.readFileSync(file,'utf8'));const raw=session.evidence?.factorGraph||session.factorGraph;if(!raw)throw new Error('factor graph missing');
const g=ProbabilisticFactorGraph.fromState(raw),fm=new Map(g.frames.map(f=>[String(f.frameId),f]));let valid=0,rows=[];
for(const e of g.edgeFactors){const r=estimatePhotoTranslationDirection(e,fm.get(String(e.aId)),fm.get(String(e.bId)));if(r){valid++;rows.push(r);}}
const med=a=>{a=a.filter(Number.isFinite).sort((x,y)=>x-y);return a.length?a[a.length>>1]:null};
console.log(JSON.stringify({edges:g.edgeFactors.length,validTranslationEdges:valid,audit:g.photoEdgeAudit,medianResidualDeg:med(rows.map(x=>x.medianEpipolarResidualRad*180/Math.PI)),medianParallaxDeg:med(rows.map(x=>x.medianParallaxRad*180/Math.PI)),medianConfidence:med(rows.map(x=>x.confidence))},null,2));
if(valid<40)process.exitCode=2;
