'use strict';
// Regression test for Depth Anything ONNX preprocessing. The ONNX Community
// export may expose static numeric H/W or symbolic dynamic dimensions depending
// on conversion/runtime. The worker must honor static metadata and only use the
// aspect-preserving DPT policy for dynamic input shapes.
const fs=require('fs');
const vm=require('vm');
const src=fs.readFileSync('depth_ai_worker.js','utf8');
for(const token of ['function modelInputShapeHint()', 'session.inputMetadata', "inputShapeMode: shapeHint.static ? 'static' : 'aspect-dynamic'", 'function inputShapeForSource']){
  if(!src.includes(token)) throw new Error('missing worker shape token: '+token);
}

function extractFunction(name){
  const start=src.indexOf('function '+name+'(');
  if(start<0) throw new Error('function not found '+name);
  const brace=src.indexOf('{',start);
  let depth=0, i=brace;
  for(;i<src.length;i++){
    if(src[i]==='{') depth++;
    else if(src[i]==='}' && --depth===0){i++;break;}
  }
  return src.slice(start,i);
}
const context={inputSize:518, session:null, Math};
vm.createContext(context);
vm.runInContext(extractFunction('constrainMultiple')+'\n'+extractFunction('inputShapeForSource')+'\n'+extractFunction('modelInputShapeHint'),context);
const dyn=context.inputShapeForSource(384,216);
if(dyn.width%14 || dyn.height%14) throw new Error('dynamic shape not multiple of 14');
if(dyn.width!==518 || dyn.height!==294) throw new Error('unexpected landscape dynamic shape '+JSON.stringify(dyn));
context.session={inputMetadata:[{shape:[1,3,518,518]}]};
let hint=context.modelInputShapeHint();
if(!hint.static || hint.width!==518 || hint.height!==518) throw new Error('static metadata not honored '+JSON.stringify(hint));
context.session={inputMetadata:[{shape:[1,3,'height','width']}]};
hint=context.modelInputShapeHint();
if(hint.static) throw new Error('symbolic metadata must stay dynamic '+JSON.stringify(hint));
console.log(JSON.stringify({status:'PASS',dynamicLandscape:dyn,staticShape:[518,518],symbolicDynamic:true},null,2));
