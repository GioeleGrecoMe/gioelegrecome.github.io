import {V30Database} from '../storage/db.js?v=30.51.0';
import {decodeR30} from '../formats.js?v=30.51.0';
import {ProbabilisticFactorGraph} from '../probabilistic/factor_graph.js?v=30.51.0';

export async function openDiagnosticDatabase(){const db=new V30Database();await db.open();return db;}

export async function listDiagnosticSessions(db){
  const [sessions,snapshots]=await Promise.all([db.getAll('sessions'),db.getAll('snapshots')]);
  const snapById=new Map((snapshots||[]).map(s=>[String(s.id),s]));
  return (sessions||[]).map(s=>({session:s,snapshot:snapById.get(String(s.id))||null})).filter(x=>x.snapshot?.factorGraph?.frames?.length).sort((a,b)=>(b.session.updatedAt||0)-(a.session.updatedAt||0));
}

export async function loadDiagnosticSession(db,id){
  const bundle=await db.loadSessionBundle(id);if(!bundle?.snapshot?.factorGraph)throw new Error('La sessione non contiene un factor graph diagnostico.');
  return normalizeSource({kind:'indexeddb',name:`Sessione ${id}`,session:bundle.session,snapshot:bundle.snapshot,mesh:bundle.mesh,events:bundle.events||[]});
}

export async function loadDiagnosticR30(file){
  const x=await decodeR30(file),graph=x?.evidence?.factorGraph||x?.factorGraph||x?.snapshot?.factorGraph;if(!graph?.frames?.length)throw new Error('Il file R30 non contiene un factor graph con frame.');
  return normalizeSource({kind:'r30',name:file.name||'R30',fileName:file.name||null,r30:x,snapshot:{factorGraph:graph,deepSequence:x?.evidence?.deepSequence||x?.deepSequence||null,probOptimization:x?.evidence?.probOptimization||x?.probOptimization||null,liveOptimization:x?.evidence?.liveOptimization||x?.liveOptimization||null,photoPanorama:x?.evidence?.photoPanorama||x?.photoPanorama||null,geometryCommitted:!!x.geometryCommitted,build:x.build||null},events:[]});
}

export function normalizeSource(src){
  const snapshot=src.snapshot||{},rawGraph=snapshot.factorGraph||{},graph=rawGraph?.frames?.length?ProbabilisticFactorGraph.fromState(rawGraph).exportState():rawGraph;
  return {...src,snapshot,graph,optimizer:snapshot.liveOptimization?.snapshot||snapshot.probOptimization||null,optimizerStats:snapshot.liveOptimization?.stats||snapshot.probOptimization?.stats||null,photoPanorama:snapshot.photoPanorama||null,build:snapshot.build||src.session?.build||src.r30?.build||null};
}
