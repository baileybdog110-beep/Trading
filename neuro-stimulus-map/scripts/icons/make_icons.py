#!/usr/bin/env python3
"""Generate the home-screen / PWA icons (public/icons). Requires Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[2] / "public" / "icons"
# the heat map's own colours: dark stage, cold brain, warm ramp
STAGE, BRAIN, LOW, MID, HIGH, TOP = "#0b0f14", "#3a404a", "#7a1f3d", "#c0282d", "#ee6a1f", "#ffe27a"


def draw(size: int, pad: float) -> Image.Image:
    s = 4 * size  # supersample for smooth edges
    im = Image.new("RGB", (s, s), STAGE)
    d = ImageDraw.Draw(im)
    p = pad * s
    w = s - 2 * p
    box = lambda x0, y0, x1, y1: [p + x0 * w, p + y0 * w, p + x1 * w, p + y1 * w]
    d.ellipse(box(0.08, 0.14, 0.92, 0.78), fill=BRAIN)         # cerebrum (lateral view)
    d.ellipse(box(0.10, 0.18, 0.56, 0.62), fill=LOW)           # frontal: a little warm
    d.ellipse(box(0.54, 0.20, 0.90, 0.58), fill=HIGH)          # back of the brain (vision): hot
    d.ellipse(box(0.22, 0.46, 0.80, 0.76), fill=MID)           # temporal (hearing): warm
    d.ellipse(box(0.34, 0.52, 0.66, 0.68), fill=TOP)           # hottest spot
    d.ellipse(box(0.58, 0.62, 0.90, 0.88), fill=BRAIN)         # cerebellum
    d.arc(box(0.30, 0.20, 0.70, 0.60), 200, 330, fill=STAGE, width=int(0.025 * w))  # a sulcus
    return im.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    draw(180, 0.08).save(OUT / "apple-touch-icon.png")
    draw(192, 0.08).save(OUT / "icon-192.png")
    draw(512, 0.08).save(OUT / "icon-512.png")
    draw(512, 0.18).save(OUT / "icon-maskable-512.png")  # safe zone for maskable icons
    print("icons written to", OUT)


if __name__ == "__main__":
    main()
