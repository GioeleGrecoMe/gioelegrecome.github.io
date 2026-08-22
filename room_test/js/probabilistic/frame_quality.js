const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

/**
 * Cheap, image-only acquisition quality diagnostics.
 * These numbers never place a camera or a photograph; they only decide how
 * much authority a frozen RGB frame is allowed to have in later geometry.
 */
export function assessRgbFrameQuality(gray,width,height,{cellCols=6,cellRows=4}={}){
  if(!gray?.length||!(width>4&&height>4))return {score:0,blurScore:0,exposureScore:0,textureCoverage:0,clippedFraction:1,mean:0,severe:true};
  const step=Math.max(1,Math.floor(Math.max(width,height)/420)),cells=new Float64Array(cellCols*cellRows),counts=new Uint32Array(cells.length);let sum=0,sum2=0,n=0,clip=0,gSum=0,g2=0,gn=0;
  for(let y=1;y<height-1;y+=step)for(let x=1;x<width-1;x+=step){const i=y*width+x,v=gray[i];sum+=v;sum2+=v*v;n++;if(v<7||v>248)clip++;const gx=(gray[i+1]-gray[i-1])*.5,gy=(gray[i+width]-gray[i-width])*.5,g=Math.hypot(gx,gy);gSum+=g;g2+=g*g;gn++;const cx=clamp(Math.floor(x/width*cellCols),0,cellCols-1),cy=clamp(Math.floor(y/height*cellRows),0,cellRows-1),ci=cy*cellCols+cx;cells[ci]+=g;counts[ci]++;}
  const mean=n?sum/n:0,variance=n?Math.max(0,sum2/n-mean*mean):0,clippedFraction=n?clip/n:1,gradientMean=gn?gSum/gn:0,gradientStd=gn?Math.sqrt(Math.max(0,g2/gn-gradientMean*gradientMean)):0;
  let textured=0,validCells=0;for(let i=0;i<cells.length;i++)if(counts[i]){validCells++;if(cells[i]/counts[i]>5.0)textured++;}const textureCoverage=validCells?textured/validCells:0;
  // The thresholds are deliberately soft. A white wall may be geometrically
  // useful only together with other structure, so low texture reduces authority
  // instead of deleting the exact RGB+Depth frame from the audit trail.
  const blurScore=clamp((gradientMean-1.6)/10.5,0,1)*clamp((gradientStd-2.0)/16,0,1),centerPenalty=clamp(1-Math.abs(mean-128)/122,0,1),exposureScore=clamp(centerPenalty*(1-1.15*clippedFraction),0,1),textureScore=clamp(.30+.70*textureCoverage,0,1),score=clamp(Math.pow(Math.max(1e-5,blurScore*exposureScore*textureScore),1/3),0,1),severe=clippedFraction>.72||gradientMean<.75||score<.10;
  return {score,blurScore,exposureScore,textureCoverage,clippedFraction,mean,variance,gradientMean,gradientStd,severe};
}
