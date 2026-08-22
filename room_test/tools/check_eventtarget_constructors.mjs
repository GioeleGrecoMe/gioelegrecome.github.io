import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=new URL('../js/',import.meta.url);
const rootPath=fileURLToPath(root);
const files=[];

function walk(dir){
  for(const name of fs.readdirSync(dir)){
    const file=path.join(dir,name);
    const stat=fs.statSync(file);
    if(stat.isDirectory())walk(file);
    else if(file.endsWith('.js'))files.push(file);
  }
}
walk(rootPath);

let checked=0;
const failures=[];
for(const file of files){
  const source=fs.readFileSync(file,'utf8');
  for(const match of source.matchAll(/class\s+(\w+)\s+extends\s+EventTarget\s*\{/g)){
    checked++;
    const className=match[1];
    const tail=source.slice(match.index);
    const ctorIndex=tail.indexOf('constructor');
    if(ctorIndex<0){
      failures.push(`${className}: constructor missing (${path.relative(rootPath,file)})`);
      continue;
    }
    // This intentionally checks ordering in the constructor prefix rather than
    // merely searching for super() somewhere in the class. It catches the
    // V30.11.3 regression where syntax was valid but `this` was touched first.
    const constructorPrefix=tail.slice(ctorIndex,ctorIndex+1200);
    const superIndex=constructorPrefix.indexOf('super(');
    const thisIndex=constructorPrefix.indexOf('this.');
    if(superIndex<0||(thisIndex>=0&&superIndex>thisIndex)){
      failures.push(`${className}: super() is not before first this (${path.relative(rootPath,file)})`);
    }
  }
}

if(failures.length){
  console.error(`FAIL EventTarget constructors · ${failures.length}/${checked}`);
  for(const failure of failures)console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`PASS EventTarget constructors · ${checked}/${checked} derived classes call super() first`);
