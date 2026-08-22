const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

/**
 * Topological/scale-free mesh diagnostics.
 *
 * A reconstruction made of hundreds of tiny TSDF islands can have a low local
 * residual and still be useless as a room surface.  These diagnostics therefore
 * measure connectivity independently of metric scale or rendering quality.
 */
export function analyzeMeshQuality(mesh={}){
  const v=mesh.vertices||[],f=mesh.faces||[],vertexCount=Math.floor(v.length/3),faceCount=Math.floor(f.length/3);
  if(!vertexCount||!faceCount)return {vertexCount,faceCount,usedVertices:0,unusedVertices:vertexCount,componentCount:0,largestComponentVertices:0,largestComponentFraction:0,degenerateFaces:0,bbox:null,edgeMedian:null,edgeP90:null,status:'empty'};
  const adj=Array.from({length:vertexCount},()=>null),used=new Uint8Array(vertexCount),edges=[],areas=[];let degenerate=0;
  const link=(a,b)=>{if(a<0||b<0||a>=vertexCount||b>=vertexCount||a===b)return;(adj[a]||(adj[a]=new Set())).add(b);(adj[b]||(adj[b]=new Set())).add(a);used[a]=used[b]=1;const ax=v[a*3],ay=v[a*3+1],az=v[a*3+2],bx=v[b*3],by=v[b*3+1],bz=v[b*3+2];edges.push(Math.hypot(ax-bx,ay-by,az-bz));};
  for(let i=0;i+2<f.length;i+=3){const a=Number(f[i]),b=Number(f[i+1]),c=Number(f[i+2]);if(!Number.isInteger(a)||!Number.isInteger(b)||!Number.isInteger(c)||a<0||b<0||c<0||a>=vertexCount||b>=vertexCount||c>=vertexCount){degenerate++;continue;}used[a]=used[b]=used[c]=1;const ax=v[a*3],ay=v[a*3+1],az=v[a*3+2],bx=v[b*3],by=v[b*3+1],bz=v[b*3+2],cx=v[c*3],cy=v[c*3+1],cz=v[c*3+2],ab=[bx-ax,by-ay,bz-az],ac=[cx-ax,cy-ay,cz-az],cr=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]],area=.5*Math.hypot(...cr);areas.push(area);if(!(area>1e-12))degenerate++;link(a,b);link(b,c);link(c,a);}
  let usedCount=0;for(const x of used)usedCount+=x?1:0;
  const seen=new Uint8Array(vertexCount),components=[];for(let i=0;i<vertexCount;i++){if(!used[i]||seen[i])continue;const stack=[i];seen[i]=1;let n=0;while(stack.length){const x=stack.pop();n++;for(const y of adj[x]||[]){if(!seen[y]){seen[y]=1;stack.push(y);}}}components.push(n);}components.sort((a,b)=>b-a);
  const mins=[Infinity,Infinity,Infinity],maxs=[-Infinity,-Infinity,-Infinity];for(let i=0;i<vertexCount;i++){if(!used[i])continue;for(let k=0;k<3;k++){const x=Number(v[i*3+k]);if(x<mins[k])mins[k]=x;if(x>maxs[k])maxs[k]=x;}}
  const sortedEdges=edges.filter(Number.isFinite).sort((a,b)=>a-b),largest=components[0]||0,fraction=usedCount?largest/usedCount:0,componentCount=components.length,edgeMedian=quantile(sortedEdges,.5),edgeP90=quantile(sortedEdges,.9),extent=mins[0]===Infinity?null:maxs.map((x,k)=>x-mins[k]),diag=extent?Math.hypot(...extent):0;
  // Scale-free fragmentation classifier.  A room mesh may legitimately contain
  // a few disconnected objects, but not hundreds of tiny islands with no
  // dominant component.
  const surfelFraction=Number(mesh.meshedSurfelFraction),inputSurfels=Number(mesh.inputSurfels)||0,sourceSurfels=Number(mesh.sourceSurfels)||0,evidenceStarved=Number.isFinite(surfelFraction)&&inputSurfels>=20&&surfelFraction<.35,fragmented=evidenceStarved||(faceCount>=20&&((componentCount>=8&&fraction<.35)||(componentCount>=24&&fraction<.55))),coherent=!evidenceStarved&&faceCount>=20&&fraction>=.55;
  return {vertexCount,faceCount,usedVertices:usedCount,unusedVertices:vertexCount-usedCount,componentCount,componentSizes:components.slice(0,24),largestComponentVertices:largest,largestComponentFraction:fraction,degenerateFaces:degenerate,bbox:extent?{min:mins,max:maxs,extent,diagonal:diag}:null,edgeMedian:Number.isFinite(edgeMedian)?edgeMedian:null,edgeP90:Number.isFinite(edgeP90)?edgeP90:null,fragmentationScore:clamp(Math.max(1-fraction,evidenceStarved?1-surfelFraction:0),0,1),inputSurfels,sourceSurfels,meshedSurfelFraction:Number.isFinite(surfelFraction)?surfelFraction:null,evidenceStarved,status:fragmented?'fragmented':coherent?'coherent':'partial'};
}
function quantile(a,q){if(!a.length)return NaN;const x=clamp(q,0,1)*(a.length-1),i=Math.floor(x),t=x-i;return a[i]*(1-t)+a[Math.min(a.length-1,i+1)]*t;}
