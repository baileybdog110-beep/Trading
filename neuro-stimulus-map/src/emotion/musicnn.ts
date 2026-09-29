/**
 * The musicnn MSD tagger (Pons & Serra 2019, ISC licence) in TensorFlow.js.
 *
 * It was trained on the Million Song Dataset to predict the 50 tags Last.fm listeners gave songs,
 * including mood tags (happy, sad, Mellow, chill, party, beautiful...). The weights and the mel
 * filterbank are exported from the original checkpoint by scripts/models/export_musicnn.py, and
 * tests/musicnn.test.ts checks this forward pass against that script's NumPy reference.
 *
 * `tf` is passed in so the browser can reuse the TensorFlow.js copy bundled with face-api
 * (WebGL when available) and the tests can use @tensorflow/tfjs-core with the CPU backend.
 */
import type * as TFCore from '@tensorflow/tfjs-core';

type TF = typeof TFCore;
type Tensor = TFCore.Tensor;

export const PATCH_FRAMES = 187; // ~3 s of 16 ms frames
export const MEL_BANDS = 96;

export interface MusicnnManifest {
  labels: string[];
  bnEpsilon: number;
  tensors: { name: string; shape: number[]; offset: number }[];
}

export interface Musicnn {
  labels: string[];
  /** Tag probabilities (0..1, in `labels` order) for each 187 x 96 log-mel patch. */
  predict(patches: Float32Array[]): Promise<Float32Array[]>;
  dispose(): void;
}

export function buildMusicnn(tf: TF, manifest: MusicnnManifest, weights: ArrayBuffer): Musicnn {
  const W = new Map<string, Tensor>();
  for (const t of manifest.tensors) {
    const n = t.shape.reduce((a, b) => a * b, 1);
    W.set(t.name, tf.tensor(new Float32Array(weights, t.offset, n), t.shape, 'float32'));
  }
  const w = (name: string) => {
    const t = W.get(name);
    if (!t) throw new Error(`musicnn: missing tensor ${name}`);
    return t;
  };
  const eps = manifest.bnEpsilon;
  // Batch norm at inference folded into scale and shift: y = x * scale + shift
  const folded = new Map<string, [Tensor, Tensor]>();
  const bnNames = ['batch_normalization', ...Array.from({ length: 10 }, (_, i) => `batch_normalization_${i + 1}`)];
  for (const b of bnNames) {
    const scale = tf.tidy(() => tf.div(w(`${b}/gamma`), tf.sqrt(tf.add(w(`${b}/moving_variance`), eps))));
    const shift = tf.tidy(() => tf.sub(w(`${b}/beta`), tf.mul(w(`${b}/moving_mean`), scale)));
    folded.set(b, [scale, shift]);
  }
  const bn = (x: Tensor, name: string) => {
    const [s, h] = folded.get(name)!;
    return tf.add(tf.mul(x, s), h);
  };
  const conv = (x: TFCore.Tensor4D, k: string, pre: number, post: number) =>
    tf.relu(tf.add(tf.conv2d(tf.pad(x, [[0, 0], [pre, post], [0, 0], [0, 0]]), w(`${k}/kernel`) as TFCore.Tensor4D, 1, 'valid'), w(`${k}/bias`)));

  const forward = (mel: TFCore.Tensor3D): Tensor =>
    tf.tidy(() => {
      const B = mel.shape[0];
      const x = bn(tf.reshape(mel, [B, PATCH_FRAMES, MEL_BANDS, 1]), 'batch_normalization') as TFCore.Tensor4D;
      // timbral filters (7 frames x 38 or 67 mel bands), max over frequency
      const f74 = tf.max(bn(conv(x, 'conv2d', 3, 3), 'batch_normalization_1'), 2);
      const f77 = tf.max(bn(conv(x, 'conv2d_1', 3, 3), 'batch_normalization_2'), 2);
      // temporal filters (128, 64, 32 frames x 1 band); TensorFlow 'same' padding puts the extra row after
      const temporal = (
        [
          ['conv2d_2', 'batch_normalization_3', 128],
          ['conv2d_3', 'batch_normalization_4', 64],
          ['conv2d_4', 'batch_normalization_5', 32],
        ] as const
      ).map(([k, b, kt]) => tf.max(bn(conv(x, k, Math.floor((kt - 1) / 2), kt - 1 - Math.floor((kt - 1) / 2)), b), 2));
      const front = tf.concat([f74, f77, ...temporal], 2); // [B, 187, 561]
      const mid = (inp: Tensor, k: string, b: string) => {
        const C = inp.shape[2]!;
        const y = conv(tf.reshape(inp, [B, PATCH_FRAMES, C, 1]) as TFCore.Tensor4D, k, 3, 3); // [B, 187, 1, 64]
        return bn(tf.reshape(y, [B, PATCH_FRAMES, 64]), b);
      };
      const c1 = mid(front, 'conv2d_5', 'batch_normalization_6');
      const c2 = tf.add(mid(c1, 'conv2d_6', 'batch_normalization_7'), c1);
      const c3 = tf.add(mid(c2, 'conv2d_7', 'batch_normalization_8'), c2);
      const feats = tf.concat([front, c1, c2, c3], 2); // [B, 187, 753]
      // max and mean over time, interleaved per feature (the checkpoint's flatten order)
      const pooled = tf.reshape(tf.stack([tf.max(feats, 1), tf.mean(feats, 1)], 2), [B, 1506]);
      let h = bn(pooled, 'batch_normalization_9');
      h = bn(tf.relu(tf.add(tf.matMul(h as TFCore.Tensor2D, w('dense/kernel') as TFCore.Tensor2D), w('dense/bias'))), 'batch_normalization_10');
      return tf.sigmoid(tf.add(tf.matMul(h as TFCore.Tensor2D, w('dense_1/kernel') as TFCore.Tensor2D), w('dense_1/bias')));
    });

  return {
    labels: manifest.labels,
    async predict(patches) {
      if (!patches.length) return [];
      const flat = new Float32Array(patches.length * PATCH_FRAMES * MEL_BANDS);
      patches.forEach((p, i) => flat.set(p, i * PATCH_FRAMES * MEL_BANDS));
      const input = tf.tensor3d(flat, [patches.length, PATCH_FRAMES, MEL_BANDS]);
      const out = forward(input);
      const data = (await out.data()) as Float32Array;
      input.dispose();
      out.dispose();
      const n = manifest.labels.length;
      return patches.map((_, i) => data.slice(i * n, (i + 1) * n));
    },
    dispose() {
      for (const t of W.values()) t.dispose();
      for (const [s, h] of folded.values()) {
        s.dispose();
        h.dispose();
      }
    },
  };
}

/** Cut 187-frame log-mel patches from a list of 96-band frames, every `hop` frames (zero-padded at the end). */
export function melPatches(logmel: Float32Array[], hop: number, maxPatches = Infinity): { start: number; patch: Float32Array }[] {
  const out: { start: number; patch: Float32Array }[] = [];
  const last = Math.max(1, logmel.length - PATCH_FRAMES + 1);
  let step = hop;
  const count = Math.ceil(last / hop);
  if (count > maxPatches) step = Math.ceil(last / maxPatches);
  for (let s = 0; s < last; s += step) {
    const p = new Float32Array(PATCH_FRAMES * MEL_BANDS);
    for (let i = 0; i < PATCH_FRAMES && s + i < logmel.length; i++) p.set(logmel[s + i], i * MEL_BANDS);
    out.push({ start: s, patch: p });
  }
  return out;
}
