# MXNestSpirit

True-shape nesting for Adobe Illustrator, built for motocross graphics kits.
Free and open source, written in a workshop that has been producing kits since 2009.

**MX Spirit — Montpellier, France** · [Version française](README-fr.md)

---

## What it does

It lays your parts out on the roll following their **real outline**, not their
bounding box. Each part stays one block: cut contour, clipping mask and logos
all rotate together.

- free rotation every 5 to 30°, or locked for gradient films
- guaranteed blade gap and edge margin, never quietly reduced
- small parts drop into the gaps between large ones, and into their holes
- optional pairing of parts, kept only when it actually shortens the sheet
- registration marks drawn afterwards, on their own locked layer
- automatic check: the tool verifies that no two parts touch

## Measured results

Real Husqvarna kit, 16 parts, 1350 mm roll, 1 mm blade gap:

| Search level | Length | Fill | Time |
|---|---|---|---|
| Fast | 0.862 m | 61.4 % | 2 s |
| Normal | 0.830 m | 63.7 % | 5 s |
| Maximum | **0.826 m** | 64.1 % | 36 s |
| eCut (paid reference) | 0.829 m | — | — |

Zero overlap in all three, checked automatically.

## Install

1. Download the latest release zip
2. Unzip it
3. **Windows**: double-click `install-windows.bat`
   **macOS**: double-click `install-mac.command` (blocked? right-click > Open)
4. Restart Illustrator → **Window > Extensions > MXNestSpirit**

Illustrator CC 2014 and newer, Windows and macOS.

### Security — please read before installing

The installer turns on `PlayerDebugMode`, the Illustrator setting that allows
**unsigned** extensions to load. Commercial plugins avoid this by buying a code
signing certificate; free projects generally do not.

Once enabled, the setting applies to every extension, not just this one — so
keep installing only extensions whose source you can read.

This one does nothing hidden: it reads the paths of your open document,
computes, moves the objects, draws circles on a layer. It never accesses the
network, never opens another file, never sends anything anywhere. All of it is
plain readable text in this repository — nothing compiled.

## How to use

**Analyse → Nesting → Apply → Add marks.**

`Ctrl+Z` undoes the whole nest in one step.

Changed a setting? Run Nesting again. Changed the document? Run Analyse again.

### Settings that matter

| Setting | Advice |
|---|---|
| Blade gap | 1 mm if your cutter tracks well, 2 mm otherwise |
| Precision | 1 mm. At 2 mm the grid alone adds about 2 mm of empty space between parts |
| Rotation | every 10°. Finer brings no measurable gain |
| Search | Normal for daily work, Maximum on large kits |
| Max length | 0 for a free-running roll, or a value to cap the sheet |

### When nothing is found

Click **What's in this file?** — it lists the spot colours and the stroke
colours actually present. Then select one cut contour in Illustrator and choose
"Same colour as the selected path".

## How a part is recognised

Per part, in order:

1. the spot-colour cut path (CutContour and friends), if there is one
2. otherwise the group's clipping mask, searched at every depth
3. otherwise the combined silhouette of every shape in the group
4. otherwise the bounding box (raster image with no outline)

"Tighten to artwork" forces the silhouette instead of the mask, bounded by the
mask: whatever falls outside the mask is not printed, so it does not count.

## Registration marks

Filled circle, filled square, or corner L. Size, inset and line width
adjustable, drawn on a locked `Regmark` layer after nesting — they take no space
in the calculation, and the tool warns you if a part covers one.

Two presets carry real figures:

- **Valiani** — 10 mm circles, measured on production sheets
- **Graphtec CE7000 / FC9000** — corner L marks, 20 mm, 1 mm line. The manual
  allows 5 to 20 mm and 0.3 to 1.0 mm, and requires a single line

Summa, Zünd, Roland and Gerber are deliberately left blank. Nothing is guessed
here: a mark of the wrong size is invisible on screen and ruins a printed sheet.
Set it once from a validated file, then click Remember.

## Inside

Contours are flattened to 0.08 mm with no simplification at all — that is what
keeps parts from being distorted. They are then rasterised into a bitmask
processed 32 pixels at a time.

Placement is a true-shape bottom-left-fill: each part falls toward the start of
the roll then slides left, testing the real outline. It settles into the hollows
of its neighbours rather than merely beside them.

The blade gap comes from dilating the footprint already placed, never from
shrinking the part: the geometry applied in Illustrator is exactly yours.

The engine runs inside the panel — in Chrome, not in Illustrator's scripting
engine. Same code, 30 to 50 times faster. Illustrator only reads the parts and
puts them back down.

## Known limits

- a part wider than the roll is rotated automatically; if it still does not fit,
  it is reported and left in place
- no automatic mirroring: a left/right kit keeps both parts
- no production report, and no manual touch-up after nesting yet
- on a fully flattened PDF with no contours and no groups, part detection stays
  approximate — and no tool on the market does better on that input

## Licence

GPL v3. Use it, change it, redistribute it. If you distribute a modified
version, you distribute your changes too.
