/**
 * Local face *presence* detection using the TinyFaceDetector model shipped with
 * @vladmandic/face-api (MIT). The model runs in the browser; frames never leave the device.
 * Only bounding boxes are used - no identity, landmarks or expression models are loaded.
 */

import { HOSTED, fetchBinary } from '../../util/hosted';

type FaceApi = typeof import('@vladmandic/face-api');

let loading: Promise<FaceApi> | null = null;

export function loadFaceDetector(modelBase = './models'): Promise<FaceApi> {
  if (!loading) {
    loading = (async () => {
      const faceapi = await import('@vladmandic/face-api');
      // Prefer WebGL; fall back to the plain CPU backend (no extra WASM downloads).
      const tf = faceapi.tf as unknown as { setBackend: (b: string) => Promise<boolean>; ready: () => Promise<void> };
      const ok = await tf.setBackend('webgl').catch(() => false);
      if (!ok) await tf.setBackend('cpu');
      await tf.ready();
      if (HOSTED) await loadWeightsFromText(faceapi, modelBase);
      else await faceapi.nets.tinyFaceDetector.loadFromUri(modelBase);
      return faceapi;
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/** Same as loadFromUri, but the weight shards are fetched through fetchBinary (hosted build). */
async function loadWeightsFromText(faceapi: FaceApi, modelBase: string) {
  const res = await fetch(`${modelBase}/tiny_face_detector_model-weights_manifest.json`);
  if (!res.ok) throw new Error(`Could not load the face detector manifest (HTTP ${res.status}).`);
  const manifest = (await res.json()) as { paths: string[]; weights: unknown[] }[];
  const shards = await Promise.all(manifest.flatMap((g) => g.paths).map((p) => fetchBinary(`${modelBase}/${p}`)));
  const bytes = new Uint8Array(shards.reduce((n, b) => n + b.byteLength, 0));
  let at = 0;
  for (const b of shards) {
    bytes.set(new Uint8Array(b), at);
    at += b.byteLength;
  }
  const specs = manifest.flatMap((g) => g.weights) as Parameters<typeof faceapi.tf.io.decodeWeights>[1];
  faceapi.nets.tinyFaceDetector.loadFromWeightMap(faceapi.tf.io.decodeWeights(bytes.buffer, specs));
}

export async function detectFaces(faceapi: FaceApi, canvas: HTMLCanvasElement): Promise<{ count: number; maxArea: number }> {
  const dets = await faceapi.detectAllFaces(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }));
  const area = canvas.width * canvas.height;
  let maxArea = 0;
  for (const d of dets) maxArea = Math.max(maxArea, (d.box.width * d.box.height) / area);
  return { count: dets.length, maxArea };
}
