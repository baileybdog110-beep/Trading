#!/usr/bin/env python3
"""Generate synthetic test media for the analysis pipeline.

Creates tests/fixtures/ (git-ignored):
  speech.wav      espeak-ng synthetic speech (robotic, but with real syllable/pause structure)
  music.wav       additive-synthesis chords + drum pattern at 120 BPM
  program.wav     silence -> speech -> music -> abrupt noise burst -> speech over quiet music
  program.mp3     same, MP3
  clip.mp4        40 s H.264/AAC video with hard cuts, motion, a static shot and a brightness flash
  clip.mov        same, QuickTime container
  program.srt     transcript for the speech parts of program.wav

Requirements: numpy, soundfile, espeakng-loader, imageio-ffmpeg  (pip install ...)
These signals are synthetic. They sanity-check the detectors; they do not validate
accuracy on real-world media.
"""
from __future__ import annotations

import ctypes
import os
import subprocess
from pathlib import Path

import espeakng_loader
import imageio_ffmpeg
import numpy as np
import soundfile as sf

SR = 16000
OUT = Path(__file__).resolve().parents[2] / "tests" / "fixtures"
FF = imageio_ffmpeg.get_ffmpeg_exe()
TEXT_A = ("When the storm finally arrived, Maria realised that she had forgotten the keys. "
          "She thought about her brother, who always knew what to do, and wondered whether he would answer the phone. "
          "Later that night, the lights went out across the whole town.")
TEXT_B = ("Researchers believe that listening to a story engages many regions at once. "
          "Then again, every listener brings a different history to the same words.")


def espeak(text: str) -> np.ndarray:
    lib = ctypes.cdll.LoadLibrary(espeakng_loader.get_library_path())
    data_dir = os.path.dirname(espeakng_loader.get_data_path())
    sr = lib.espeak_Initialize(2, 0, data_dir.encode(), 0)  # AUDIO_OUTPUT_SYNCHRONOUS
    chunks: list[np.ndarray] = []
    CB = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(ctypes.c_short), ctypes.c_int, ctypes.c_void_p)

    def cb(wav, n, _events):
        if n > 0:
            chunks.append(np.ctypeslib.as_array(wav, shape=(n,)).astype(np.float32) / 32768.0)
        return 0

    cb_ref = CB(cb)
    lib.espeak_SetSynthCallback(cb_ref)
    lib.espeak_SetVoiceByName(b"en")
    lib.espeak_SetParameter(1, 150, 0)  # rate (wpm)
    buf = text.encode()
    lib.espeak_Synth(buf, len(buf) + 1, 0, 0, 0, 0, None, None)
    lib.espeak_Synchronize()
    x = np.concatenate(chunks) if chunks else np.zeros(1, np.float32)
    # resample to 16 kHz (linear interpolation is adequate for test signals)
    t_old = np.arange(len(x)) / sr
    t_new = np.arange(int(len(x) * SR / sr)) / SR
    y = np.interp(t_new, t_old, x).astype(np.float32)
    return 0.5 * y / (np.abs(y).max() + 1e-9)


def music(seconds: float, bpm: float = 120.0, level: float = 0.5) -> np.ndarray:
    n = int(seconds * SR)
    t = np.arange(n) / SR
    out = np.zeros(n, np.float32)
    chords = [[220.0, 277.18, 329.63], [196.0, 246.94, 293.66], [174.61, 220.0, 261.63], [196.0, 246.94, 293.66]]
    bar = 4 * 60 / bpm
    for i, start in enumerate(np.arange(0, seconds, bar)):
        a, b = int(start * SR), min(n, int((start + bar) * SR))
        tt = t[a:b] - start
        env = np.minimum(1, tt / 0.02) * np.exp(-tt / 3.0)
        for f in chords[i % len(chords)]:
            for h, amp in ((1, 1.0), (2, 0.4), (3, 0.2)):
                out[a:b] += 0.08 * amp * env * np.sin(2 * np.pi * f * h * tt)
    beat = 60 / bpm
    rng = np.random.default_rng(1)
    for k, start in enumerate(np.arange(0, seconds, beat)):
        a = int(start * SR)
        m = min(n - a, int(0.15 * SR))
        tt = np.arange(m) / SR
        if k % 2 == 0:  # kick
            out[a:a + m] += 0.6 * np.sin(2 * np.pi * (60 + 80 * np.exp(-tt / 0.03)) * tt) * np.exp(-tt / 0.08)
        else:  # snare-ish
            out[a:a + m] += 0.25 * rng.standard_normal(m) * np.exp(-tt / 0.05)
    return (level * out / (np.abs(out).max() + 1e-9)).astype(np.float32)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    sa, sb = espeak(TEXT_A), espeak(TEXT_B)
    sf.write(OUT / "speech.wav", sa, SR)
    sf.write(OUT / "music.wav", music(25), SR)

    sil = np.zeros(int(4 * SR), np.float32)
    m20 = music(20)
    gap = np.zeros(int(1.5 * SR), np.float32)
    rng = np.random.default_rng(7)
    bang = (0.9 * rng.standard_normal(int(0.4 * SR)) * np.exp(-np.arange(int(0.4 * SR)) / SR / 0.15)).astype(np.float32)
    tail = np.zeros(int(2.5 * SR), np.float32)
    bed = music(len(sb) / SR + 1, bpm=96, level=0.08)
    over = bed.copy()
    over[: len(sb)] += sb
    program = np.concatenate([sil, sa, m20, gap, bang, tail, over]).astype(np.float32)
    program = np.clip(program, -1, 1)
    sf.write(OUT / "program.wav", program, SR)

    t_sa0, t_sa1 = 4.0, 4.0 + len(sa) / SR
    t_sb0 = t_sa1 + 20 + 1.5 + 0.4 + 2.5
    t_sb1 = t_sb0 + len(sb) / SR

    def srt_time(x: float) -> str:
        h, r = divmod(x, 3600)
        m, s = divmod(r, 60)
        return f"{int(h):02d}:{int(m):02d}:{int(s):02d},{int(round((s % 1) * 1000)):03d}"

    def split_cues(text: str, t0: float, t1: float):
        sents = [s.strip() + "." for s in text.split(".") if s.strip()]
        total = sum(len(s) for s in sents)
        cues, t = [], t0
        for s in sents:
            d = (t1 - t0) * len(s) / total
            cues.append((t, t + d, s))
            t += d
        return cues

    cues = split_cues(TEXT_A, t_sa0, t_sa1) + split_cues(TEXT_B, t_sb0, t_sb1)
    with open(OUT / "program.srt", "w") as f:
        for i, (a, b, s) in enumerate(cues, 1):
            f.write(f"{i}\n{srt_time(a)} --> {srt_time(b)}\n{s}\n\n")

    subprocess.run([FF, "-y", "-loglevel", "error", "-i", str(OUT / "program.wav"), "-codec:a", "libmp3lame", "-b:a", "96k", str(OUT / "program.mp3")], check=True)

    # 40 s video: [0-12] moving circle, [12-20] static gradient, [20-30] fast stripes, [30-40] dark room with flash at 33 s
    dur = 40
    vf = (
        "color=c=0x2a4d8f:s=320x180:d=12,geq=r='if(lt(hypot(X-(40+20*T*6),Y-90),25),240,40)':g='if(lt(hypot(X-(40+20*T*6),Y-90),25),220,77)':b='if(lt(hypot(X-(40+20*T*6),Y-90),25),120,143)'[a];"
        "color=c=gray:s=320x180:d=8,geq=lum='X*255/320':cb=128:cr=128[b];"
        "color=c=black:s=320x180:d=10,geq=lum='128+100*sin((X+T*400)/6)':cb=128:cr=128[c];"
        "color=c=0x202020:s=320x180:d=10,geq=lum='if(between(T,3,3.6),235,30)':cb=128:cr=128[d];"
        "[a][b][c][d]concat=n=4:v=1:a=0,format=yuv420p[v]"
    )
    for name in ("clip.mp4", "clip.mov"):
        subprocess.run([
            FF, "-y", "-loglevel", "error", "-filter_complex", vf, "-i", str(OUT / "program.wav"),
            "-map", "[v]", "-map", "0:a", "-t", str(dur), "-r", "25",
            "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-b:a", "96k", "-shortest", str(OUT / name),
        ], check=True)
    # Royalty-free codecs, decodable by open-source Chromium builds used in CI/headless testing.
    subprocess.run([
        FF, "-y", "-loglevel", "error", "-filter_complex", vf, "-i", str(OUT / "program.wav"),
        "-map", "[v]", "-map", "0:a", "-t", str(dur), "-r", "25",
        "-c:v", "libvpx-vp9", "-b:v", "300k", "-deadline", "realtime", "-cpu-used", "8", "-c:a", "libopus", "-b:a", "64k", "-shortest", str(OUT / "clip.webm"),
    ], check=True)
    print("fixtures written to", OUT)


if __name__ == "__main__":
    main()
