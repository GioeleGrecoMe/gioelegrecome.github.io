// V30.40 OPT UNICO robust-bootstrap closure: republished atomically with the single optimizer runtime.
// V30.38.1: explicitly shipped with the SLAM dynamic-import closure to prevent mixed-build module graphs.
/**
 * V30.28 pose uncertainty helpers.
 *
 * Alva remains the online trajectory authority, but a pose is represented as a
 * Gaussian prior rather than an exact transform. The diagonal 6-vector is
 * [tx,ty,tz, rx,ry,rz] variance; rotations use small-angle radians.
 */
export function estimatePoseCovariance({metricLocked=false,alvaPoints=0,matches=0,trackingMode='',relocalized=false,lostFrames=0}={}){
  const pts=Math.max(0,Number(alvaPoints)||0),m=Math.max(0,Number(matches)||0);
  const visual=Math.max(.15,Math.min(1,(Math.log1p(pts)/Math.log(500))*.72+(Math.log1p(m)/Math.log(180))*.28));
  const relocalPenalty=relocalized||/relocalized/i.test(trackingMode)?1.8:1;
  const lostPenalty=1+Math.min(2,Math.max(0,Number(lostFrames)||0)*.12);
  // Metric mode numbers are intentionally conservative. In Alva free-scale
  // mode they are in Alva world units, but still provide relative information.
  const tStd=(metricLocked?.006:.008)*(1.65-.65*visual)*relocalPenalty*lostPenalty;
  const rStd=.0035*(1.7-.7*visual)*relocalPenalty*lostPenalty;
  return {
    diag:[tStd*tStd,tStd*tStd,tStd*tStd,rStd*rStd,rStd*rStd,rStd*rStd],
    translationStd:tStd,rotationStdRad:rStd,quality:visual,
    source:'alvaar-probabilistic-prior'
  };
}

/** Add first-order camera pose uncertainty to a 3D point covariance. */
export function addPoseUncertaintyToPointCovariance(cov,poseCov,point,origin){
  const c=validCov(cov)?cov.slice(0,6):[1e-4,0,0,1e-4,0,1e-4];
  const d=Array.isArray(poseCov?.diag)?poseCov.diag:poseCov;
  if(!Array.isArray(d)||d.length<6||!point||!origin)return c;
  const rx=point[0]-origin[0],ry=point[1]-origin[1],rz=point[2]-origin[2];
  const tx=Math.max(0,+d[0]||0),ty=Math.max(0,+d[1]||0),tz=Math.max(0,+d[2]||0);
  const qx=Math.max(0,+d[3]||0),qy=Math.max(0,+d[4]||0),qz=Math.max(0,+d[5]||0);
  // J_rot = -[r]_x. For diagonal angle covariance the induced covariance is
  // the sum of three outer products of the infinitesimal rotation columns.
  const ax=[0,-rz,ry],ay=[rz,0,-rx],az=[-ry,rx,0];
  const out=c.slice();out[0]+=tx;out[3]+=ty;out[5]+=tz;
  addOuter(out,ax,qx);addOuter(out,ay,qy);addOuter(out,az,qz);
  return out;
}
function addOuter(c,v,w){if(!(w>0))return;c[0]+=w*v[0]*v[0];c[1]+=w*v[0]*v[1];c[2]+=w*v[0]*v[2];c[3]+=w*v[1]*v[1];c[4]+=w*v[1]*v[2];c[5]+=w*v[2]*v[2];}
function validCov(c){return Array.isArray(c)&&c.length>=6&&c.slice(0,6).every(Number.isFinite);}
