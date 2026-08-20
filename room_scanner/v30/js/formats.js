/** Offline import/export helpers for Gaussian PLY and compact .r30 JSON. */
export function gaussiansToPly(items,comment='Room Scanner V30'){
  const gs=normalize(items),lines=['ply','format ascii 1.0',`comment ${comment}`,`element vertex ${gs.length}`,
    'property float x','property float y','property float z','property uchar red','property uchar green','property uchar blue',
    'property float opacity','property float scale','property float scale_x','property float scale_y','property float scale_z',
    'property float cov_xx','property float cov_xy','property float cov_xz','property float cov_yy','property float cov_yz','property float cov_zz',
    'property float confidence','property uint support','end_header'];
  for(const g of gs)lines.push(`${g.p[0]} ${g.p[1]} ${g.p[2]} ${g.c[0]} ${g.c[1]} ${g.c[2]} ${g.a} ${g.r} ${g.scale[0]} ${g.scale[1]} ${g.scale[2]} ${g.cov.join(' ')} ${g.q} ${g.support}`);
  return lines.join('\n')+'\n';
}
export function parsePly(text){
  const lines=String(text).split(/\r?\n/),end=lines.findIndex(x=>x.trim()==='end_header');if(end<0)throw new Error('PLY end_header missing');
  const props=lines.slice(0,end).filter(x=>x.startsWith('property ')).map(x=>x.trim().split(/\s+/).pop()),out=[];
  for(const line of lines.slice(end+1)){if(!line.trim())continue;const v=line.trim().split(/\s+/).map(Number);if(v.length<3)continue;const obj={};props.forEach((p,i)=>obj[p]=v[i]);
    const scale=[obj.scale_x??obj.scale??.02,obj.scale_y??obj.scale??.02,obj.scale_z??obj.scale??.02],cov=[obj.cov_xx,obj.cov_xy,obj.cov_xz,obj.cov_yy,obj.cov_yz,obj.cov_zz];
    out.push({position:[obj.x,obj.y,obj.z],color:[obj.red??180,obj.green??180,obj.blue??180],opacity:obj.opacity??1,scale,covariance:cov.every(Number.isFinite)?cov:null,confidence:obj.confidence??.6,support:obj.support??1,radius:obj.scale??Math.max(...scale)});
  }return out;
}
export function encodeR30(bundle){return new Blob([JSON.stringify({format:'ROOMSCAN-R30-JSON-1',...bundle})],{type:'application/octet-stream'});}
export async function decodeR30(file){const text=await file.text(),x=JSON.parse(text);if(!x||typeof x!=='object')throw new Error('R30 invalid');return x;}
export function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1500);}
function normalize(items){return (items||[]).map(g=>{const p=g.position||g.p||g.mean||g.xyz||[0,0,0],c=g.color||g.rgb||[180,210,240],s=g.scale||g.scales||g.radius||.02,scale=Array.isArray(s)?s.slice(0,3).map(Number):[Number(s),Number(s),Number(s)],r=Math.max(...scale),fallback=[scale[0]*scale[0],0,0,scale[1]*scale[1],0,scale[2]*scale[2]],cov=Array.isArray(g.covariance)&&g.covariance.length>=6?g.covariance.slice(0,6).map(Number):fallback;return {p:p.map(Number),c:c.map(v=>Math.max(0,Math.min(255,Math.round(Number(v)||0)))),a:Number(g.opacity??g.alpha??1),scale:scale.map(x=>Number.isFinite(x)&&x>0?x:.02),r:Number.isFinite(r)&&r>0?r:.02,cov:cov.every(Number.isFinite)?cov:fallback,q:Number(g.confidence??.6),support:Math.max(1,Math.round(Number(g.support)||1))};}).filter(g=>g.p.every(Number.isFinite));}
