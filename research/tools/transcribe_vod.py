"""Transcribe a stream recording with faster-whisper and stamp each line with New York time.

usage: python3 transcribe_vod.py <audio file> <stream start, UTC, "YYYY-MM-DD HH:MM:SS"> <out.txt> [model]
Get audio from a Twitch VOD with e.g.  yt-dlp -f Audio_Only -g https://www.twitch.tv/videos/<id>  | ffmpeg ...
"""
import sys, subprocess, datetime as dt
from zoneinfo import ZoneInfo
import numpy as np
from faster_whisper import WhisperModel

audio_path, start_utc, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
model_name = sys.argv[4] if len(sys.argv) > 4 else "base.en"
pcm = subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-i", audio_path, "-f", "s16le", "-ac", "1", "-ar", "16000", "-"],
                     capture_output=True, check=True).stdout
audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
start = dt.datetime.strptime(start_utc, "%Y-%m-%d %H:%M:%S").replace(tzinfo=dt.timezone.utc).astimezone(ZoneInfo("America/New_York"))
model = WhisperModel(model_name, device="cpu", compute_type="int8")
segments, _ = model.transcribe(audio, beam_size=1, vad_filter=True, language="en", condition_on_previous_text=False)
with open(out_path, "w") as f:
    for s in segments:
        t = start + dt.timedelta(seconds=s.start)
        off = int(s.start)
        f.write(f"[{t:%H:%M:%S} ET | +{off // 3600}:{off % 3600 // 60:02d}:{off % 60:02d}] {s.text.strip()}\n")
