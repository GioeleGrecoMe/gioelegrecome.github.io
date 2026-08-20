V30.18 default depth model: depth_anything_v2_small_q4f16.onnx.
It is loaded directly by ONNX Runtime Web after the user presses “Prova
inferenza” or begins a scan. The file must expose one NCHW pixel_values input and
one dense depth output. MobileSAM encoder/decoder files are segmentation assets,
not interchangeable depth models. Core AlvaAR tracking, storage, viewer and
PLY/R30 loading remain usable if a neural model/runtime is unavailable.
