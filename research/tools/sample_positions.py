"""Sample one frame per 10-s HLS segment of a Twitch VOD and OCR the Chart Trader position box."""
import sys, os, re, io, csv, subprocess, datetime as dt, urllib.request
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
import ct_ocr
ET = ZoneInfo("America/New_York")

def m3u8_url(vod):
    return subprocess.run(["yt-dlp", "-g", "-f", "1080p60", f"https://www.twitch.tv/videos/{vod}"],
                          capture_output=True, text=True).stdout.strip().splitlines()[0]

def segments(url):
    txt = urllib.request.urlopen(url, timeout=60).read().decode()
    base = url.rsplit("/", 1)[0]
    out, pdt = [], None
    for line in txt.splitlines():
        if line.startswith("#EXT-X-PROGRAM-DATE-TIME:"):
            pdt = dt.datetime.fromisoformat(line.split(":", 1)[1].replace("Z", "+00:00"))
        elif line.endswith(".ts") and pdt is not None:
            out.append((pdt.astimezone(ET), f"{base}/{line}"))
    return out

def grab(seg_url):
    req = urllib.request.Request(seg_url, headers={"Range": "bytes=0-650000", "User-Agent": "Mozilla/5.0"})
    data = urllib.request.urlopen(req, timeout=60).read()
    p = subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-f", "mpegts", "-i", "pipe:0",
                        "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"],
                       input=data, capture_output=True)
    return Image.open(io.BytesIO(p.stdout)) if p.stdout else None

def main(label, vod, start="09:25", end="12:30", outdir="positions"):
    os.makedirs(f"{outdir}/{label}_frames", exist_ok=True)
    segs = [(t, u) for t, u in segments(m3u8_url(vod)) if start <= t.strftime("%H:%M") < end]
    def work(item):
        t, u = item
        for attempt in range(3):
            try:
                img = grab(u)
                if img is None:
                    return t, None, None
                raw = ct_ocr.read_img(img)
                return t, ct_ocr.parse(*raw), img
            except Exception as e:
                err = e
        return t, None, None
    rows, prev = [], None
    with ThreadPoolExecutor(max_workers=6) as ex:
        for t, parsed, img in ex.map(work, segs):
            if parsed is None:
                continue
            side, q, pr, pl = parsed
            rows.append((t.strftime("%Y-%m-%d %H:%M:%S"), side, q, pr, pl))
            key = (side, q, pr)
            if key != prev and img is not None:
                img.convert("RGB").resize((1280, 720)).save(f"{outdir}/{label}_frames/{t:%H%M%S}_{side}_{q}_{pr}.jpg", quality=80)
            prev = key
    with open(f"{outdir}/{label}.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["et", "side", "qty", "avg_price", "pnl"])
        w.writerows(rows)
    print(label, len(rows), "frames sampled", flush=True)

if __name__ == "__main__":
    main(*sys.argv[1:])
