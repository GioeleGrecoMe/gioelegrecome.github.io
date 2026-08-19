import {downloadBlob} from './logger.js';

export function gaussianSnapshotToPly(snapshot){
  const a=snapshot?.data instanceof Float32Array?snapshot.data:new Float32Array(snapshot?.data||0),stride=snapshot?.stride||16,n=Math.floor(a.length/stride);
  const header=`ply\nformat binary_little_endian 1.0\ncomment Room Scanner V30 Gaussian RGB\nelement vertex ${n}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nproperty float scale_x\nproperty float scale_y\nproperty float scale_z\nproperty float opacity\nend_header\n`;
  const hb=new TextEncoder().encode(header),row=3*4+3+4*4,buf=new ArrayBuffer(hb.length+n*row),u8=new Uint8Array(buf);u8.set(hb);const dv=new DataView(buf);let o=hb.length;
  for(let i=0;i<n;i++){const s=i*stride;for(let k=0;k<3;k++){dv.setFloat32(o,a[s+k],true);o+=4;}u8[o++]=Math.round(Math.max(0,Math.min(1,a[s+9]))*255);u8[o++]=Math.round(Math.max(0,Math.min(1,a[s+10]))*255);u8[o++]=Math.round(Math.max(0,Math.min(1,a[s+11]))*255);for(let k=3;k<6;k++){dv.setFloat32(o,a[s+k],true);o+=4;}dv.setFloat32(o,a[s+12]||.5,true);o+=4;}
  return new Blob([buf],{type:'application/octet-stream'});
}
export function downloadPly(snapshot,name='roomscan-v30-gaussians.ply'){downloadBlob(gaussianSnapshotToPly(snapshot),name);}

export async function parsePly(file){
  const buf=await file.arrayBuffer(),u8=new Uint8Array(buf),text=new TextDecoder().decode(u8.subarray(0,Math.min(u8.length,65536))),end=text.indexOf('end_header\n');if(end<0)throw new Error('PLY header missing');const header=text.slice(0,end+11),count=Number((/element vertex\s+(\d+)/.exec(header)||[])[1]||0);if(!count)throw new Error('PLY vertex count missing');
  if(/format ascii/.test(header))return parseAscii(header,text.slice(end+11),count);
  if(!/format binary_little_endian/.test(header))throw new Error('Only ASCII or binary little-endian PLY supported');
  const props=[...header.matchAll(/^property\s+(\w+)\s+(\w+)/gm)].map(m=>({type:m[1],name:m[2]}));let row=0;for(const p of props)row+=p.type==='uchar'?1:4;const dv=new DataView(buf),base=new TextEncoder().encode(header).length,out=new Float32Array(count*16);for(let i=0;i<count;i++){let o=base+i*row,s=i*16;const val={};for(const p of props){if(p.type==='uchar'){val[p.name]=dv.getUint8(o);o+=1;}else{val[p.name]=dv.getFloat32(o,true);o+=4;}}out[s]=val.x||0;out[s+1]=val.y||0;out[s+2]=val.z||0;out[s+3]=val.scale_x||.02;out[s+4]=val.scale_y||.02;out[s+5]=val.scale_z||.02;out[s+6]=0;out[s+7]=1;out[s+8]=0;out[s+9]=(val.red??180)/255;out[s+10]=(val.green??180)/255;out[s+11]=(val.blue??180)/255;out[s+12]=val.opacity??.65;out[s+13]=1;out[s+14]=1;}
  return {data:out,stride:16,count};
}
function parseAscii(header,body,count){const props=[...header.matchAll(/^property\s+\w+\s+(\w+)/gm)].map(m=>m[1]),lines=body.trim().split(/\r?\n/),out=new Float32Array(count*16);for(let i=0;i<Math.min(count,lines.length);i++){const x=lines[i].trim().split(/\s+/).map(Number),v=Object.fromEntries(props.map((p,j)=>[p,x[j]])),s=i*16;out[s]=v.x||0;out[s+1]=v.y||0;out[s+2]=v.z||0;out[s+3]=v.scale_x||.02;out[s+4]=v.scale_y||.02;out[s+5]=v.scale_z||.02;out[s+6]=0;out[s+7]=1;out[s+8]=0;out[s+9]=(v.red??180)/255;out[s+10]=(v.green??180)/255;out[s+11]=(v.blue??180)/255;out[s+12]=v.opacity??.65;out[s+13]=1;out[s+14]=1;}return {data:out,stride:16,count};}

/* R30 container: small JSON manifest + binary entries. Gaussian floats are a
 * binary entry (not millions of JSON numbers), keeping export memory bounded. */
export function makeR30({manifest,keyframes=[],gaussians=null,imu=[]}){
  const entries=[];for(const k of keyframes)if(k.blob)entries.push({name:`keyframes/${k.id}.jpg`,blob:k.blob});
  if(gaussians?.data){const bytes=gaussians.data.buffer.slice(gaussians.data.byteOffset,gaussians.data.byteOffset+gaussians.data.byteLength);entries.push({name:'map/gaussians.f32',blob:new Blob([bytes],{type:'application/octet-stream'})});}
  const meta={...manifest,imu,gaussianStride:gaussians?.stride||16,gaussianCount:gaussians?.count||0,entries:[]};let offset=0;for(const e of entries){meta.entries.push({name:e.name,offset,length:e.blob.size,type:e.blob.type});offset+=e.blob.size;}const json=new TextEncoder().encode(JSON.stringify(meta)),head=new ArrayBuffer(12),dv=new DataView(head);['R','3','0','1'].forEach((c,i)=>dv.setUint8(i,c.charCodeAt(0)));dv.setUint32(4,json.length,true);dv.setUint32(8,entries.length,true);return new Blob([head,json,...entries.map(e=>e.blob)],{type:'application/octet-stream'});
}
export async function parseR30(file){
  const buf=await file.arrayBuffer(),dv=new DataView(buf);if(buf.byteLength<12||String.fromCharCode(...new Uint8Array(buf,0,4))!=='R301')throw new Error('Not a Room Scanner V30 .r30 file');const jsonLen=dv.getUint32(4,true),entryCount=dv.getUint32(8,true),jsonStart=12,jsonEnd=jsonStart+jsonLen;if(jsonEnd>buf.byteLength)throw new Error('Corrupt R30 metadata length');const meta=JSON.parse(new TextDecoder().decode(new Uint8Array(buf,jsonStart,jsonLen)));let o=jsonEnd;const entries={};for(let i=0;i<Math.min(entryCount,meta.entries?.length||0);i++){const e=meta.entries[i];entries[e.name]=new Blob([buf.slice(o,o+e.length)],{type:e.type||'application/octet-stream'});o+=e.length;}
  let gaussians=null;const gb=entries['map/gaussians.f32'];if(gb){const ab=await gb.arrayBuffer(),data=new Float32Array(ab),stride=meta.gaussianStride||16;gaussians={data,stride,count:Math.floor(data.length/stride)};}
  return {meta,entries,gaussians};
}
