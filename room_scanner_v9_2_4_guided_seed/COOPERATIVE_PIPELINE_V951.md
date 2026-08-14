# Cooperative mobile reconstruction pipeline

```
WebXR compositor / pose              device rate
        |
        +-- camera RGB ----------------------------+
        |                                           |
        +-- XR depth / planes / meshes -- 10 Hz --> surfels --> Gaussian preview
        |                                           ^              |
        |                                           |              +--> live surfaces
        |                                           |
        +-- user tap -> freeze ONE RGB-D frame -> MobileSAM mask --+
        |
        +-- motion-gated RGB-D keyframes -> DepthAI worker (periodic)
                                              |
                                  XR metric alignment / rejection
                                              |
                                    low-weight detail surfels
```

### Scheduling rules

1. XR never waits for an AI result.
2. SAM and DepthAI never infer simultaneously (`aiCoordinator`).
3. Explicit SAM user actions have priority.
4. DepthAI runs only on a worker and only under acceptable realtime load.
5. During acoustic measurement DepthAI is allowed only in quiet/tail/pause states;
   chirp emission has priority.
6. Strict solver geometry and permissive visualization remain separate.
