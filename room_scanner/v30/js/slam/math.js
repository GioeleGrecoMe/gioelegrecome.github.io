export function qNormalize(q){const n=Math.hypot(...q)||1;return q.map(x=>x/n)}
export function qConj(q){return [-q[0],-q[1],-q[2],q[3]]}
export function qMul(a,b){return [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]]}
export function qRotate(q,v){q=qNormalize(q);const [x,y,z,w]=q,tx=2*(y*v[2]-z*v[1]),ty=2*(z*v[0]-x*v[2]),tz=2*(x*v[1]-y*v[0]);return [v[0]+w*tx+(y*tz-z*ty),v[1]+w*ty+(z*tx-x*tz),v[2]+w*tz+(x*ty-y*tx)]}
export function projectPoint(pose,K,P){const q=qConj(qNormalize(pose.q)),d=[P[0]-pose.p[0],P[1]-pose.p[1],P[2]-pose.p[2]],c=qRotate(q,d);if(c[2]<=1e-8)return null;return {u:K.fx*c[0]/c[2]+K.cx,v:K.fy*c[1]/c[2]+K.cy,z:c[2]}}
export function pixelRay(K,u,v){const x=(u-K.cx)/K.fx,y=(v-K.cy)/K.fy,n=Math.hypot(x,y,1)||1;return [x/n,y/n,1/n]}
