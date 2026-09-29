"""Emotion features, mirrored exactly by src/emotion/features.ts (tests compare the two).

All functions take mono float PCM at 16 kHz.
- frame_features: 20 ms frames (512-sample Hann window, 320 hop) - level (dB), log-spectral flux,
  spectral flatness - the same definitions as FrameAnalyzer in src/analysis/audio/dsp.ts.
- stft_features: 16 ms hop STFT (512, Hann periodic, centred) - log-mel (musicnn front end) and
  spectral centroid (brightness, Hz).
- chroma: 4096-point STFT every 128 ms, 55-2093 Hz folded to 12 pitch classes.
- key_mode: Krumhansl-Kessler key profiles (Krumhansl & Kessler 1982) - best major and best minor
  correlation; mode = r_major - r_minor.
"""
import numpy as np

SR = 16000
FRAME, HOP = 512, 320
FPS = SR / HOP
SILENCE_DB = -55
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def frame_features(y):
    n = 1 + max(0, (len(y) - FRAME) // HOP)
    win = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(FRAME) / (FRAME - 1))
    idx = np.arange(FRAME)[None, :] + HOP * np.arange(n)[:, None]
    x = y[idx]
    db = 20 * np.log10(np.sqrt((x ** 2).mean(axis=1)) + 1e-9)
    mag = np.abs(np.fft.rfft(x * win, axis=1))[:, 1:FRAME // 2]
    logmag = np.log(1 + 100 * mag)
    flux = np.zeros(n)
    flux[1:] = np.maximum(0, logmag[1:] - logmag[:-1]).sum(axis=1) / (FRAME // 2 - 1)
    lin = mag.sum(axis=1)
    flat = np.where(lin > 1e-9, np.exp(np.log(mag + 1e-12).mean(axis=1)) / (lin / (FRAME // 2 - 1)), 1.0)
    return db, flux, flat


def stft_power(y, n_fft, hop):
    pad = n_fft // 2
    yp = np.concatenate([np.zeros(pad), y, np.zeros(pad)])
    n = 1 + len(y) // hop
    win = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n_fft) / n_fft)  # periodic Hann (librosa / scipy fftbins)
    idx = np.arange(n_fft)[None, :] + hop * np.arange(n)[:, None]
    idx = np.minimum(idx, len(yp) - 1)
    return np.abs(np.fft.rfft(yp[idx] * win, axis=1)) ** 2


def stft_features(y, mel_fb):
    P = stft_power(y, 512, 256)  # (T, 257)
    logmel = np.log10(10000 * (P @ mel_fb.T) + 1)
    freqs = np.arange(257) * SR / 512
    tot = P[:, 1:].sum(axis=1)
    centroid = np.where(tot > 1e-10, (P[:, 1:] * freqs[1:]).sum(axis=1) / np.maximum(tot, 1e-20), 0.0)
    return logmel, centroid, tot


def chroma(y):
    P = stft_power(y, 4096, 2048)
    freqs = np.arange(P.shape[1]) * SR / 4096
    ok = (freqs >= 55) & (freqs <= 2093)
    pc = (np.round(12 * np.log2(freqs[ok] / 440)).astype(int) + 9) % 12  # 0 = C
    mag = np.sqrt(P[:, ok])
    C = np.zeros((P.shape[0], 12))
    for k in range(12):
        C[:, k] = mag[:, pc == k].sum(axis=1)
    return C  # frames every 128 ms


def key_mode(c):
    """c: 12-bin chroma sum. Returns (mode score r_major - r_minor, clarity = best r, key index, is_major)."""
    if c.sum() <= 1e-9:
        return 0.0, 0.0, 0, True
    def corr(a, b):
        a = a - a.mean(); b = b - b.mean()
        d = np.sqrt((a * a).sum() * (b * b).sum())
        return float((a * b).sum() / d) if d > 0 else 0.0
    rmaj = [corr(c, np.roll(MAJOR, k)) for k in range(12)]
    rmin = [corr(c, np.roll(MINOR, k)) for k in range(12)]
    bmaj, bmin = max(rmaj), max(rmin)
    return bmaj - bmin, max(bmaj, bmin), int(np.argmax(rmaj) if bmaj >= bmin else np.argmax(rmin)), bmaj >= bmin


def dissonance(C):
    """Per chroma frame: how much simultaneous pitch-class energy sits in sharp clashes - semitones
    (minor 2nd / major 7th) fully, tritones half - relative to all pitch-class pairs."""
    tot = C.sum(axis=1)
    clash = (C * np.roll(C, -1, axis=1)).sum(axis=1) + 0.5 * (C * np.roll(C, -6, axis=1)).sum(axis=1)
    return np.where(tot > 1e-9, clash / np.maximum(tot * tot, 1e-18), 0.0)


def beat_strength(flux, a, b):
    b = min(b, len(flux))
    n = b - a
    if n < FPS * 6:
        return 0.0, 0.0
    x = flux[a:b] - flux[a:b].mean()
    r0 = (x * x).sum()
    if r0 <= 1e-12:
        return 0.0, 0.0
    min_lag, max_lag = round(60 / 200 * FPS), round(60 / 50 * FPS)
    r = {}
    best, best_lag = 0.0, 0
    for lag in range(min_lag, max_lag + 1):
        v = (x[:n - lag] * x[lag:]).sum() / (r0 * ((n - lag) / n))
        r[lag] = v
        if v > best:
            best, best_lag = v, lag
    half = round(best_lag / 2)
    if best_lag and 60 * FPS / best_lag < 80 and half >= min_lag and r.get(half, 0) >= 0.3 * best:
        best_lag = half
    return (60 * FPS / best_lag if best_lag else 0.0), max(0.0, best)


ONSET_FLOOR = 0.05  # onset strength below this is not a note or hit (steady sounds only jitter below it)


def onset_rate(flux, a, b):
    """Onsets per second: local peaks of the flux above mean + 1 SD of the window (and above
    ONSET_FLOOR), >= 100 ms apart."""
    seg = flux[a:b]
    if len(seg) < 3:
        return 0.0
    thr = max(seg.mean() + seg.std(), ONSET_FLOOR)
    count, last = 0, -10
    for i in range(1, len(seg) - 1):
        if seg[i] > thr and seg[i] >= seg[i - 1] and seg[i] > seg[i + 1] and i - last >= 5:
            count += 1
            last = i
    return count / (len(seg) / FPS)
