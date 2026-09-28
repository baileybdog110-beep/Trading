#!/usr/bin/env python3
"""Generate the home-screen / PWA icons (public/icons). Requires Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[2] / "public" / "icons"
PAPER, STRONG, MODERATE, LIMITED, GRAY = "#f5f4f0", "#104281", "#2a78d6", "#86b6ef", "#c9c8c2"


def draw(size: int, pad: float) -> Image.Image:
    s = 4 * size  # supersample for smooth edges
    im = Image.new("RGB", (s, s), PAPER)
    d = ImageDraw.Draw(im)
    p = pad * s
    w = s - 2 * p
    box = lambda x0, y0, x1, y1: [p + x0 * w, p + y0 * w, p + x1 * w, p + y1 * w]
    d.ellipse(box(0.08, 0.14, 0.92, 0.78), fill=GRAY)          # cerebrum (lateral view)
    d.ellipse(box(0.10, 0.18, 0.56, 0.62), fill=MODERATE)      # frontal region
    d.ellipse(box(0.46, 0.16, 0.90, 0.60), fill=LIMITED)       # parietal region
    d.ellipse(box(0.22, 0.46, 0.80, 0.76), fill=STRONG)        # temporal region
    d.ellipse(box(0.58, 0.62, 0.90, 0.88), fill=GRAY)          # cerebellum
    d.arc(box(0.30, 0.20, 0.70, 0.60), 200, 330, fill=PAPER, width=int(0.025 * w))  # a sulcus
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
