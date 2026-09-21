/* MXNestSpirit — français / anglais.
   Le panneau garde la langue choisie d'une session à l'autre. */
var I18N = (function () {
  'use strict';

  var EN = {
    'lbl.sheet': 'Roll width (mm)',
    'lbl.gap': 'Blade gap (mm)',
    'lbl.edge': 'Edge margin (mm)',
    'lbl.maxlen': 'Max length (mm)',
    'lbl.rot': 'Rotation',
    'lbl.prec': 'Precision',
    'lbl.effort': 'Search',
    'lbl.sptime': 'Sparrow time (s)',
    'lbl.mode': 'Part detection',
    'lbl.cutnames': 'Accepted names',
    'lbl.mpreset': 'Marks — machine',
    'lbl.mshape': 'Shape',
    'lbl.markd': 'Size (mm)',
    'lbl.marki': 'Edge inset (mm)',
    'lbl.markw': 'Line (mm, corner marks)',
    'lbl.finish': 'Finishing — once the sheet is approved',
    'lbl.bleed': 'Offset (mm)',
    'lbl.bleedmode': 'What to offset',
    'bm.newcut': 'New cut contour',
    'bm.replace': 'Grow the existing contour',
    'bm.mask': 'Grow the mask (bleed)',
    'btn.reset': 'Reset everything',
    'lbl.inks': 'Document inks',
    'btn.inklist': 'Refresh',
    'btn.inkselect': 'Select objects',
    'btn.inkapply': 'Apply all',
    'btn.inkrename': 'Rename',
    'txt.inkscope': 'Tick one or more inks to select or rename them. Choose what each ink becomes in its column, then Apply all: every conversion runs in one click. Selection if any, otherwise the whole document.',
    'btn.stop': 'Stop',
    'lbl.widths': 'Saved widths',
    'btn.widthsave': 'Save',
    'btn.widthdel': 'Forget',
    'lbl.fillmax': 'Logos in the offcut (max)',
    'btn.fill': 'Scatter the logo',
    'btn.clearfill': 'Remove the logos',
    'btn.bleed': 'Apply offset',
    'chk.bleedgap': 'Count the offset in the blade gap',

    'rot.5': 'Every 5°',
    'rot.10': 'Every 10°',
    'rot.15': 'Every 15°',
    'rot.30': 'Every 30°',
    'rot.90': 'Quarter turns only',
    'rot.0': 'No rotation',
    'prec.1': '1 mm',
    'prec.05': '0.5 mm',
    'prec.2': '2 mm',
    'eff.fast': 'Fast',
    'eff.normal': 'Normal',
    'eff.max': 'Maximum (tightest)',
    'mode.auto': 'Automatic',
    'mode.color': 'Same colour as the selected path',
    'mode.spot': 'Named spot colour',
    'shape.circle': 'Filled circle',
    'shape.square': 'Filled square',
    'shape.corner': 'Corner L',
    'm.valiani': 'Valiani — 10 mm circles',
    'm.graphtec': 'Graphtec CE7000 / FC9000 — corner L',
    'm.summa': 'Summa — to be set',
    'm.zund': 'Zünd — to be set',
    'm.roland': 'Roland — to be set',
    'm.gerber': 'Gerber Edge — to be set',
    'm.autre': 'Other machine — to be set',

    'chk.refine': 'Refine after nesting (10–15 s more, pays off 1 time in 7)',
    'chk.pairs': 'Pair parts two by two (slow, rarely pays off)',
    'chk.holes': 'Fill the gaps with small parts',
    'chk.regroup': 'Attach artwork to its contour',
    'chk.tight': 'Tighten to artwork instead of the mask',
    'chk.selonly': 'Selection only',
    'chk.fitab': 'Fit the artboard to the sheet length',

    'btn.scan': 'Analyse',
    'btn.diag': "What's in this file?",
    'btn.run': 'Nesting V10 only',
    'btn.hybrid': 'Full nesting',
    'btn.apply': 'Apply',
    'btn.marks': 'Add marks',
    'btn.save': 'Remember',

    'hdr.width': 'roll width',
    'hdr.fill': 'fill',
    'hdr.waste': 'waste',

    /* messages */
    'msg.start': 'Open your kit, then analyse the document.',
    'msg.reading': 'Reading the document…',
    'msg.ready': '{n} parts ready.',
    'msg.none': "No part found — try What's in this file?",
    'msg.search': 'Search {i}/{n}…',
    'msg.refining': 'Refining {i}/{n}…',
    'msg.done': 'Done in {s} s.',
    'msg.contact': '{n} part(s) touching — blade gap too small.',
    'msg.unplaced': '{n} part(s) not placed: sheet too short, or part wider than the roll.',
    'msg.applied': '{n} part(s) placed{miss}. Ctrl+Z undoes everything.',
    'msg.miss': ' — {n} not found',
    'msg.marks': '{n} mark(s) drawn on the Regmark layer{warn}',
    'msg.markswarn': ' — WARNING, {n} mark(s) covered by a part.',
    'msg.saved': 'Mark settings remembered for "{name}".',
    'msg.nopreset': 'No known figures for this machine: set the shape, size and inset from a validated file, then click Remember.',
    'msg.selcolor': 'Select one cut contour in Illustrator, then click Analyse.',
    'msg.bleedscanning': 'Reading the part silhouettes…',
    'msg.rescan': 'Geometry changed: run Analyse again before nesting.',
    'msg.fillnoplan': 'Compute a sheet first.',
    'msg.fillreading': 'Reading the selected logo…',
    'msg.fillzero': 'No room for this logo in the offcut — try a smaller one.',
    'msg.fillok': '{n} copies of "{nom}" scattered in the offcut.',
    'msg.fillcleared': '{n} logo(s) removed.',
    'msg.stopping': 'Stopping — keeping the best plan found.',
    'msg.widthsaved': 'Roll width {n} mm saved.',
    'msg.widthdel': 'Roll width {n} mm forgotten.',
    'msg.reset': 'Everything reset — {n} tag(s) removed from the document.',
    'msg.noplan': 'No layout found.',
    'msg.single': 'Computing on a single core…'
  };

  var lang = 'fr';
  try { lang = window.localStorage.getItem('mxns_lang') || 'fr'; } catch (e) { }

  function t(key, vars) {
    var s = (lang === 'en' && EN[key]) ? EN[key] : null;
    if (s === null) return null;              // français : on garde le texte d'origine
    if (vars) {
      for (var k in vars) if (vars.hasOwnProperty(k)) s = s.split('{' + k + '}').join(vars[k]);
    }
    return s;
  }

  function apply() {
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i], key = n.getAttribute('data-i18n');
      if (!n.getAttribute('data-fr')) n.setAttribute('data-fr', n.textContent);
      n.textContent = (lang === 'en' && EN[key]) ? EN[key] : n.getAttribute('data-fr');
    }
    try { window.localStorage.setItem('mxns_lang', lang); } catch (e) { }
  }

  function set(l) { lang = l; apply(); }
  function get() { return lang; }

  return { t: t, apply: apply, set: set, get: get };
})();
