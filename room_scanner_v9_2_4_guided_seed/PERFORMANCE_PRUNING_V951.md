# Progressive geometry pruning v9.5.1

The previous final-stage cleanup could remove a very large fraction of spatial samples because tentative mono-view points were allowed to accumulate throughout acquisition. v9.5.1 moves the safe part of that work online without making early irreversible decisions.

## Budgets

- Map-keyframe maintenance: bounded by rtOnlinePruneBudgetMs.
- Small realtime slices: sub-millisecond calls from the render loop.
- Packet-boundary maintenance: a cooperative 2-9 ms budget depending on realtime load, with explicit event-loop yields.
- Final processing: cooperative residual validation only.

## Evidence policy

Repeated samples from the same view are not independent evidence. The existence probability is capped by independent view count. Free-space contradictions, reprojection contradictions, local isolation, normal inconsistency, and position jumps reduce confidence.

A young mono-view surfel survives until it has enough opportunities to be observed again. A stale mono-view surfel with sufficient opportunities can be removed online. This reduces final workload while preserving geometry that simply has not yet been revisited.
