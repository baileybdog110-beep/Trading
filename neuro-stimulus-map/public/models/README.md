# Face detector model

`tiny_face_detector_model*` are the TinyFaceDetector weights shipped with
[@vladmandic/face-api](https://github.com/vladmandic/face-api) (MIT licence, © Vladimir
Mandic; originally from face-api.js by Vincent Mühler, MIT licence). They are copied here
so face-presence detection runs entirely in the browser without downloading anything.

Only face *presence* and size are used. No identity, landmark or expression models are
loaded, and facial expressions are never used to infer emotions.
