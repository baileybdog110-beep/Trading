# Alligator-skin TPU case for MacBook Air 11" (A1465)

A two-piece snap-on case for the 11-inch MacBook Air, model **A1465**
(Mid 2012, 2013, Early 2014, Early 2015). The A1370 (2010–2011) has the same
chassis, so the case fits it too. It is designed to print in **TPU** on a
Bambu Lab printer.

![preview](preview.png)

* **Lid shell** clips onto the back of the screen.
* **Base shell** clips onto the bottom. It has an open window over the
  MagSafe 2, USB 3, headphone and mic ports on the left, another over the
  Thunderbolt and USB 3 ports on the right, holes for the four rubber feet,
  and a finger notch at the front so you can still open the lid.
* **Outside:** a belly-cut alligator hide. Big, rounded rectangular scales
  run through the middle, and smaller polygonal flank scales sit near the
  front and back edges. Around it is a smooth border with an embossed
  stitch line, like a stitched leather panel.
* The texture is on the face that prints against the bed. The scale tops
  pick up the plate's surface finish (textured PEI gives a matte, leathery
  grain). No supports are needed anywhere.
* **Clips:** the lid and base clips are staggered, so only one 0.6 mm
  lip ever sits in the gap between lid and keyboard. The laptop still
  closes.

## Which files to print

There is no Bambu "T1S". These files assume a **256 × 256 mm** bed
(P1S, P2S, X1C, A1). That bed is too small for a 303 mm case, so each shell
is split into **LEFT** and **RIGHT** halves. The split runs along the
scale grooves, and four dovetail-shaped scales lock the halves together.
If you have an H2D or H2S, you can print the one-piece versions instead.

| Folder (in `3mf/`, same names in `stl/`) | What | Each | ~TPU |
|---|---|---|---|
| `1_fit_tests/` | 3 lid-corner and 3 base-strip test pieces | 44×44 / 40×107 mm | 5 g / 9 g |
| `2_lid_shell/` | `lid_shell_<A/B/C>_LEFT` + `_RIGHT` | ~163 × 187 mm | ~65 g |
| `3_base_shell/` | `base_shell_<A/B/C>_LEFT` + `_RIGHT` | ~164 × 192 mm | ~63 g |
| `4_one_piece_for_big_beds/` | one-piece lid and base (B sizes) | 303 × 192 mm | ~128 g |

The **B** files are the nominal size. Print A or C only if a fit test tells
you to. The 3MF and STL files contain the same meshes; the 3MF files are
about 4× smaller and open directly in Bambu Studio. STL copies of the fit tests
and B-size shells are written to `stl/` when you run `generate_case.py`. They
aren't stored in git, to keep the repo small. Every A/B/C size is in `3mf/`. Leave every part in its
exported orientation, textured face down.

## Step 1: print the fit tests (about 1 hour, about 40 g)

Apple publishes the outside footprint but not the lid thickness or the
base's wedge profile. I measured those from photos, so they could be off by
a few tenths of a millimetre. A full case uses about 260 g of TPU, so check
the fit with these small pieces first.

1. **Lid corner A/B/C** (for lids 4.5 / 4.9 / 5.3 mm thick). Close the
   laptop and snap each one onto the **front-left corner of the lid**.
   * The right one hooks over the screen bezel with a small click and
     doesn't rattle.
   * If **B** rattles or its lip floats above the bezel, use **A**.
   * If **B** won't snap over the edge, or bows, use **C**.
2. **Base strip A/B/C** (deck edge −0.5 / nominal / +0.5 mm). Slide the
   laptop's **left rear corner** into the strip.
   * The rear-left rubber foot should drop into the hole.
   * The clip at the front end of the strip should hook over the edge of
     the palm rest.
   * Pick the one whose clip hooks cleanly without lifting the laptop.
   * Also check that the window clears MagSafe, USB and the headphone
     jack. If the foot or the ports don't line up, measure and ask me for
     a tweak (see the last section).

## Step 2: print the shells

Print four plates, one half each: lid LEFT, lid RIGHT, base LEFT and base
RIGHT, in the A/B/C size you picked for each shell. The base **LEFT** half
is the one with the long port window, on the MagSafe side.

### Bambu Studio settings (P1S/X1C/P2S, 0.4 mm nozzle)

| Setting | Value |
|---|---|
| Filament feed | **External spool holder.** The AMS can't feed ordinary TPU; only Bambu's "TPU for AMS" is AMS-compatible. |
| Filament profile | Bambu TPU 95A HF (or Generic TPU). Dry the spool first: 4–6 h at 65–70 °C. |
| Plate | Textured PEI (leather grain); bed 35–40 °C |
| Layer height | 0.16 mm (0.12 for crisper scales, 0.20 for speed) |
| Wall loops | 4 |
| Infill | 100 % (the parts are thin, so it is almost all walls and solid layers anyway) |
| Supports | **Off.** Lips and grooves are designed to print without them. |
| Brim | Off (TPU doesn't warp) |
| Speed | Use the filament profile's limits. Slow the outer wall and overhangs to about 30 mm/s if the clip lips look droopy. |
| Optional | Fuzzy skin → **Contour**, thickness 0.15, point distance 0.4, for a pebbled leather grain on the outside walls (it leaves the inside fit alone) |

Bambu Studio will give the real time estimate. Very roughly, expect 2–3 h
per half with TPU 95A HF and longer with ordinary TPU.

Colour ideas: black, dark brown or deep olive TPU looks most like real
gator. To make the scales pop, wipe a little darker shoe or leather dye into
the grooves and wipe the scale tops clean.

## Step 3: join the halves

1. Lay both halves textured face down on a flat surface. Push the dovetail
   scales together so the seam closes. It sits in the bottom of a groove,
   so it mostly disappears.
2. Glue from the **inside** of the case with flexible CA gel (Loctite Super
   Glue Gel Control or similar) or a flexible adhesive such as E6000. Or
   melt the seam together from the inside with a soldering iron at about
   230 °C and a short piece of the same TPU.
3. Let it cure fully before you fit it.

## Step 4: fit it

* **Lid shell:** hook both front corners over the lid first, then press
  down along the sides until the side clips click over the bezel. The
  hinge end is left open on purpose so the screen still opens fully.
* **Base shell:** set the laptop in front edge first, then press the sides
  down until the clips catch the palm-rest edge. The feet sit in their
  holes.
* To take it off, peel one side clip outwards first.

## Measurements used

| Feature | Value | Source |
|---|---|---|
| Width × depth | 299.5 × 192.0 mm | Apple tech specs (29.95 × 19.2 cm) |
| Closed height | 3 mm front → 17 mm back (incl. feet) | Apple / iFixit |
| Front corner radius | 10 mm | measured from a rectified photo of the bottom case |
| Rubber feet | Ø 18 mm, centres 24.4 mm from the sides, 26.0 mm from the front, 20.2 mm from the back | same photo; Ø matches a published 17.85 mm figure |
| Base deck-edge height | 1.35 mm front → 9.6 mm back | side photo, scaled by the USB-A and 3.5 mm jack openings |
| Lid thickness | 4.9 mm (A/B/C test 4.5–5.3) | estimate (panel < 3 mm + housing); not published by Apple |
| Ports (from back edge) | L: MagSafe 2 ~7–25, USB ~29–43, headphone ~57, mics ~71 · R: Thunderbolt ~9–19, USB ~27–42 | side photos |

Case design: 0.25 mm clearance per side (the pocket is exactly 300.0 mm
wide), 1.6 mm walls, a 2.0 mm floor including 0.75 mm-deep grooves, and
0.6 mm clip lips reaching 1.35 mm over the screen bezel / palm rest.
[`cross_section.png`](cross_section.png) shows the clip profile against
the laptop.

## Changing the design

`generate_case.py` rebuilds everything in about a minute:

```bash
pip install -r requirements.txt
python3 generate_case.py                    # rebuild all files
python3 generate_case.py --lid-t 5.1        # new nominal lid thickness
python3 generate_case.py --base-offset 0.3  # raise the base clips 0.3 mm
python3 generate_case.py --clear 0.35       # looser side fit
```

You can change everything else at the top of the script: the clip
positions, lip thickness, groove depth, scale size, stitching and port
window positions. If you'd rather not run Python, send me your caliper
readings (lid thickness at the front edge, deck-edge height at the back)
and I'll regenerate the files.

Every exported part was checked to be watertight and manifold after
vertex merging, with consistent normals, so Bambu Studio shouldn't report
any mesh errors.

### Sources

* [Apple: MacBook Air (11-inch) tech specs](https://support.apple.com/en-us/112580)
* [iFixit: MacBook Air 11" Early 2014](https://ts.ifixit.com/Device/MacBook_Air_11%22_Early_2014)
* [Notebookcheck: MacBook Air 11 Early 2015 review](https://www.notebookcheck.net/Apple-MacBook-Air-11-Early-2015-Notebook-Review.141993.0.html)
* [Wikimedia Commons: MacBook Air 11 inch side view](https://commons.wikimedia.org/wiki/File:MacBook_Air_11_inch_side_view.jpg)
* [Beetstech: A1465 bottom case 923-0436 (photo)](https://beetstech.com/product/macbook-air-11-inch-a1465-bottom-case-923-0436)
* [LaptopMag: MacBook Air 11 (2015) review (port photos)](https://www.laptopmag.com/reviews/laptops/macbook-air-11-2015)
* [Bambu Lab printer build volumes](https://blog.printpal.io/which-bambu-lab-printer-is-right-for-you-a-2026-buyers-guide/)
