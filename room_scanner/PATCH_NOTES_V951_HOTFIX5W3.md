# Room Scanner v9.5.1 Hotfix5W3

## MobileSAM decoder input contract

Fixes a deterministic ONNX Runtime `ORT_INVALID_ARGUMENT` (`OrtRun error code = 2`) in the MobileSAM decoder. H5W2 matched `mask_input` before `has_mask_input`; because `has_mask_input` contains the substring `mask_input`, the decoder received a `[1,1,256,256]` tensor for `has_mask_input` instead of `[1]`.

H5W3 centralizes decoder feed construction in `buildMobileSamDecoderFeeds()` and keeps one contract for both smoke-test and real inference:

- `image_embeddings`: encoder output `[1,256,64,64]`
- `point_coords`: float32 `[1,N,2]`
- `point_labels`: float32 `[1,N]`
- `mask_input`: float32 `[1,1,256,256]`
- `has_mask_input`: float32 `[1]`
- `orig_im_size`: float32 `[2]`

Unknown decoder inputs now fail explicitly rather than receiving a guessed tensor. Build/deploy revision is `951h5w3`.
