# V30.38.1 test report

- Node regression suite: 170/171 PASS.
- Only failure: `models/model_q4.onnx` is absent by design from the supplied project.
- SLAM dynamic-import closure test: PASS.
- `SlamEngine` real ESM import with query build tag: PASS.
- Layout: PASS, 227 files under one v30 root.
- Dependency closure: PASS, 50 local references resolved.
- EventTarget constructors: PASS 5/5.
- Mock UI boot: PASS.
- AlvaAR runtime contract: PASS.
- Public TUM validation: PASS, 98.84% feature precision, 100% recall, 6/6 photo connectivity, 15 photo edges, 6 loops.
- Depth diagnostics: PASS.
