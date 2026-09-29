#!/usr/bin/env python3
"""Export the musicnn MSD tagger (Pons & Serra 2019, ISC licence) for the browser.

The MSD_musicnn model was trained on the Million Song Dataset with the 50 most common Last.fm tags
that listeners attached to songs (including "happy", "sad", "Mellow", "chill", "party").

Writes to public/models/musicnn/:
  weights.bin       float32 weights, in the order listed in manifest.json
  manifest.json     tensor names, shapes, byte offsets; labels; front-end settings
  mel_filters.bin   librosa (Slaney) mel filterbank, 96 x 257, float32 - so the browser front end
                    matches the one the model was trained with
And to tests/fixtures-model/musicnn_reference.json: a log-mel input patch with the expected tag
probabilities from the NumPy reference implementation below, used by tests/musicnn.test.ts.

Usage (needs numpy, librosa and tensorflow only to read the checkpoint):
  python scripts/models/export_musicnn.py --checkpoint path/to/musicnn/MSD_musicnn/ [--audio some.ogg]
The checkpoint ships inside the musicnn wheel on PyPI (pip download --no-deps musicnn==0.1.0).
"""
import argparse
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'models', 'musicnn')
FIX = os.path.join(ROOT, 'tests', 'fixtures-model')

MSD_LABELS = ['rock', 'pop', 'alternative', 'indie', 'electronic', 'female vocalists', 'dance', '00s', 'alternative rock', 'jazz', 'beautiful', 'metal',
              'chillout', 'male vocalists', 'classic rock', 'soul', 'indie rock', 'Mellow', 'electronica', '80s', 'folk', '90s', 'chill', 'instrumental',
              'punk', 'oldies', 'blues', 'hard rock', 'ambient', 'acoustic', 'experimental', 'female vocalist', 'guitar', 'Hip-Hop', '70s', 'party', 'country',
              'easy listening', 'sexy', 'catchy', 'funk', 'electro', 'heavy metal', 'Progressive rock', '60s', 'rnb', 'indie pop', 'sad', 'House', 'happy']

# Tensors in the order the browser reads them (see src/emotion/musicnn.ts).
BN = ['batch_normalization'] + [f'batch_normalization_{i}' for i in range(1, 11)]
CONV = ['conv2d'] + [f'conv2d_{i}' for i in range(1, 8)]
ORDER = [f'{c}/{p}' for c in CONV for p in ('kernel', 'bias')] + [f'{b}/{p}' for b in BN for p in ('gamma', 'beta', 'moving_mean', 'moving_variance')] + [
    'dense/kernel', 'dense/bias', 'dense_1/kernel', 'dense_1/bias']
EPS = 1e-3  # tf.compat.v1.layers.batch_normalization default


def reader(path):
    from tensorflow.python.training import py_checkpoint_reader
    return py_checkpoint_reader.NewCheckpointReader(path)


def forward(W, mel):
    """NumPy reference forward pass of build_musicnn (musicnn/models.py) at inference."""
    from numpy.lib.stride_tricks import sliding_window_view

    def bn(x, name):
        return (x - W[name + '/moving_mean']) / np.sqrt(W[name + '/moving_variance'] + EPS) * W[name + '/gamma'] + W[name + '/beta']

    def conv(x, k, b):
        kt, kf = k.shape[0], k.shape[1]
        win = sliding_window_view(x, (kt, kf))
        return np.tensordot(win, k[:, :, 0, :], axes=([2, 3], [0, 1])) + b

    relu = lambda x: np.maximum(x, 0)
    x = bn(mel, 'batch_normalization')
    xp = np.pad(x, ((3, 3), (0, 0)))
    f74 = bn(relu(conv(xp, W['conv2d/kernel'], W['conv2d/bias'])), 'batch_normalization_1').max(axis=1)
    f77 = bn(relu(conv(xp, W['conv2d_1/kernel'], W['conv2d_1/bias'])), 'batch_normalization_2').max(axis=1)
    temporal = []
    for kname, bname, kt in [('conv2d_2', 'batch_normalization_3', 128), ('conv2d_3', 'batch_normalization_4', 64), ('conv2d_4', 'batch_normalization_5', 32)]:
        total = kt - 1  # TensorFlow 'same' padding: extra row goes after
        xs = np.pad(x, ((total // 2, total - total // 2), (0, 0)))
        temporal.append(bn(relu(conv(xs, W[kname + '/kernel'], W[kname + '/bias'])), bname).max(axis=1))
    front = np.concatenate([f74, f77] + temporal, axis=1)

    def mid(inp, kname, bname):
        return bn(relu(conv(np.pad(inp, ((3, 3), (0, 0))), W[kname + '/kernel'], W[kname + '/bias'])[:, 0, :]), bname)

    c1 = mid(front, 'conv2d_5', 'batch_normalization_6')
    c2 = mid(c1, 'conv2d_6', 'batch_normalization_7') + c1
    c3 = mid(c2, 'conv2d_7', 'batch_normalization_8') + c2
    feats = np.concatenate([front, c1, c2, c3], axis=1)
    pooled = np.stack([feats.max(axis=0), feats.mean(axis=0)], axis=1).reshape(-1)  # flatten of (753, 2): max/mean interleaved
    h = bn(pooled, 'batch_normalization_9')
    h = bn(relu(h @ W['dense/kernel'] + W['dense/bias']), 'batch_normalization_10')
    logits = h @ W['dense_1/kernel'] + W['dense_1/bias']
    return 1 / (1 + np.exp(-logits))


def logmel(y):
    import librosa
    m = librosa.feature.melspectrogram(y=y, sr=16000, hop_length=256, n_fft=512, n_mels=96).T
    return np.log10(10000 * m + 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--checkpoint', required=True)
    ap.add_argument('--audio', help='audio file for the reference patch (a synthetic chord is used otherwise)')
    args = ap.parse_args()
    import librosa

    R = reader(args.checkpoint)
    W = {k: R.get_tensor(k).astype(np.float64) for k in ORDER}
    os.makedirs(OUT, exist_ok=True)
    tensors, offset = [], 0
    with open(os.path.join(OUT, 'weights.bin'), 'wb') as f:
        for k in ORDER:
            a = W[k].astype('<f4')
            f.write(a.tobytes())
            tensors.append({'name': k, 'shape': list(a.shape), 'offset': offset})
            offset += a.nbytes
    mel_fb = librosa.filters.mel(sr=16000, n_fft=512, n_mels=96).astype('<f4')
    mel_fb.tofile(os.path.join(OUT, 'mel_filters.bin'))
    manifest = {
        'model': 'MSD_musicnn',
        'source': 'musicnn 0.1.0 (Pons & Serra 2019), https://github.com/jordipons/musicnn, ISC licence, Music Technology Group, Universitat Pompeu Fabra',
        'trainingData': 'Million Song Dataset audio with the 50 most frequent Last.fm tags; reported ROC-AUC 0.880, PR-AUC 0.289 on its test split',
        'frontEnd': {'sampleRate': 16000, 'nFft': 512, 'hop': 256, 'nMels': 96, 'window': 'hann (periodic)', 'center': True, 'padMode': 'constant', 'power': 2,
                     'log': 'log10(10000 * mel + 1)', 'patchFrames': 187},
        'bnEpsilon': EPS,
        'labels': MSD_LABELS,
        'tensors': tensors,
        'bytes': offset,
    }
    json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)

    if args.audio:
        y, _ = librosa.load(args.audio, sr=16000, duration=4.0)
    else:
        t = np.arange(int(16000 * 3.2)) / 16000
        y = sum(0.2 * np.sin(2 * np.pi * f * t) * (1 + 0.5 * np.sin(2 * np.pi * 2 * t)) for f in (261.63, 329.63, 392.0))
    mel = logmel(y)[:187]
    probs = forward(W, mel.astype(np.float64))
    os.makedirs(FIX, exist_ok=True)
    json.dump({'note': 'Input: log-mel patch (187 x 96) computed with librosa; expected: tag probabilities from the NumPy reference in scripts/models/export_musicnn.py',
               'audio': os.path.basename(args.audio) if args.audio else 'synthetic C-major chord with 2 Hz tremolo',
               'pcm': [round(float(v), 7) for v in y[:int(16000 * 3.2)]],
               'mel': [[round(float(v), 6) for v in row] for row in mel],
               'expected': [round(float(p), 7) for p in probs]},
              open(os.path.join(FIX, 'musicnn_reference.json'), 'w'))
    top = np.argsort(-probs)[:5]
    print('wrote', OUT, f'{offset / 1e6:.2f} MB;', 'reference top tags:', [(MSD_LABELS[i], round(float(probs[i]), 3)) for i in top])


if __name__ == '__main__':
    sys.exit(main())
