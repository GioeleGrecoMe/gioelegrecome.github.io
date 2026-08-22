/**
 * RGB consensus policy shared by optimizer statistics and commit gating.
 *
 * The optimization switches are posterior confidences, not a license to hide
 * residuals.  Live optimization is stopped only for a severe collapse, while
 * committed dense geometry requires a stronger minimum consensus so an
 * Alva-dominated trajectory cannot authorize 3D surface output.
 */
export function evaluateRgbConsensusPolicy(edgeSwitches={}){
  const edges=Math.max(0,Number(edgeSwitches.edges)||0),active=Math.max(0,Number(edgeSwitches.active)||0),weak=Math.max(0,Number(edgeSwitches.weak)||0),rejected=Math.max(0,Number(edgeSwitches.rejected)||0),mean=Math.max(0,Number(edgeSwitches.mean)||0),rejectedFraction=rejected/Math.max(1,edges),activeFraction=active/Math.max(1,edges);
  const collapsed=edges>=8&&active===0&&rejectedFraction>=.65&&mean<.12;
  const requiredActive=Math.max(1,Math.ceil(edges*.08));
  const commitReady=edges<6||((active>=requiredActive)&&mean>=.16)||(mean>=.42&&rejectedFraction<.25);
  return {edges,active,weak,rejected,mean,rejectedFraction,activeFraction,requiredActive,collapsed,commitReady};
}
