/**
 * Local face detection (TinyFaceDetector) and, optionally, the expression shown on the largest face
 * (FaceExpressionNet), both shipped with @vladmandic/face-api (MIT). The models run in the browser;
 * frames never leave the device. No identity or landmark models are loaded. Expressions are used as
 * what a viewer sees on screen, not as what the person on screen feels (Barrett et al. 2019).
 */

import { HOSTED, fetchBinary } from '../../util/hosted';

type FaceApi = typeof import('@vladmandic/face-api');

let loading: Promise<FaceApi> | null = null;
let expressionsLoaded: Promise<boolean> | null = null;

/** Also load the expression model; resolves false (faces still work) if it cannot be loaded. */
export function loadExpressions(faceapi: FaceApi, modelBase = './models'): Promise<boolean> {
  if (!expressionsLoaded) {
    expressionsLoaded = (async () => {
      try {
        if (HOSTED) await loadWeightsFromText(faceapi, modelBase, 'face_expression_model', faceapi.nets.faceExpressionNet);
        else await faceapi.nets.faceExpressionNet.loadFromUri(modelBase);
        return true;
      } catch {
        expressionsLoaded = null;
        return false;
      }
    })();
  }
  return expressionsLoaded;
}

export function loadFaceDetector(modelBase = './models'): Promise<FaceApi> {
  if (!loading) {
    loading = (async () => {
      const faceapi = await import('@vladmandic/face-api');
      // Prefer WebGL; fall back to the plain CPU backend (no extra WASM downloads).
      const tf = faceapi.tf as unknown as { setBackend: (b: string) => Promise<boolean>; ready: () => Promise<void> };
      const ok = await tf.setBackend('webgl').catch(() => false);
      if (!ok) await tf.setBackend('cpu');
      await tf.ready();
      if (HOSTED) await loadWeightsFromText(faceapi, modelBase, 'tiny_face_detector_model', faceapi.nets.tinyFaceDetector);
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
async function loadWeightsFromText(faceapi: FaceApi, modelBase: string, name: string, net: { loadFromWeightMap(m: ReturnType<FaceApi['tf']['io']['decodeWeights']>): void }) {
  const res = await fetch(`${modelBase}/${name}-weights_manifest.json`);
  if (!res.ok) throw new Error(`Could not load the ${name} manifest (HTTP ${res.status}).`);
  const manifest = (await res.json()) as { paths: string[]; weights: unknown[] }[];
  const shards = await Promise.all(manifest.flatMap((g) => g.paths).map((p) => fetchBinary(`${modelBase}/${p}`)));
  const bytes = new Uint8Array(shards.reduce((n, b) => n + b.byteLength, 0));
  let at = 0;
  for (const b of shards) {
    bytes.set(new Uint8Array(b), at);
    at += b.byteLength;
  }
  const specs = manifest.flatMap((g) => g.weights) as Parameters<typeof faceapi.tf.io.decodeWeights>[1];
  net.loadFromWeightMap(faceapi.tf.io.decodeWeights(bytes.buffer, specs));
}

export const EXPRESSIONS = ['neutral', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised'] as const;
export type Expression = (typeof EXPRESSIONS)[number];

export async function detectFaces(
  faceapi: FaceApi,
  canvas: HTMLCanvasElement,
  expressions = false,
): Promise<{ count: number; maxArea: number; expr: Partial<Record<Expression, number>> | null }> {
  const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
  const area = canvas.width * canvas.height;
  if (expressions) {
    const dets = await faceapi.detectAllFaces(canvas, opts).withFaceExpressions();
    let maxArea = 0;
    let expr: Partial<Record<Expression, number>> | null = null;
    for (const d of dets) {
      const a = (d.detection.box.width * d.detection.box.height) / area;
      if (a >= maxArea) {
        maxArea = a;
        expr = Object.fromEntries(EXPRESSIONS.map((e) => [e, Math.round((d.expressions[e] ?? 0) * 1000) / 1000]));
      }
    }
    return { count: dets.length, maxArea, expr };
  }
  const dets = await faceapi.detectAllFaces(canvas, opts);
  let maxArea = 0;
  for (const d of dets) maxArea = Math.max(maxArea, (d.box.width * d.box.height) / area);
  return { count: dets.length, maxArea, expr: null };
}
