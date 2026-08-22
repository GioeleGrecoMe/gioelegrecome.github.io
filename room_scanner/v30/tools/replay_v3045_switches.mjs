import fs from 'node:fs';
import {ProbabilisticFactorGraph} from '../js/probabilistic/factor_graph.js';
import {SwitchablePhotoEdgeModel} from '../js/probabilistic/switchable_edges.js';
const x=JSON.parse(fs.readFileSync(process.argv[2]||'/mnt/data/roomscan-1787388793897.r30','utf8'));const g=ProbabilisticFactorGraph.fromState(x.evidence.factorGraph);for(const f of g.frames)f.poseEstimate=f.poseEstimate||f.posePrior;const m=new SwitchablePhotoEdgeModel(g.edgeFactors);for(let i=0;i<4;i++)m.update(g.frames,g.landmarkFactors,{bootstrap:true});console.log(JSON.stringify({audit:g.photoEdgeAudit,stats:m.stats()},null,2));
if((m.stats().translationDirectionEdges||0)<40)process.exitCode=2;
