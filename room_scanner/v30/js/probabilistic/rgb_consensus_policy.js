/**
 * RGB consensus policy shared by optimizer statistics and commit gating.
 *
 * V30.43 tightens only the COMMIT criterion. A trajectory may continue to be
 * optimized with mostly weak photo edges, but dense geometry is not allowed to
 * become authoritative when only a handful of whole-photo edges are active.
 */
export function evaluateRgbConsensusPolicy(edgeSwitches={}){
  const edges=Math.max(0,Number(edgeSwitches.edges)||0),active=Math.max(0,Number(edgeSwitches.active)||0),weak=Math.max(0,Number(edgeSwitches.weak)||0),rejected=Math.max(0,Number(edgeSwitches.rejected)||0),mean=Math.max(0,Number(edgeSwitches.mean)||0),rejectedFraction=rejected/Math.max(1,edges),activeFraction=active/Math.max(1,edges);
  const collapsed=edges>=8&&active===0&&rejectedFraction>=.65&&mean<.12;
  // V30.42 required only 8% active edges: the real 117-frame failure passed
  // with 4/42 active edges. Require a distributed active backbone, while still
  // allowing a very high-mean / low-rejection graph to pass without every edge.
  const requiredActive=edges<8?Math.max(1,Math.ceil(edges*.12)):Math.max(2,Math.ceil(edges*.18));
  const distributedActive=active>=requiredActive&&activeFraction>=.15&&mean>=.20&&rejectedFraction<=.45;
  const globallyStrong=mean>=.46&&rejectedFraction<.22&&active>=Math.max(1,Math.ceil(edges*.10));
  const commitReady=edges<6||distributedActive||globallyStrong;
  return {edges,active,weak,rejected,mean,rejectedFraction,activeFraction,requiredActive,collapsed,commitReady,distributedActive,globallyStrong};
}
