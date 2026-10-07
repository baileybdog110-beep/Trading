"""OCR the NinjaTrader Chart Trader position box from a 1080p stream frame."""
import sys, re
import numpy as np
from PIL import Image, ImageOps
import pytesseract

QTY_BOX = (1343, 167, 1422, 189)
PRICE_BOX = (1428, 167, 1489, 189)
PNL_BOX = (1343, 193, 1488, 215)

def side_of(a):
    r, g, b = a[..., 0].mean(), a[..., 1].mean(), a[..., 2].mean()
    if r > 90 and r > g * 1.6:
        return "short"
    if g > 70 and g > r * 1.4:
        return "long"
    return "flat"

def tess(mask, whitelist, psm=7, scale=4, trim=False):
    if trim:
        ys, xs = np.where(mask)
        if len(xs) == 0:
            return ""
        mask = mask[max(0, ys.min() - 2):ys.max() + 3, max(0, xs.min() - 2):xs.max() + 3]
    im = Image.fromarray(np.where(mask, 0, 255).astype(np.uint8))
    im = im.resize((im.width * scale, im.height * scale), Image.LANCZOS)
    im = ImageOps.expand(im, border=30, fill=255)
    return pytesseract.image_to_string(im, config=f"--psm {psm} -c tessedit_char_whitelist={whitelist}").strip()

def read_img(img):
    if img.size != (1920, 1080):
        img = img.resize((1920, 1080), Image.LANCZOS)
    rgb = np.asarray(img.convert("RGB")).astype(int)
    def crop(box):
        x0, y0, x1, y1 = box
        return rgb[y0:y1, x0:x1]
    q = crop(QTY_BOX)
    side = side_of(q)
    qty = ""
    if side != "flat":
        lum = q.mean(axis=2)
        qty = tess(np.abs(lum - np.median(lum)) > 45, "0123456789", psm=10, scale=6, trim=True)
    price = tess(crop(PRICE_BOX).min(axis=2) > 120, "0123456789.") if side != "flat" else ""
    pnl = ""
    return side, qty, price, pnl

def parse(side, qty, price, pnl):
    q = int(qty) if qty.isdigit() and 0 < int(qty) < 50 else None
    pr = None
    m = re.search(r"(\d{5})\.?(\d{0,2})", price)
    if m:
        frac = m.group(2)
        val = float(m.group(1) + "." + (frac or "0"))
        pr = round(val * 4) / 4
    pl = None
    s = pnl.replace(" ", "").replace(",", "")
    m = re.search(r"(-?)\$?(\d+)\.?(\d{2})$", s)
    if m:
        pl = float(m.group(2) + "." + m.group(3)) * (-1 if m.group(1) else 1)
    return side, q, pr, pl

if __name__ == "__main__":
    for p in sys.argv[1:]:
        raw = read_img(Image.open(p))
        print(p, raw, parse(*raw))
