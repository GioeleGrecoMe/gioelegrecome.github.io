V30.18.9 default depth model: model_q4.onnx.

It is loaded locally by ONNX Runtime Web after “Prova inferenza” or at the start
of a scan. It must expose one NCHW pixel_values input and one dense depth output.
The application does not silently download a different remote model: if this
file is absent after publication, it shows a direct error. MobileSAM
encoder/decoder files are segmentation assets, not interchangeable depth models.
Core AlvaAR tracking, storage, viewer and PLY/R30 loading remain usable if the
neural model/runtime is unavailable.
