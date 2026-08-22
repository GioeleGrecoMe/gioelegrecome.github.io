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

/**
 * Remove only tiny disconnected islands after TSDF extraction. The raw mesh
 * quality is still reported separately and the cleanup fraction is used by the
 * final commit gate, so this cannot turn a bad reconstruction into a false PASS.
 */
export function retainMeaningfulMeshComponents(mesh={}, {minVertices=36,minRelativeToLargest=.035,maxComponents=16}={}){
  const V=mesh.vertices||[],F=mesh.faces||[],vertexCount=Math.floor(V.length/3),faceCount=Math.floor(F.length/3);
  if(!vertexCount||!faceCount)return {mesh,stats:{rawVertexCount:vertexCount,rawFaceCount:faceCount,rawComponents:0,keptComponents:0,discardedVertices:0,discardedVertexFraction:0,keptVertices:vertexCount,keptFaces:faceCount}};
  const parent=new Int32Array(vertexCount);for(let i=0;i<vertexCount;i++)parent[i]=i;const used=new Uint8Array(vertexCount),find=x=>{let r=x;while(parent[r]!==r)r=parent[r];while(parent[x]!==x){const n=parent[x];parent[x]=r;x=n;}return r;},join=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[b]=a;};
  for(let i=0;i+2<F.length;i+=3){const a=Number(F[i]),b=Number(F[i+1]),c=Number(F[i+2]);if(!validIndex(a,vertexCount)||!validIndex(b,vertexCount)||!validIndex(c,vertexCount))continue;used[a]=used[b]=used[c]=1;join(a,b);join(b,c);}
  const comps=new Map();for(let i=0;i<vertexCount;i++)if(used[i]){const r=find(i),x=comps.get(r)||{root:r,vertices:[],faces:0};x.vertices.push(i);comps.set(r,x);}for(let i=0;i+2<F.length;i+=3){const a=Number(F[i]);if(validIndex(a,vertexCount)){const x=comps.get(find(a));if(x)x.faces++;}}
  const list=[...comps.values()].sort((a,b)=>b.vertices.length-a.vertices.length),largest=list[0]?.vertices.length||0,threshold=Math.max(Number(minVertices)||36,largest*(Number(minRelativeToLargest)||.035)),keep=new Set(list.filter((c,i)=>i===0||(i<Math.max(1,maxComponents|0)&&c.vertices.length>=threshold)).map(c=>c.root));
  const remap=new Int32Array(vertexCount);remap.fill(-1);const vertices=[],colors=[],keptOld=[];for(let i=0;i<vertexCount;i++){if(!used[i]||!keep.has(find(i)))continue;remap[i]=vertices.length/3;vertices.push(V[i*3],V[i*3+1],V[i*3+2]);keptOld.push(i);if(mesh.colors?.length>=i*3+3)colors.push(mesh.colors[i*3],mesh.colors[i*3+1],mesh.colors[i*3+2]);}
  const faces=[];for(let i=0;i+2<F.length;i+=3){const a=Number(F[i]),b=Number(F[i+1]),c=Number(F[i+2]);if(!validIndex(a,vertexCount)||!validIndex(b,vertexCount)||!validIndex(c,vertexCount))continue;const aa=remap[a],bb=remap[b],cc=remap[c];if(aa>=0&&bb>=0&&cc>=0)faces.push(aa,bb,cc);}
  const keptVertices=vertices.length/3,discardedVertices=Math.max(0,vertexCount-keptVertices),out={...mesh,vertices:new Float32Array(vertices),colors:colors.length?new Uint8Array(colors):new Uint8Array(0),faces:new Uint32Array(faces),componentCleanup:true};
  return {mesh:out,stats:{rawVertexCount:vertexCount,rawFaceCount:faceCount,rawComponents:list.length,componentSizes:list.slice(0,24).map(x=>x.vertices.length),largestComponentVertices:largest,thresholdVertices:threshold,keptComponents:keep.size,keptVertices,keptFaces:faces.length/3,discardedVertices,discardedVertexFraction:vertexCount?discardedVertices/vertexCount:0,maxComponents:Math.max(1,maxComponents|0)}};
}
function validIndex(x,n){return Number.isInteger(x)&&x>=0&&x<n;}
