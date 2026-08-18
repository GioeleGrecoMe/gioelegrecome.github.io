/**
 * Chooses a compact, diverse subset for expensive monocular-depth inference.
 * RAW still retains every photo; this affects only the optional Deep pass.
 */
export function selectDeepKeyframes(frameBlobs,frameRecords,{maxFrames=46}={}){
  const metaById=new Map((frameRecords||[]).map(r=>[r.value?.id,r.value]));
  const candidates=(frameBlobs||[]).map(blob=>{
    const meta=metaById.get(blob.meta?.id)||blob.meta||{};
    return {blob,meta,score:keyframeScore(meta),position:meta.pose?.position||null};
  }).filter(x=>x.meta?.pose?.matrix&&x.position?.every(Number.isFinite));
  const selected=[],remaining=[...candidates];
  while(remaining.length&&selected.length<maxFrames){
    let bestIndex=0,bestScore=-Infinity;
    for(let i=0;i<remaining.length;i++){
      const candidate=remaining[i],nearest=selected.length?Math.min(...selected.map(s=>distance3(candidate.position,s.position))):.8;
      // A useful frame is sharp/exposed, associated with uncertain tiles and
      // spatially distinct from previously chosen frames. Markpoint/manual
      // requests receive a small priority because they have explicit intent.
      const diversity=Math.min(1,nearest/.52),repeatPenalty=nearest<.16?.55:0;
      const score=candidate.score+.52*diversity-repeatPenalty;
      if(score>bestScore){bestScore=score;bestIndex=i;}
    }
    selected.push(remaining.splice(bestIndex,1)[0]);
  }
  return selected.map(x=>x.blob);
}

function keyframeScore(meta){
  const quality=meta.quality||{},sharp=Math.max(0,Math.min(1,quality.sharpness||0)),exposure=Math.max(0,Math.min(1,quality.exposureScore||0)),links=(meta.linkedTiles||[]),uncertain=Math.min(1,links.filter(t=>t.needDeep||t.status!=='green').length/12),reason=meta.reason==='markpoint'?.24:meta.reason==='manual-deep'?.18:0;
  return .46*sharp+.28*exposure+.26*uncertain+reason;
}
function distance3(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);}
