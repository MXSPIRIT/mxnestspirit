# MXNestSpirit

True-shape nesting for Adobe Illustrator, built for motocross graphics kits.
Free, open source, written in a workshop that has been producing kits since 2009.

**MX Spirit — Montpellier, France** · [Version française](README-fr.md)

---

## What's new in 1.1 — the Sparrow engine

Version 1.0 shipped with one engine of my own: a raster true-shape nester. It
matched eCut on a real kit — 0.826 m against 0.829 m.

Version 1.1 adds a second engine, **Sparrow**, an academic solver from KU Leuven,
state of the art for 2D irregular strip packing, MIT licensed. Both now run on
the same job and the shorter sheet wins.

On a real 83-part kit:

| Engine | Sheet length |
|---|---|
| Built-in engine | 0.800 m |
| **Sparrow** | **0.721 m** |

**Around 10 cm saved per sheet, roughly 10 %.** Over a hundred kits, ten metres
of vinyl.

> **Sparrow is Windows-only in this release.** The bundled solver is a Windows
> executable. On macOS the panel falls back to the built-in engine: everything
> works, you simply don't get the extra 10 %. A macOS build — or the WebAssembly
> version of Sparrow — would fix that. Contributions welcome.

## What it does

It lays your parts out on the roll following their **real outline**, not their
bounding box. Each part stays one block: cut contour, clipping mask and logos
rotate together.

- free rotation every 5 to 30°, or locked for gradient films
- guaranteed blade gap and edge margin, never quietly reduced
- small parts drop into the gaps between large ones, and into their holes
- registration marks drawn afterwards, on their own locked layer
- automatic check: no two parts may touch, and the panel says so if they do

## Install

1. Download the latest release zip
2. Unzip it
3. **Windows**: double-click `install-windows.bat`
   **macOS**: double-click `install-mac.command` (blocked? right-click > Open)
4. Restart Illustrator → **Window > Extensions > MXNestSpirit**

Illustrator CC 2014 and newer.

### Security — please read before installing

The installer turns on `PlayerDebugMode`, the Illustrator setting that lets
**unsigned** extensions load. Commercial plugins avoid this by buying a code
signing certificate; free projects generally don't. Once enabled it applies to
every extension, not just this one — so keep installing only extensions whose
source you can read.

The panel itself does nothing hidden: it reads the paths of your open document,
computes, moves the objects, draws circles on a layer. It never accesses the
network and never sends anything anywhere. Every line of it is readable text in
this repository.

One exception you should know about: `bin/sparrow.exe` is a **compiled binary**,
not source. It is a build of [Sparrow](https://github.com/JeroenGar/sparrow),
MIT licensed. If you would rather not run a binary you didn't build yourself,
either delete it — the panel falls back to the built-in engine — or build
Sparrow from the official repository and replace the file.

## How to use

**Analyse → Full nesting → Apply → Add marks.**

`Ctrl+Z` undoes the whole nest in one step.

Changed a setting? Run nesting again. Changed the document? Analyse again.

Two buttons:

- **Full nesting** — Sparrow searches, the built-in engine stands by as a
  fallback. One to two minutes, and the one that saves vinyl.
- **Nesting V10 only** — the built-in engine alone, a few seconds, for a quick
  look.

### Settings that matter

| Setting | Advice |
|---|---|
| Blade gap | 1 mm if your cutter tracks well, 2 mm otherwise |
| Precision | 1 mm. At 2 mm the grid alone adds about 2 mm of empty space between parts |
| Rotation | every 10°. Finer brings no measurable gain |
| Search | Normal for daily work, Maximum on large kits |
| Max length | 0 for a free-running roll, or a value to cap the sheet |

### When nothing is found

Click **What's in this file?** — it lists the spot colours and the stroke colours
actually present. Then select one cut contour in Illustrator and choose
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
in the calculation, and the panel warns you if a part covers one.

Two presets carry real figures:

- **Valiani** — 10 mm circles, measured on production sheets
- **Graphtec CE7000 / FC9000** — corner L marks, 20 mm, 1 mm line. The manual
  allows 5 to 20 mm and 0.3 to 1.0 mm, and requires a single line

Summa, Zünd, Roland and Gerber are left blank on purpose. Nothing is guessed
here: a mark of the wrong size is invisible on screen and ruins a printed sheet.
Set it once from a validated file, then click Remember.

## Inside

Contours are flattened to 0.08 mm with no simplification — that is what keeps
parts from being distorted. The built-in engine rasterises them into a bitmask
processed 32 pixels at a time, and places each part by true-shape
bottom-left-fill: the part falls toward the start of the roll, then slides left,
testing the real outline, so it settles into its neighbours' hollows.

Sparrow works differently: it places everything, then repeatedly shakes the
layout and compresses the strip — which is why it finds shorter sheets. The
bridge feeds it simplified geometry, and gives the simplification back to the
blade gap, so the real spacing is never smaller than you asked for.

The panel runs in Chrome, not in Illustrator's scripting engine: same code,
30 to 50 times faster. Illustrator only reads the parts and puts them back.

## Known limits

- Sparrow is Windows-only in this release
- a part wider than the roll is rotated automatically; if it still doesn't fit,
  it is reported and left in place
- no automatic mirroring: a left/right kit keeps both parts
- no production report, and no manual touch-up after nesting yet
- on a fully flattened PDF with no contours and no groups, part detection stays
  approximate — no tool on the market does better on that input

## Credits

- [Sparrow](https://github.com/JeroenGar/sparrow) — Jeroen Gardeyn, KU Leuven, MIT
- [jagua-rs](https://github.com/JeroenGar/jagua-rs) — collision engine, MIT
- [Clipper](http://www.angusj.com/delphi/clipper.php) — polygon operations, Boost

## Licence

GPL v3. Use it, change it, redistribute it. If you distribute a modified
version, you distribute your changes too.
