/* MXNestSpirit — hôte Illustrator.
 * Il ne calcule rien : il lit les pièces et il les repose. Le calcul est fait par le panneau.
 */
#target illustrator

var MM = 2.834645669291339;
var TAG = 'MXNEST:';
var CUTTAG = 'MXNCUT:';

    /* --- identification du contour de coupe --- */
  function colorKey(c) {
    if (!c) return '';
    var t = c.typename;
    if (t === 'SpotColor' && c.spot) return 'spot:' + String(c.spot.name).replace(/^\s+|\s+$/g, '').toLowerCase();
    if (t === 'RGBColor') return 'rgb:' + Math.round(c.red) + ',' + Math.round(c.green) + ',' + Math.round(c.blue);
    if (t === 'CMYKColor') return 'cmyk:' + Math.round(c.cyan) + ',' + Math.round(c.magenta) + ',' +
                                   Math.round(c.yellow) + ',' + Math.round(c.black);
    if (t === 'GrayColor') return 'gray:' + Math.round(c.gray);
    return '';
  }

  function pathOf(item) {
    if (!item) return null;
    if (item.typename === 'CompoundPathItem') return item.pathItems.length ? item.pathItems[0] : null;
    return item.typename === 'PathItem' ? item : null;
  }

  function keysOf(item) {
    var p = pathOf(item), out = [];
    if (!p) return out;
    try { if (p.stroked) out.push(colorKey(p.strokeColor)); } catch (e) { }
    try { if (p.filled) out.push(colorKey(p.fillColor)); } catch (e2) { }
    return out;
  }

  function isCut(item, M) {
    var keys = keysOf(item), i, j;
    if (!keys.length) return false;
    if (M.mode === 'color') {
      for (i = 0; i < keys.length; i++) if (keys[i] && keys[i] === M.key) return true;
      return false;
    }
    for (i = 0; i < keys.length; i++) {
      if (!keys[i] || keys[i].indexOf('spot:') !== 0) continue;
      var n = keys[i].substring(5);
      for (j = 0; j < M.names.length; j++) if (n === M.names[j]) return true;
    }
    return false;
  }

  /* --- aplatissement des courbes : 0,08 mm, aucune simplification --- */
  function flatten(path, tol) {
    var pts = path.pathPoints, n = pts.length, out = [];
    if (n < 2) return out;
    var last = path.closed ? n : n - 1;
    var budget = Math.floor(6000 / n);
    if (budget > 48) budget = 48;
    if (budget < 1) budget = 1;
    for (var i = 0; i < last; i++) {
      var a = pts[i], b = pts[(i + 1) % n];
      var p0 = a.anchor, c1 = a.rightDirection, c2 = b.leftDirection, p3 = b.anchor;
      var chord = Math.abs(p3[0] - p0[0]) + Math.abs(p3[1] - p0[1]);
      var hnd = Math.abs(c1[0] - p0[0]) + Math.abs(c1[1] - p0[1]) +
                Math.abs(c2[0] - p3[0]) + Math.abs(c2[1] - p3[1]);
      var steps = 1;
      if (hnd > 0.01) {
        steps = Math.ceil((chord + hnd) / (tol * MM));
        if (steps < 6) steps = 6;
        if (steps > budget) steps = budget;      // budget de points : évite l'explosion sur les tracés très détaillés
      }
      for (var s = 0; s < steps; s++) {
        var t = s / steps, u = 1 - t;
        var x = u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0];
        var y = u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1];
        out.push([x / MM, -y / MM]);
      }
    }
    return out;
  }

  function decimate(ring, maxPts) {      // sécurité : un tracé énorme est échantillonné, jamais lissé
    if (ring.length <= maxPts) return ring;
    var step = Math.ceil(ring.length / maxPts), out = [];
    for (var i = 0; i < ring.length; i += step) out.push(ring[i]);
    return out;
  }

  function collect(item, bag) {
    var tn = item.typename, i;
    if (tn === 'PathItem') { bag.push(item); return bag; }
    if (tn === 'CompoundPathItem') {
      for (i = 0; i < item.pathItems.length; i++) bag.push(item.pathItems[i]);
      return bag;
    }
    if (tn === 'GroupItem') {
      for (i = 0; i < item.pageItems.length; i++) collect(item.pageItems[i], bag);
    }
    return bag;
  }

  /* --- parcours de l'arborescence --- */
  function kidsOf(container) {
    var out = [], i, it;
    if (container.typename === 'GroupItem') {
      for (i = 0; i < container.pageItems.length; i++) out.push(container.pageItems[i]);
      return out;
    }
    for (i = 0; i < container.pageItems.length; i++) {   // calque : pageItems descend, on filtre
      it = container.pageItems[i];
      if (it.parent && it.parent.typename === 'Layer') out.push(it);
    }
    return out;
  }

  function countCuts(item, M) {
    var tn = item.typename;
    if (tn === 'PathItem' || tn === 'CompoundPathItem') return isCut(item, M) ? 1 : 0;
    if (tn === 'GroupItem') {
      var n = 0, kids = kidsOf(item);
      for (var i = 0; i < kids.length; i++) n += countCuts(kids[i], M);
      return n;
    }
    return 0;
  }

  function cutsIn(item, M, bag) {
    var tn = item.typename, i;
    if (tn === 'PathItem' || tn === 'CompoundPathItem') { if (isCut(item, M)) bag.push(item); return bag; }
    if (tn === 'GroupItem') {
      var kids = kidsOf(item);
      for (i = 0; i < kids.length; i++) cutsIn(kids[i], M, bag);
    }
    return bag;
  }

  /* descend jusqu'au groupe qui ne contient qu'un seul contour : c'est une pièce */
  function findPieces(kids, M, out, stat, depth) {
    for (var i = 0; i < kids.length; i++) {
      var it = kids[i];
      try { if (it.locked || it.hidden) continue; } catch (e) { }
      var n = countCuts(it, M);
      if (n === 1) out.push(it);
      else if (n > 1 && it.typename === 'GroupItem' && depth < 16) findPieces(kidsOf(it), M, out, stat, depth + 1);
      else if (n > 1) out.push(it);
      else stat.orphans++;
    }
  }

  function boundsArea(it) {
    var b = it.geometricBounds;
    return Math.abs((b[2] - b[0]) * (b[1] - b[3]));
  }

  /* un contour tout seul récupère les visuels qu'il contient */
  function autoGroup(pieces, M, stat) {
    var i, bare = [];
    for (i = 0; i < pieces.length; i++) {
      if (pieces[i].typename !== 'GroupItem') bare.push({ it: pieces[i], idx: i });
    }
    if (!bare.length) return;
    bare.sort(function (a, b) { return boundsArea(a.it) - boundsArea(b.it); });

    for (i = 0; i < bare.length; i++) bare[i].it.note = 'MXNCUT';

    for (i = 0; i < bare.length; i++) {
      var cut = bare[i].it, parent = cut.parent;
      if (!parent) continue;
      if (parent.typename === 'GroupItem' && parent.name === 'MXNEST_PIECE') continue;  // déjà regroupé
      if (parent.typename === 'GroupItem') { try { if (parent.clipped) continue; } catch (e) { } }
      var cb = cut.geometricBounds, sibs = kidsOf(parent), taken = 0;
      var g;
      try { g = parent.groupItems.add(); } catch (e2) { continue; }
      g.name = 'MXNEST_PIECE';
      for (var k = sibs.length - 1; k >= 0; k--) {
        var s = sibs[k];
        if (String(s.note || '') === 'MXNCUT') continue;
        if (s.typename === 'GroupItem' && s.name === 'MXNEST_PIECE') continue;
        var sb;
        try { sb = s.geometricBounds; } catch (e3) { continue; }
        if (sb[0] >= cb[0] - 0.5 && sb[2] <= cb[2] + 0.5 && sb[1] <= cb[1] + 0.5 && sb[3] >= cb[3] - 0.5) {
          try { s.move(g, ElementPlacement.PLACEATEND); taken++; } catch (e4) { }
        }
      }
      try { cut.move(g, ElementPlacement.PLACEATBEGINNING); } catch (e5) { }
      cut.note = '';
      pieces[bare[i].idx] = g;
      stat.grouped++;
      stat.orphans -= taken;
      if (stat.orphans < 0) stat.orphans = 0;
      if (!taken) stat.noArt++;
    }
  }

  /* --- empreinte d'une pièce : coupe > masque d'écrêtage > plus grand tracé > boîte --- */
  /* Recherche du masque d'écrêtage, à tous les niveaux.
     Trois façons de le reconnaître, parce qu'Illustrator n'est pas constant :
       - le drapeau clipping sur un tracé ou un tracé transparent ;
       - le drapeau clipped sur le groupe, auquel cas le masque est son PREMIER
         enfant, même si le drapeau clipping n'est pas remonté ;
       - le drapeau clipping porté par un sous-tracé d'un tracé transparent.
     Le deuxième cas est celui qui manquait : un groupe écrêté enfoui dans un
     autre groupe ressortait sans masque, et la pièce était calculée sur la
     silhouette de ses formes au lieu de son bloc. */
  function clipOfGroup(g) {
    var kids = kidsOf(g), i, k;
    for (i = 0; i < kids.length; i++) {
      k = kids[i];
      try { if ((k.typename === 'PathItem' || k.typename === 'CompoundPathItem') && k.clipping) return k; } catch (e) { }
    }
    for (i = 0; i < kids.length; i++) {
      k = kids[i];
      if (k.typename !== 'CompoundPathItem') continue;
      try {
        for (var j = 0; j < k.pathItems.length; j++) if (k.pathItems[j].clipping) return k;
      } catch (e2) { }
    }
    var isClipped = false;
    try { isClipped = g.clipped === true; } catch (e3) { }
    if (isClipped) {
      for (i = 0; i < kids.length; i++) {
        k = kids[i];
        if (k.typename === 'PathItem' || k.typename === 'CompoundPathItem') return k;
      }
    }
    return null;
  }

  function findClip(item, depth) {
    if (!item || item.typename !== 'GroupItem' || depth > 12) return null;
    var own = clipOfGroup(item);
    if (own) return own;
    var kids = kidsOf(item), best = null, bestA = -1;
    for (var i = 0; i < kids.length; i++) {
      var deep = findClip(kids[i], depth + 1);
      if (!deep) continue;
      var A = boundsArea(deep);          // plusieurs masques imbriqués : on garde le plus grand
      if (A > bestA) { bestA = A; best = deep; }
    }
    return best;
  }

  function biggestPath(item, skipRect) {
    var bag = collect(item, []), best = null, bestA = -1;
    for (var i = 0; i < bag.length; i++) {
      try {
        if (!bag[i].closed) continue;
        if (skipRect && isRectPath(bag[i])) continue;      // on ignore les rectangles de recadrage
        if (String(bag[i].note || '') === 'MXNCLIP') continue;
        if (bag[i].parent && String(bag[i].parent.note || '') === 'MXNCLIP') continue;
        var A = boundsArea(bag[i]);
        if (A > bestA) { bestA = A; best = bag[i]; }
      } catch (e) { }
    }
    return best;
  }

  // bornes de tout ce qui est visible dans la pièce (le masque écrête, donc il borne aussi)
  function visibleBounds(item, clip) {
    var bag = collect(item, []), out = null, i;
    for (i = 0; i < bag.length; i++) {
      if (String(bag[i].note || '') === 'MXNCLIP') continue;
      if (bag[i].parent && String(bag[i].parent.note || '') === 'MXNCLIP') continue;
      var b;
      try { b = bag[i].geometricBounds; } catch (e) { continue; }
      out = out ? [Math.min(out[0], b[0]), Math.max(out[1], b[1]),
                   Math.max(out[2], b[2]), Math.min(out[3], b[3])] : [b[0], b[1], b[2], b[3]];
    }
    if (!out) { try { out = item.geometricBounds; } catch (e2) { return null; } }
    if (clip) {                                  // rien ne dépasse du masque : on recoupe
      var c = clip.geometricBounds;
      out = [Math.max(out[0], c[0]), Math.min(out[1], c[1]),
             Math.min(out[2], c[2]), Math.max(out[3], c[3])];
    }
    return out;
  }

  function covers(a, b) {                        // a englobe-t-il b, à 0,5 pt près ?
    if (!a || !b) return false;
    return a[0] <= b[0] + 0.5 && a[1] >= b[1] - 0.5 && a[2] >= b[2] - 0.5 && a[3] <= b[3] + 0.5;
  }

  function closedPaths(item) {
    var bag = collect(item, []), out = [];
    for (var i = 0; i < bag.length; i++) {
      try {
        if (!bag[i].closed) continue;
        if (String(bag[i].note || '') === 'MXNCLIP') continue;
        if (boundsArea(bag[i]) < 100) continue;         // on ignore les miettes
        out.push(bag[i]);
        if (out.length >= 60) break;
      } catch (e) { }
    }
    return out;
  }

  function boxRing(item) {          // boîte englobante en mm, y vers le bas (images, textes…)
    var b = item.geometricBounds;
    return [[[b[0] / MM, -b[1] / MM], [b[2] / MM, -b[1] / MM], [b[2] / MM, -b[3] / MM], [b[0] / MM, -b[3] / MM]]];
  }

  function footprint(item, M, tol) {
    var cuts = (M.mode === 'auto' && !M.key && !M.names.length) ? [] : cutsIn(item, M, []);
    var src = 'coupe', union = false, clipTo = null;
    if (!cuts.length && M.mode === 'auto') {
      var clip = findClip(item, 0);
      if (clip) clip.note = 'MXNCLIP';
      var big = biggestPath(item, true);                   // plus grande forme hors masque et hors cadres
      var vis = visibleBounds(item, clip);                 // tout ce que la pièce contient réellement
      if (clip) clip.note = '';

      // par défaut : le masque d'écrêtage fait foi — il borne tout ce qui est visible,
      // donc aucune pièce ne peut déborder sur sa voisine.
      // Option "serrer au dessin" : on prend la silhouette interne quand elle couvre tout.
      if (M.tight) {
        /* Serrage : silhouette de TOUTES les formes de la pièce, MAIS bornée par
           le masque — ce qui dépasse du masque n'est pas imprimé, donc ne doit
           pas gonfler la pièce. Une forme entièrement hors masque est ignorée. */
        var artAll = closedPaths(item), keep = [];
        var cb = clip ? clip.geometricBounds : null;
        for (var ai = 0; ai < artAll.length; ai++) {
          if (!cb) { keep.push(artAll[ai]); continue; }
          var ab = artAll[ai].geometricBounds;
          if (ab[2] < cb[0] || ab[0] > cb[2] || ab[3] > cb[1] || ab[1] < cb[3]) continue;  // hors masque
          keep.push(artAll[ai]);
        }
        if (keep.length) { cuts = keep; src = 'silhouette'; union = true; clipTo = clip; }
        else if (big) { cuts = [big]; src = 'tracé'; }
      }
      if (cuts.length) { /* déjà décidé */ }
      else if (M.tight && big && covers(big.geometricBounds, vis)) { cuts = [big]; src = 'tracé'; }
      else if (clip) { cuts = [clip]; src = 'masque'; }
      else if (big && covers(big.geometricBounds, vis)) { cuts = [big]; src = 'tracé'; }
      else if (big && !vis) { cuts = [big]; src = 'tracé'; }
      else {
        var all = closedPaths(item);            // silhouette complète : toutes les formes réunies
        if (all.length) { cuts = all; src = 'silhouette'; union = true; }
        else { cuts = []; src = 'boîte'; }
      }
    }
    var rings = [], subs = [], c, q;
    for (c = 0; c < cuts.length; c++) {
      if (cuts[c].typename === 'CompoundPathItem') {
        for (q = 0; q < cuts[c].pathItems.length; q++) subs.push(cuts[c].pathItems[q]);
      } else subs.push(cuts[c]);
    }
    for (var f = 0; f < subs.length; f++) {
      var poly = flatten(subs[f], tol);
      if (poly.length > 2) rings.push(poly);
    }
    if ((!rings.length || src === 'boîte') && M.mode === 'auto') {
      try {
        var vb = visibleBounds(item, findClip(item, 0)) || item.geometricBounds;
        rings = [[[vb[0] / MM, -vb[1] / MM], [vb[2] / MM, -vb[1] / MM],
                  [vb[2] / MM, -vb[3] / MM], [vb[0] / MM, -vb[3] / MM]]];
        cuts = []; src = 'boîte';
      } catch (e) { }
    }
    return { rings: rings, cuts: cuts, src: src, union: union };
  }

  // un PDF importé n'a souvent qu'un seul gros groupe : on descend dedans
  function explode(roots) {
    var guard = 0;
    while (roots.length === 1 && roots[0].typename === 'GroupItem' && guard++ < 8) {
      var clipped = false;
      try { clipped = roots[0].clipped; } catch (e) { }
      if (clipped) break;
      var kids = kidsOf(roots[0]);
      if (kids.length < 2) break;
      roots = kids;
    }
    return roots;
  }

  /* --- diagnostic : ce qu'il y a réellement dans le fichier --- */
  function diagnose(doc) {
    var spots = {}, strokes = {}, total = 0;
    function walk(item, depth) {
      var tn = item.typename, i;
      if (tn === 'PathItem' || tn === 'CompoundPathItem') {
        total++;
        var keys = keysOf(item);
        for (i = 0; i < keys.length; i++) {
          if (!keys[i]) continue;
          if (keys[i].indexOf('spot:') === 0) spots[keys[i].substring(5)] = 1;
          else strokes[keys[i]] = (strokes[keys[i]] || 0) + 1;
        }
        return;
      }
      if (tn === 'GroupItem' && depth < 16) {
        var kids = kidsOf(item);
        for (i = 0; i < kids.length; i++) walk(kids[i], depth + 1);
      }
    }
    for (var L = 0; L < doc.layers.length; L++) {
      var kids = kidsOf(doc.layers[L]);
      for (var i = 0; i < kids.length; i++) walk(kids[i], 0);
    }
    var names = [], k;
    for (k in spots) if (spots.hasOwnProperty(k)) names.push(k);
    var cols = [];
    for (k in strokes) if (strokes.hasOwnProperty(k)) cols.push([k, strokes[k]]);
    cols.sort(function (a, b) { return b[1] - a[1]; });
    return { total: total, spots: names, colors: cols };
  }

  /* --- lecture des pièces --- */
  function scan(doc, M, selOnly, regroup, tol) {
    var stat = { orphans: 0, grouped: 0, noArt: 0, byBox: 0, byMask: 0, bySil: 0 }, roots = [], i;
    if (doc.selection && doc.selection.length > 1) {
      for (i = 0; i < doc.selection.length; i++) roots.push(doc.selection[i]);
    } else if (!selOnly) {
      for (var L = 0; L < doc.layers.length; L++) {
        var lay = doc.layers[L];
        if (lay.locked || !lay.visible) continue;
        var kids = kidsOf(lay);
        for (i = 0; i < kids.length; i++) roots.push(kids[i]);
      }
    } else if (doc.selection && doc.selection.length) {
      roots.push(doc.selection[0]);
    }

    var pieces = [];
    var hasMatcher = (M.mode === 'color' && M.key) || (M.mode === 'spot' && M.names.length);
    if (hasMatcher) {
      findPieces(roots, M, pieces, stat, 0);
      if (regroup) autoGroup(pieces, M, stat);
    } else {
      pieces = explode(roots);          // mode automatique : 1 objet de premier niveau = 1 pièce
    }

    var parts = [];
    for (i = 0; i < pieces.length; i++) {
      var it = pieces[i];
      try { if (it.locked || it.hidden) continue; } catch (e) { }
      var fp = footprint(it, M, tol);
      if (!fp.rings.length) { stat.orphans++; continue; }
      if (fp.src === 'boîte') stat.byBox++;
      if (fp.src === 'silhouette') stat.bySil++;
      if (fp.src === 'masque') stat.byMask++;
      parts.push({ item: it, cuts: fp.cuts, rings: fp.rings, src: fp.src, union: fp.union,
                   name: it.name || it.typename });
    }
    return { parts: parts, stat: stat };
  }

  /* --- application dans le document --- */
  function applyResult(doc, res, fitArtboard, sheetWidth) {
    var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()];
    var rect = ab.artboardRect, originX = rect[0], originY = rect[1], done = 0;

    for (var i = 0; i < res.placements.length; i++) {
      var P = res.placements[i], item = P.part.item;
      if (P.angle) item.rotate(-P.angle, true, true, true, true, Transformation.CENTER);  // 6 arguments : le 6e est la constante de rotation

      var cuts = P.part.cuts, L = null, T = null;
      if (!cuts.length) cuts = [item];                 // pièce calée sur sa boîte (image, texte…)
      for (var k = 0; k < cuts.length; k++) {
        var gb = cuts[k].geometricBounds;
        if (L === null || gb[0] < L) L = gb[0];
        if (T === null || gb[1] > T) T = gb[1];
      }
      if (L === null) { var g2 = item.geometricBounds; L = g2[0]; T = g2[1]; }

      item.translate(originX + P.x * MM - L, originY - P.y * MM - T, true, true, true, true);
      done++;
    }

    if (fitArtboard && res.length > 0) {
      ab.artboardRect = [originX, originY, originX + sheetWidth * MM, originY - res.length * MM];
    }
    return done;
  }

  // tracé servant de modèle : un tracé de la sélection, de préférence non rempli
  function pickReference(doc) {
    if (!doc.selection || !doc.selection.length) return null;
    var bag = [], i;
    for (i = 0; i < doc.selection.length; i++) collect(doc.selection[i], bag);
    for (i = 0; i < bag.length; i++) {
      try { if (bag[i].stroked && !bag[i].filled) return bag[i]; } catch (e) { }
    }
    return bag.length ? bag[0] : null;
  }

/* ================= points d'entrée appelés par le panneau ================= */

function mxnsPing() {
  try {
    return 'OK\t' + app.name + '\t' + app.version + '\t' +
           (app.documents.length ? app.activeDocument.name : '-');
  } catch (e) { return 'ERR\t' + e; }
}

function mxnsDiag() {
  try {
    var d = diagnose(app.activeDocument), out = ['OK', 'TOTAL\t' + d.total];
    for (var i = 0; i < d.spots.length; i++) out.push('SPOT\t' + d.spots[i]);
    for (var j = 0; j < d.colors.length && j < 8; j++) out.push('COL\t' + d.colors[j][0] + '\t' + d.colors[j][1]);
    return out.join('\n');
  } catch (e) { return 'ERR\t' + e; }
}

function mxnsScan(mode, namesCsv, selOnly, regroup, tight) {
  try {
    if (!app.documents.length) return 'ERR\tAucun document ouvert';
    var doc = app.activeDocument, i;
    var names = String(namesCsv).toLowerCase().split(',');
    for (i = 0; i < names.length; i++) names[i] = names[i].replace(/^\s+|\s+$/g, '');
    var M = { mode: String(mode), names: (String(mode) === 'spot' ? names : []), key: '',
              tight: String(tight) === 'true' };
    if (M.mode === 'color') {
      var ref = pickReference(doc);
      if (!ref) return 'ERR\tSélectionne un contour de coupe avant de lancer';
      var k = keysOf(ref);
      if (!k.length) return 'ERR\tLe tracé sélectionné n\'a ni fond ni contour reconnaissable';
      M.key = k[0];
    }
    var s = scan(doc, M, String(selOnly) === 'true', String(regroup) === 'true', 0.08);
    /* Références directes conservées d'un appel à l'autre : le panneau et
       Illustrator partagent le même moteur ExtendScript pendant la session.
       L'étiquette dans la note reste en secours si ces références sont perdues. */
    $.global.MXNS_ITEMS = [null];
    $.global.MXNS_CUTS = [null];
    $.global.MXNS_SESSION = String(new Date().getTime());
    /* On retient le document analysé. Les références d'objets gardées ci-dessus
       n'ont de sens que dans CELUI-LÀ : si l'utilisateur passe sur un autre
       fichier sans relancer l'analyse, les poser reviendrait à déplacer des
       objets d'un document qui n'est plus à l'écran — ou à n'en retrouver
       aucun. C'est très exactement le scénario des « pièces oubliées ». */
    $.global.MXNS_DOC = String(doc.name) + '|' + String(doc.fullName || '');
    var out = ['OK', 'SESSION\t' + $.global.MXNS_SESSION];
    for (var p = 0; p < s.parts.length; p++) {
      var part = s.parts[p], uid = p + 1;
      $.global.MXNS_ITEMS[uid] = part.item;
      $.global.MXNS_CUTS[uid] = part.cuts;
      part.item.note = TAG + uid;
      for (var c = 0; c < part.cuts.length; c++) {
        try { part.cuts[c].note = CUTTAG + uid; } catch (eC) {}
      }
      out.push('P\t' + uid + '\t' + (part.name || 'piece') + '\t' + part.src + '\t' + (part.union ? 1 : 0));
      for (var r = 0; r < part.rings.length; r++) {
        var ring = part.rings[r], buf = [];
        for (var q = 0; q < ring.length; q++) {
          buf.push((Math.round(ring[q][0] * 100) / 100) + ',' + (Math.round(ring[q][1] * 100) / 100));
        }
        out.push('R\t' + buf.join(' '));
      }
    }
    out.push('END\t' + s.parts.length + '\t' + s.stat.orphans + '\t' + s.stat.grouped + '\t' +
             s.stat.byMask + '\t' + s.stat.bySil + '\t' + s.stat.byBox);
    return out.join('\n');
  } catch (e) { return 'ERR\t' + e + ' (ligne ' + e.line + ')'; }
}

/* payload : "uid,angle,xmm,ymm;..."  — x,y = coin haut-gauche visé */
function mxnsApply(payload, sheetWidth, lengthMm, fitArtboard, session) {
  try {
    if (!app.documents.length) return 'ERR\tAucun document ouvert';
    /* Le plan doit venir de l'analyse EN COURS : sinon on pose des pièces d'un
       autre relevé et la moitié devient introuvable. */
    var cur = '';
    try { cur = String($.global.MXNS_SESSION || ''); } catch (eS) {}
    if (String(session) && cur && String(session) !== cur) {
      return 'ERR\tCe plan vient d\'une analyse précédente. Relance Analyser, puis Imbriquer.';
    }
    var curDoc = '';
    try { curDoc = String(app.activeDocument.name) + '|' + String(app.activeDocument.fullName || ''); } catch (eD) {}
    var scanDoc = '';
    try { scanDoc = String($.global.MXNS_DOC || ''); } catch (eD2) {}
    if (scanDoc && curDoc && scanDoc !== curDoc) {
      return 'ERR\tCe plan a été calculé sur un autre document. Relance Analyser sur celui-ci.';
    }
    var doc = app.activeDocument, i, j;

    /* recherche RECURSIVE : une pièce peut être enfouie dans un groupe parent
       (PDF importé), elle n'est pas forcément au premier niveau du calque. */
    var all = [];
    function deep(it) {
      all.push(it);
      if (it.typename === 'GroupItem') {
        var k = kidsOf(it);
        for (var z = 0; z < k.length; z++) deep(k[z]);
      }
    }
    for (var L = 0; L < doc.layers.length; L++) {
      var kids = kidsOf(doc.layers[L]);
      for (i = 0; i < kids.length; i++) deep(kids[i]);
    }
    var index = {};
    for (i = 0; i < all.length; i++) {
      var nt = String(all[i].note || '');
      if (nt.indexOf(TAG) === 0) index[nt.substring(TAG.length)] = all[i];
    }

    var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()];
    var rect = ab.artboardRect, originX = rect[0], originY = rect[1];
    var rows = String(payload).split(';'), done = 0, miss = 0;

    for (var r = 0; r < rows.length; r++) {
      if (!rows[r]) continue;
      var f = rows[r].split(',');
      var item = null;
      try { if ($.global.MXNS_ITEMS && $.global.MXNS_ITEMS[f[0]]) item = $.global.MXNS_ITEMS[f[0]]; } catch (eG) {}
      try { if (item) { var probe = item.typename; } } catch (eDead) { item = null; }   // objet supprimé entre-temps
      if (!item) item = index[f[0]];
      if (!item) { miss++; continue; }
      var ang = parseFloat(f[1]), tx = parseFloat(f[2]), ty = parseFloat(f[3]);
      if (ang) item.rotate(-ang, true, true, true, true, Transformation.CENTER);

      /* on se recale sur les tracés qui ont servi au calcul, pas sur l'objet entier */
      var Lb = null, Tb = null, want = CUTTAG + f[0], cuts = null, gb;
      try { if ($.global.MXNS_CUTS) cuts = $.global.MXNS_CUTS[f[0]]; } catch (eC) {}
      if (cuts && cuts.length) {
        for (j = 0; j < cuts.length; j++) {
          try {
            gb = cuts[j].geometricBounds;
            if (Lb === null || gb[0] < Lb) Lb = gb[0];
            if (Tb === null || gb[1] > Tb) Tb = gb[1];
          } catch (eB) {}
        }
      } else {
        var bag = collect(item, []);
        for (j = 0; j < bag.length; j++) {
          if (String(bag[j].note || '') !== want) continue;
          gb = bag[j].geometricBounds;
          if (Lb === null || gb[0] < Lb) Lb = gb[0];
          if (Tb === null || gb[1] > Tb) Tb = gb[1];
        }
      }
      if (Lb === null) { var gi = item.geometricBounds; Lb = gi[0]; Tb = gi[1]; }

      item.translate(originX + tx * MM - Lb, originY - ty * MM - Tb, true, true, true, true);
      done++;
    }

    if (String(fitArtboard) === 'true' && parseFloat(lengthMm) > 0) {
      ab.artboardRect = [originX, originY,
                         originX + parseFloat(sheetWidth) * MM,
                         originY - parseFloat(lengthMm) * MM];
    }
    app.redraw();
    return 'OK\t' + done + '\t' + miss;
  } catch (e) { return 'ERR\t' + e + ' (ligne ' + e.line + ')'; }
}

function mxnsUndo() { try { app.undo(); app.redraw(); return 'OK'; } catch (e) { return 'ERR\t' + e; } }


/* ================= repères de découpe ================= */
/* Quatre ronds noirs pleins aux coins du plan de travail, sur un calque à part.
   Posés APRES l'imbrication : ils ne mangent pas de place dans le calcul.
   Diamètre et retrait réglables ; par défaut 10 mm de diamètre, 10 mm du bord,
   les valeurs relevées sur les planches de l'atelier. */

function mxnsMarks(diamMm, insetMm, layerName, dryRun, shape, lineMm) {
  try {
    if (!app.documents.length) return 'ERR\tAucun document ouvert';
    var doc = app.activeDocument;
    var d = parseFloat(String(diamMm).replace(',', '.')) || 10;
    var ins = parseFloat(String(insetMm).replace(',', '.'));
    if (isNaN(ins)) ins = 10;
    var name = String(layerName || 'Regmark');
    var dry = String(dryRun) === 'true';
    var shp = String(shape || 'circle');
    var lw = parseFloat(String(lineMm).replace(',', '.')); if (isNaN(lw) || lw <= 0) lw = 1;

    var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()].artboardRect;
    var L = ab[0], T = ab[1], R = ab[2], B = ab[3];
    var dp = d * MM, ip = ins * MM;

    /* [gauche, haut] de chaque rond, en points, y vers le haut */
    var pos = [
      [L + ip,          T - ip],
      [R - ip - dp,     T - ip],
      [L + ip,          B + ip + dp],
      [R - ip - dp,     B + ip + dp]
    ];

    /* un repère recouvert par une pièce ne sera pas lu par la caméra : on regarde
       avant de dessiner, et on le dit. */
    var covered = 0, i, j;
    var bag = [];
    for (var Lay = 0; Lay < doc.layers.length; Lay++) {
      if (doc.layers[Lay].name === name) continue;
      var kids = kidsOf(doc.layers[Lay]);
      for (i = 0; i < kids.length; i++) bag.push(kids[i]);
    }
    for (i = 0; i < pos.length; i++) {
      var mx0 = pos[i][0], my1 = pos[i][1], mx1 = mx0 + dp, my0 = my1 - dp;
      for (j = 0; j < bag.length; j++) {
        var gb;
        try { gb = bag[j].geometricBounds; } catch (eB) { continue; }
        if (gb[0] < mx1 && gb[2] > mx0 && gb[3] < my1 && gb[1] > my0) { covered++; break; }
      }
    }
    if (dry) return 'OK\t0\t' + covered;

    var layer = null;
    for (var k = 0; k < doc.layers.length; k++) {
      if (doc.layers[k].name === name) { layer = doc.layers[k]; break; }
    }
    if (!layer) { layer = doc.layers.add(); layer.name = name; }
    try { layer.locked = false; layer.visible = true; } catch (eL) {}

    /* on efface les repères précédents plutôt que de les empiler */
    for (var z = layer.pageItems.length - 1; z >= 0; z--) {
      if (String(layer.pageItems[z].name || '').indexOf('REGMARK') === 0) {
        try { layer.pageItems[z].remove(); } catch (eR) {}
      }
    }

    /* noir franc : un noir riche bouge sous la caméra, et un contour changerait
       la taille mesurée par le capteur. */
    var black;
    try {
      if (doc.documentColorSpace === DocumentColorSpace.CMYK) {
        black = new CMYKColor();
        black.cyan = 0; black.magenta = 0; black.yellow = 0; black.black = 100;
      } else {
        black = new RGBColor();
        black.red = 0; black.green = 0; black.blue = 0;
      }
    } catch (eC) {
      black = new RGBColor(); black.red = 0; black.green = 0; black.blue = 0;
    }

    var made = 0;
    for (i = 0; i < pos.length; i++) {
      var el;
      if (shp === 'square') {
        el = layer.pathItems.rectangle(pos[i][1], pos[i][0], dp, dp);
        el.filled = true; el.fillColor = black; el.stroked = false;
      } else if (shp === 'corner') {
        /* Angle rentrant, tracé d'un seul trait — Graphtec impose une ligne
           unique : deux traits croisés donnent un angle ébréché que le capteur
           ne lit pas. Le sommet de l'angle est le point de référence. */
        var dirX = (i === 0 || i === 2) ? 1 : -1;
        var dirY = (i < 2) ? -1 : 1;
        var half = lw * MM / 2;
        var cx = (dirX > 0 ? pos[i][0] : pos[i][0] + dp) + dirX * half;
        var cy = (dirY < 0 ? pos[i][1] : pos[i][1] - dp) + dirY * half;
        el = layer.pathItems.add();
        el.setEntirePath([[cx + dirX * dp, cy], [cx, cy], [cx, cy + dirY * dp]]);
        el.filled = false;
        el.stroked = true; el.strokeColor = black; el.strokeWidth = lw * MM;
        try { el.strokeJoin = StrokeJoin.MITERENDJOIN; } catch (eJ) {}
        try { el.strokeCap = StrokeCap.BUTTENDCAP; } catch (eP) {}
      } else {
        el = layer.pathItems.ellipse(pos[i][1], pos[i][0], dp, dp);
        el.filled = true; el.fillColor = black; el.stroked = false;
      }
      el.name = 'REGMARK_' + (i + 1);
      made++;
    }
    try { layer.locked = true; } catch (eK) {}
    app.redraw();
    return 'OK\t' + made + '\t' + covered;
  } catch (e) { return 'ERR\t' + e + ' (ligne ' + e.line + ')'; }
}


/* ================= fond perdu =================
 * On remplace la géométrie du MASQUE d'écrêtage par le contour élargi calculé
 * dans le panneau. Le tracé de coupe n'est pas touché : la lame coupe toujours
 * au même endroit, mais le dessin déborde derrière, ce qui évite le liseré
 * blanc si la découpe dévie d'un cheveu.
 *
 * Une pièce sans masque est laissée telle quelle et comptée à part : sans
 * masque, il n'y a rien à élargir, et toucher au dessin lui-même serait le
 * déformer.
 *
 * payload : "uid|x,y x,y ...;uid|..."  en millimètres, y vers le bas
 */
function mxnsBleed(payload, session) {
  try {
    if (!app.documents.length) return 'ERR\tAucun document ouvert';
    var cur = '';
    try { cur = String($.global.MXNS_SESSION || ''); } catch (eS) {}
    if (String(session) && cur && String(session) !== cur) {
      return 'ERR\tCe fond perdu vient d\'une analyse précédente. Relance Analyser.';
    }
    var doc = app.activeDocument;
    var curDoc = '', scanDoc = '';
    try { curDoc = String(doc.name) + '|' + String(doc.fullName || ''); } catch (eD) {}
    try { scanDoc = String($.global.MXNS_DOC || ''); } catch (eD2) {}
    if (scanDoc && curDoc && scanDoc !== curDoc) {
      return 'ERR\tAnalyse faite sur un autre document. Relance Analyser ici.';
    }

    /* SÉLECTION D'ABORD.
     * Un fond perdu ne se décide pas planche entière : sur un kit, certaines
     * pièces en veulent, d'autres non — un numéro collé bord à bord n'a rien à
     * faire déborder. Si quelque chose est sélectionné dans Illustrator, on ne
     * traite que ça ; sinon, tout le document. C'est la règle de tous les
     * outils de prépresse, et c'est celle qu'on attend.
     *
     * Une pièce compte comme sélectionnée si l'objet sélectionné est la pièce
     * elle-même, son parent (on a cliqué le groupe), ou l'un de ses enfants
     * (on a cliqué le tracé de coupe à l'intérieur). */
    var selOnly = [], si;
    try {
      if (doc.selection && doc.selection.length) {
        for (si = 0; si < doc.selection.length; si++) selOnly.push(doc.selection[si]);
      }
    } catch (eSel) { selOnly = []; }

    function sameItem(a, b) {
      if (!a || !b) return false;
      try { if (a === b) return true; } catch (e1) {}
      try {
        if (a.typename !== b.typename) return false;
        var ga = a.geometricBounds, gb = b.geometricBounds;
        if (Math.abs(ga[0] - gb[0]) > 0.001 || Math.abs(ga[1] - gb[1]) > 0.001) return false;
        if (Math.abs(ga[2] - gb[2]) > 0.001 || Math.abs(ga[3] - gb[3]) > 0.001) return false;
        return String(a.name || '') === String(b.name || '');
      } catch (e2) { return false; }
    }

    function isSelected(item) {
      if (!selOnly.length) return true;              // rien de sélectionné : tout le document
      var k;
      for (k = 0; k < selOnly.length; k++) {
        if (sameItem(item, selOnly[k])) return true;
        /* l'objet sélectionné est-il DANS la pièce ? */
        var bag = collect(item, []);
        for (var b = 0; b < bag.length; b++) if (sameItem(bag[b], selOnly[k])) return true;
        /* la pièce est-elle DANS l'objet sélectionné ? */
        if (selOnly[k].typename === 'GroupItem') {
          var bag2 = [];
          try { bag2 = kidsOf(selOnly[k]); } catch (e3) { bag2 = []; }
          for (var c = 0; c < bag2.length; c++) if (sameItem(bag2[c], item)) return true;
        }
      }
      return false;
    }

    var rows = String(payload).split(';'), done = 0, noMask = 0, skipped = 0;
    for (var r = 0; r < rows.length; r++) {
      if (!rows[r]) continue;
      var cut = rows[r].indexOf('|');
      if (cut < 0) continue;
      var uid = rows[r].substring(0, cut);
      var pts = rows[r].substring(cut + 1).split(' ');

      var item = null;
      try { if ($.global.MXNS_ITEMS) item = $.global.MXNS_ITEMS[uid]; } catch (eG) {}
      if (!item) continue;
      try { var probe = item.typename; } catch (eDead) { continue; }

      if (!isSelected(item)) { skipped++; continue; }

      var clip = findClip(item, 0);
      if (!clip || clip.typename !== 'PathItem') { noMask++; continue; }

      var arr = [];
      for (var i = 0; i < pts.length; i++) {
        var xy = pts[i].split(',');
        if (xy.length !== 2) continue;
        arr.push([parseFloat(xy[0]) * MM, -parseFloat(xy[1]) * MM]);
      }
      if (arr.length < 3) continue;
      try {
        clip.setEntirePath(arr);
        clip.closed = true;
        done++;
      } catch (eSet) { }
    }
    app.redraw();
    return 'OK\t' + done + '\t' + noMask + '\t' + skipped + '\t' + (selOnly.length ? '1' : '0');
  } catch (e) { return 'ERR\t' + e + ' (ligne ' + e.line + ')'; }
}
