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
* **Clips:** each clip is a *wedge clip*. A lip overhangs the screen bezel or
  palm rest, with a 45° ramp under it. The edge of the laptop wedges onto
  that ramp anywhere across about a 0.9 mm height range while the TPU wall
  flexes outwards, so the clip grips snugly even if the real laptop is a bit
  thicker or thinner than my measurements. The lid and base clips are
  staggered, so only one 0.6 mm lip sits in the lid/keyboard gap at any
  point and the laptop still closes.
* **Fit backtested virtually** before printing. The design was checked
  against a 3D model of the A1465 for fit, closing, hinge swing, rubber
  feet and port plugs, plus a Monte-Carlo tolerance analysis. See
  [Fit backtest](#fit-backtest).

## Which files to print

There is no Bambu "T1S". These files assume a **256 × 256 mm** bed
(P1S, P2S, X1C, A1). That bed is too small for a 303 mm case, so each shell
is split into **LEFT** and **RIGHT** halves. The split runs along the
scale grooves, and four dovetail-shaped scales lock the halves together.
If you have an H2D or H2S, you can print the one-piece versions instead.

| Folder (in `3mf/`) | What | ~TPU each |
|---|---|---|
| `1_fit_tests/` | 5 lid front-corner sizes, 1 lid rear-corner hinge check, 3 base front strips (A/B/C), 3 base rear strips (A/B/C) | 5–10 g |
| `2_lid_shell/` | `lid_shell_lid-<size>mm_LEFT` + `_RIGHT` for lids 4.40 / 4.65 / 4.90 / 5.15 / 5.40 mm | ~64 g |
| `3_base_shell/` | `base_shell_front-<A/B/C>_rear-<A/B/C>_LEFT` + `_RIGHT` (all 9 combinations) | ~62 g |
| `4_one_piece_for_big_beds/` | one-piece lid and base in the nominal sizes (lid 4.90, front-B rear-B) | ~126 g |

The nominal sizes are **lid 4.90 mm** and base **front-B rear-B**. The 3MF
files open directly in Bambu Studio. The generator also writes STL copies
of the fit tests and nominal shells to `stl/` (not stored in git). Leave
every part in its exported orientation, textured face down.

## Step 1: print the fit tests (about 1.5 h, about 100 g for all 12)

Apple publishes the outside footprint but not the lid thickness or the
base's wedge profile. I estimated those, and the backtest shows that
printing blind at the nominal size fits well only about 6 times in 10.
Printing these small pieces first and picking the matching size raises that
to about 9 in 10. A full case is about 250 g of TPU, so the tests are worth
the hour.

**Print the fit tests and the final shells with exactly the same filament,
plate, layer height and first-layer height.** Clip heights are counted in
layers, so a different layer height gives a slightly different fit.

1. **Lid front corner, 5 sizes.** Close the laptop and press each one onto
   the **front-left corner of the lid**.
   * The right size clicks over the screen edge, sits flat on the back of
     the lid, and doesn't rattle when you tap it.
   * Too thin a size won't seat, or bows up. Too thick a size wobbles, or
     its lip floats above the bezel.
   * If two sizes feel equally good, pick the thicker one.
2. **Base front strip A/B/C.** Lay the laptop's **front-left corner** in
   the strip; the front rubber foot drops into the hole. The right one's
   side clip (30–58 mm from the front) snaps over the palm-rest edge, and
   the laptop sits flat on the strip.
3. **Base rear strip A/B/C.** Same test at the **rear-left corner**, using
   the side clip at 94–113 mm. Also check that the rear foot drops into its
   hole, and that MagSafe, USB and the headphone jack are inside the
   window.
4. **Lid rear-corner hinge check.** Clip it onto the rear-left corner of
   the lid and **open the lid all the way**. It must not touch the base or
   the table edge behind it.

Your picks give the files to print, e.g. lid **4.90 mm** plus base
**front-B rear-A**.

## Step 2: print the shells

Print four plates, one half each: `lid_shell_lid-<your size>_LEFT`, its
`_RIGHT`, and `base_shell_front-<X>_rear-<Y>_LEFT` and `_RIGHT`. The base
**LEFT** half is the one with the long port window, on the MagSafe side.

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

## Fit backtest

`fit_backtest.py` builds a 3D stand-in of the A1465 from the measurements
below: a wedge base with rolled edges and rubber feet, the curved lid, the
lid/keyboard gap, the hinge axis and port plugs. It then puts the generated
shells on it and checks them with exact mesh booleans.

**Geometry checks** (all pass at the nominal size, and under each stress
case: tighter or looser edge rolls, thin or thick lid edges, a laptop 0.5 mm
wider, feet 3 mm off, ports 5 mm off either way, a 0.6 mm lid gap):

* Nothing pushes into the laptop except the intended clip wedges, about
  0.75 mm of wall flex.
* Both shells on and the laptop closed: no collisions.
* Lid opened 0→135° with the hinge axis anywhere within ±1.5 mm of the
  estimate: the lid shell's back edge never touches the base or base shell.
* All four rubber feet sit inside their Ø25 mm holes, and every plug body
  (MagSafe 2, USB-A, Thunderbolt, 3.5 mm) clears its window.

![sections](backtest_sections.png)
![hinge](backtest_hinge.png)
![ports](backtest_ports.png)

**Tolerance analysis.** 40,000 simulated laptops, with every uncertain
dimension (lid thickness, wedge profile, width, gap, foot and port
positions) varied by its estimated uncertainty, plus printer shrink and Z
error:

| | Snug fit | Fits (maybe a bit tight or loose) |
|---|---|---|
| Whole case, print nominal sizes blind | 59.6 % | 85.1 % |
| **Whole case, fit tests first, then matching sizes** | **92.8 %** | **95.9 %** |
| Lid shell with fit test | 96.2 % | 96.3 % |
| Base shell with fit tests | 95.8 % | 96.1 % |

"Snug" means each clip either wedges onto its ramp with no free play, or
bends at most 0.45 mm; the width is within the range TPU stretches over;
the laptop closes; and the feet land in their holes. The remaining misses
are mostly simulated laptops whose lid or wedge falls outside every printed
size. `fit_backtest_results.json` has the full numbers.

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
