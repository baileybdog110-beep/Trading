/**
 * Local face *presence* detection using the TinyFaceDetector model shipped with
 * @vladmandic/face-api (MIT). The model runs in the browser; frames never leave the device.
 * Only bounding boxes are used - no identity, landmarks or expression models are loaded.
 */

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
      await faceapi.nets.tinyFaceDetector.loadFromUri(modelBase);
      return faceapi;
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

export async function detectFaces(faceapi: FaceApi, canvas: HTMLCanvasElement): Promise<{ count: number; maxArea: number }> {
  const dets = await faceapi.detectAllFaces(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }));
  const area = canvas.width * canvas.height;
  let maxArea = 0;
  for (const d of dets) maxArea = Math.max(maxArea, (d.box.width * d.box.height) / area);
  return { count: dets.length, maxArea };
}
