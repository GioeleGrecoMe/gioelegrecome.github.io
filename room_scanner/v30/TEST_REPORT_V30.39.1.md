# V30.39.1 test report

Validation was executed on the hotfix work tree.

- Targeted single-optimizer/build contracts: PASS.
- Mock UI: PASS; WebXR failure returns to Home and **Start** proceeds to the mocked camera failure (`navigator.mediaDevices.getUserMedia is not a function`) without the former `stopSurfaceLabWorker` ReferenceError.
- Layout: PASS.
- Local dependency closure: PASS, 50/50 references.
- Depth diagnostics: PASS.
- EventTarget constructors: PASS, 5/5.
- AlvaAR runtime contract: PASS.
- Public TUM validation: PASS; 85/86 correct matches (98.84% precision, 100% recall), 6/6 panorama frames connected, 15 edges, 6 loops, reprojection 2.2912 px -> 0.0332 px.
- Full `npm test`: 171 PASS / 1 FAIL. The sole failure is the existing filesystem assertion for `models/model_q4.onnx`, because `models/` is intentionally absent from the supplied project/patch.
