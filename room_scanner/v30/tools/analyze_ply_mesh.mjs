#!/usr/bin/env node
import fs from 'node:fs';
import {analyzeMeshQuality} from '../js/reconstruction/mesh_quality.js?v=30.42.0';

const path=process.argv[2];
if(!path){console.error('usage: node tools/analyze_ply_mesh.mjs <ascii.ply>');process.exit(2);}
const text=fs.readFileSync(path,'utf8'),lines=text.split(/\r?\n/);let i=0,nv=0,nf=0,ascii=false;
for(;i<lines.length;i++){
  const l=lines[i].trim();if(l==='format ascii 1.0')ascii=true;else if(l.startsWith('element vertex '))nv=Number(l.split(/\s+/)[2]);else if(l.startsWith('element face '))nf=Number(l.split(/\s+/)[2]);else if(l==='end_header'){i++;break;}
}
if(!ascii)throw new Error('only ASCII PLY is supported by this diagnostic tool');
const vertices=new Float32Array(nv*3);for(let v=0;v<nv;v++,i++){const a=lines[i].trim().split(/\s+/);vertices[v*3]=Number(a[0]);vertices[v*3+1]=Number(a[1]);vertices[v*3+2]=Number(a[2]);}
const faces=[];for(let f=0;f<nf;f++,i++){const a=lines[i].trim().split(/\s+/).map(Number),n=a[0]|0;if(n<3)continue;for(let k=2;k<n;k++)faces.push(a[1],a[k],a[k+1]);}
console.log(JSON.stringify({file:path,...analyzeMeshQuality({vertices,faces:new Uint32Array(faces)})},null,2));
