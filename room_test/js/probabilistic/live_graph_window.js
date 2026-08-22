/**
 * Build a bounded evidence graph for the live worker.
 *
 * Post-scan optimisation still receives the complete factor graph. During
 * acquisition we keep the latest local window plus a few old loop-closure
 * endpoints, which bounds structured-clone cost and CPU on mobile devices.
 */
export function buildLiveGraphWindow(graph,{maxFrames=18,maxLoopFrames=6,recentLoopSeeds=6,includePhotoPixels=false}={}){
  if(!graph?.frames?.length)return {...graph,frames:[],edgeFactors:[],alvaFactors:[],landmarkFactors:[],deepFactors:[],mvsFactors:[],summary:summaryOf({})};
  const frames=graph.frames,baseStart=Math.max(0,frames.length-Math.max(4,maxFrames|0)),selected=new Set(frames.slice(baseStart).map(f=>String(f.frameId))),recent=new Set(frames.slice(Math.max(0,frames.length-Math.max(2,recentLoopSeeds|0))).map(f=>String(f.frameId)));
  const candidates=[];for(const e of graph.edgeFactors||[]){const a=String(e.aId??e.a??''),b=String(e.bId??e.b??'');if(!a||!b)continue;const old=recent.has(a)&&!selected.has(b)?b:recent.has(b)&&!selected.has(a)?a:null;if(!old)continue;candidates.push({id:old,score:(e.loop?2:0)+Number(e.visualConfidence??e.weight??0)});}
  candidates.sort((a,b)=>b.score-a.score);for(const x of candidates.slice(0,Math.max(0,maxLoopFrames|0)))selected.add(x.id);
  // Keep chronological order and immediate neighbours around reintroduced loop
  // endpoints. This helps relative Alva edges remain well-conditioned.
  const index=new Map(frames.map((f,i)=>[String(f.frameId),i]));for(const id of [...selected]){const i=index.get(id);if(i==null)continue;if(i>0&&selected.size<maxFrames+maxLoopFrames+4)selected.add(String(frames[i-1].frameId));if(i+1<frames.length&&selected.size<maxFrames+maxLoopFrames+4)selected.add(String(frames[i+1].frameId));}
  const chosen=frames.filter(f=>selected.has(String(f.frameId))).map(f=>includePhotoPixels?f:stripPhotoPixels(f)),ids=new Set(chosen.map(f=>String(f.frameId))),edgeFactors=(graph.edgeFactors||[]).filter(e=>ids.has(String(e.aId??e.a))&&ids.has(String(e.bId??e.b))),alvaFactors=(graph.alvaFactors||[]).filter(e=>ids.has(String(e.aId))&&ids.has(String(e.bId))),landmarkFactors=[];
  for(const l of graph.landmarkFactors||[]){const measurements=(l.measurements||[]).filter(m=>ids.has(String(m.frameId)));if(measurements.length>=2)landmarkFactors.push({...l,measurements});}
  const deepFactors=(graph.deepFactors||[]).filter(d=>ids.has(String(d.frameId))),mvsFactors=(graph.mvsFactors||[]).filter(d=>ids.has(String(d.frameId))).map(m=>({...m,sourceFrames:(m.sourceFrames||[]).filter(id=>ids.has(String(id)))})),out={...graph,frames:chosen,edgeFactors,alvaFactors,landmarkFactors,deepFactors,mvsFactors};out.summary=summaryOf(out);out.windowDiagnostics={selectedFrameIds:chosen.map(f=>String(f.frameId)),selectedFrames:chosen.length,totalFrames:frames.length,excludedFrames:Math.max(0,frames.length-chosen.length),baseStart,oldLoopFrames:chosen.filter(f=>(index.get(String(f.frameId))??frames.length)<baseStart).map(f=>String(f.frameId)),includePhotoPixels:!!includePhotoPixels,edges:{rgb:edgeFactors.length,alva:alvaFactors.length},evidence:{landmarks:landmarkFactors.length,deepFrames:deepFactors.length,mvsFactors:mvsFactors.length}};return out;
}
function stripPhotoPixels(f){if(!f?.photo)return f;const p=f.photo;return {...f,gray:new Uint8Array(0),photo:{...p,gray:new Uint8Array(0),rgb:new Uint8Array(0)}};}
function summaryOf(g){const frames=g.frames?.length||0,landmarks=g.landmarkFactors?.length||0,featureObservations=(g.landmarkFactors||[]).reduce((n,l)=>n+(l.measurements?.length||0),0),mvsSamples=(g.mvsFactors||[]).reduce((n,m)=>n+(m.count??m.samples?.length??0),0);return {frames,photoEdges:g.edgeFactors?.length||0,alvaEdges:g.alvaFactors?.length||0,landmarks,featureObservations,deepFrames:g.deepFactors?.length||0,mvsSamples,cameraFixed:!!g.cameraModel,bytesApprox:null,liveWindow:true};}
