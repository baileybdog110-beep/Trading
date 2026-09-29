# Models

## Face detector and expression model

`tiny_face_detector_model*` and `face_expression_model*` are weights shipped with
[@vladmandic/face-api](https://github.com/vladmandic/face-api) (MIT licence, © Vladimir
Mandic; originally from face-api.js by Vincent Mühler, MIT licence). They are copied here
so they run entirely in the browser without downloading anything.

Only face presence, size and the expression *shown* (as classified by the model) are used - as a
cue to what a viewer sees on screen, which is what face-perception research studies. Expressions are
not treated as what the person on screen feels (see Barrett et al. 2019 in the evidence database).
No identity or landmark models are loaded.

## Music tagger (`musicnn/`)

The MSD_musicnn model of [musicnn](https://github.com/jordipons/musicnn) (Pons & Serra 2019,
ISC licence, © Music Technology Group, Universitat Pompeu Fabra), trained on the Million Song
Dataset with Last.fm listener tags. Exported from the original checkpoint by
`scripts/models/export_musicnn.py`; `tests/musicnn.test.ts` checks the browser version against a
NumPy reference of the checkpoint.
