/* MXNestSpirit Hybrid 0.2
 * V10 = motocross heuristics / compact / ruin-recreate
 * Sparrow = native irregular-strip search
 *
 * This file deliberately does not replace the V10 engine. It generates a V10
 * candidate, asks Sparrow for an independent candidate on the same geometry,
 * converts Sparrow's verified placements back into V10 coordinates, then lets
 * the V10 local-search tools tighten that candidate before choosing the winner.
 */
(function () {
  'use strict';

  function $id(id) { return document.getElementById(id); }
  function num(id, fallback) {
    var v = parseFloat($id(id).value);
    return isFinite(v) ? v : fallback;
  }

  function makeOptions() {
    var rot = num('rot', 0);
    var effort = parseInt($id('effort').value, 10) || 16;
    var o = {
      sheetWidth: num('sheet', 1350),
      gap: Math.max(0, num('gap', 6)),
      edgeMargin: Math.max(0, num('edge', 0)),
      resolution: num('prec', 1),
      angleStep: rot === 0 ? -1 : rot,
      candidates: effort >= 100 ? 30 : effort >= 16 ? 24 : 16,
      angleTries: effort >= 100 ? 14 : effort >= 16 ? 12 : 8,
      fillHoles: !!$id('holes').checked,
      smallPx: 120000,
      scanFine: 8,
      maxLength: 60000,
      xStep: effort >= 100 ? 3 : effort >= 16 ? 4 : 6
    };
    return o;
  }

  function areaOf(parts) {
    var a = 0;
    for (var i = 0; i < parts.length; i++) a += MXNest.netArea(parts[i]);
    return a;
  }

  function better(a, b) {
    if (!a) return b;
    if (!b) return a;
    var af = a.failed ? a.failed.length : 0;
    var bf = b.failed ? b.failed.length : 0;
    var ac = a.placements ? a.placements.length : 0;
    var bc = b.placements ? b.placements.length : 0;
    /* A zero/partial candidate is never a winner merely because its computed
     * length is zero. This was the bug that produced the 0.000 m screen. */
    if (ac === 0 && bc > 0) return b;
    if (bc === 0 && ac > 0) return a;
    if (bf < af) return b;
    if (bf > af) return a;
    return b.length < a.length - 0.01 ? b : a;
  }

  function runV10(parts, opt, tries, done) {
    var orders = MXNest.orderings(parts, tries);
    var i = 0, best = null;
    function step() {
      if (i >= orders.length) {
        if (best) {
          try { MXNest.compact(best, opt, 4); } catch (e1) {}
          try {
            MXNest.ruinRecreate(best, parts, opt, tries >= 100 ? 120 : 60,
                                Math.floor(Math.random() * 2000000000));
          } catch (e2) {}
        }
        done(best);
        return;
      }
      try {
        var r = MXNest.nestOnce(parts, orders[i], opt, null);
        if (r) best = better(best, r);
      } catch (e) {}
      i++;
      if (i % 2 === 0) {
        if (window.MXNestSpirit) window.MXNestSpirit.hint('V10 : recherche ' + i + '/' + orders.length + '…');
      }
      setTimeout(step, 0);
    }
    step();
  }

  function toV10Result(parts, sr) {
    /* SparrowBridge.readSolution returns the ORIGINAL part.id, but never trust
     * an external/native boundary blindly. The old hybrid silently skipped a
     * placement when that id did not match and then calculated a perfectly
     * legal-looking 0 mm result. A complete Sparrow solution must become a
     * complete V10 candidate, or the conversion is rejected. */
    var byId = {}, i;
    for (i = 0; i < parts.length; i++) byId[String(parts[i].id)] = parts[i];

    var placements = [], missing = [];
    for (i = 0; i < sr.placements.length; i++) {
      var sp = sr.placements[i];
      var part = byId[String(sp.id)];
      /* Defensive fallback for numeric item ids: if a producer ever returns
       * the Sparrow item index rather than the original part id, recover it by
       * position. This is only accepted when the candidate is unambiguous. */
      if (!part && /^\d+$/.test(String(sp.id))) {
        var idx = Number(sp.id);
        if (idx >= 0 && idx < parts.length) part = parts[idx];
      }
      if (!part) { missing.push(String(sp.id)); continue; }

      var deg = Number(sp.rotationDeg);
      if (!isFinite(deg)) throw new Error('SPARROW_BAD_ROTATION_FOR_' + String(sp.id));
      var target = sp.targetBboxMinMm;
      if (!target || !isFinite(target.x) || !isFinite(target.y))
        throw new Error('SPARROW_BAD_TARGET_FOR_' + String(sp.id));

      /* DEUX CONVENTIONS DE ROTATION OPPOSÉES — c'est ici que le plan de Sparrow
       * se perdait.
       *
       *   MXNest.rotatePoly(p, rad)  tourne autour de l'ORIGINE, sens direct.
       *   rotateMulti(polys, deg)    tourne autour du CENTRE de la pièce, sens
       *                              inverse — c'est la convention du pont.
       *
       * L'ancienne conversion tournait les anneaux avec la première et le cadre
       * avec la seconde, puis comparait leurs boîtes. Chaque pièce repartait
       * donc avec un décalage propre : sur un kit de 83 pièces, un plan de
       * 0,72 m ressortait éparpillé sur 3,00 m.
       *
       * Corrigé en deux temps : on tourne TOUT avec la convention du pont pour
       * calculer la position, et on renvoie l'angle OPPOSÉ, qui est celui que
       * la pose dans Illustrator attend — elle applique rotate(-angle), ce qui
       * reproduit exactement l'orientation choisie par Sparrow. */
      var frame = SparrowBridge._internal.cutFrame(part);
      var sourceRings = Array.isArray(part.rings) ? part.rings : (Array.isArray(part.contours) ? part.contours : []);
      var usable = [];
      for (var rr = 0; rr < sourceRings.length; rr++) {
        if (Array.isArray(sourceRings[rr]) && sourceRings[rr].length >= 3) usable.push(sourceRings[rr]);
      }
      if (!usable.length) throw new Error('SPARROW_PART_HAS_NO_VALID_RINGS_' + String(part.id));

      var allRot = SparrowBridge._internal.rotateMulti(usable, deg);
      var frameRot = SparrowBridge._internal.rotateMulti(frame, deg);
      var rbo = SparrowBridge._internal.bboxOf(allRot);
      var fb = SparrowBridge._internal.bboxOf(frameRot);
      var tx = target.x + (rbo.minX - fb.minX);
      var ty = target.y + (rbo.minY - fb.minY);
      var w = rbo.maxX - rbo.minX, h = rbo.maxY - rbo.minY;
      deg = -deg;                       // angle rendu à la pose Illustrator
      if (!(isFinite(tx) && isFinite(ty) && isFinite(w) && isFinite(h) && w >= 0 && h >= 0))
        throw new Error('SPARROW_BAD_PLACEMENT_FOR_' + String(part.id));

      placements.push({ part: part, angle: deg, x: tx, y: ty, w: w, h: h });
    }

    if (missing.length) throw new Error('SPARROW_ID_MAPPING_FAILED_' + missing.join(','));
    if (placements.length !== parts.length)
      throw new Error('SPARROW_CONVERSION_INCOMPLETE_' + placements.length + '/' + parts.length);

    var len = 0;
    for (i = 0; i < placements.length; i++) {
      var bottom = placements[i].y + placements[i].h;
      if (bottom > len) len = bottom;
    }
    if (!(len > 0)) throw new Error('SPARROW_CONVERSION_ZERO_LENGTH');

    return {
      placements: placements,
      failed: [],
      length: len,
      partArea: areaOf(parts),
      sheetWidth: num('sheet', 1350),
      fill: len > 0 ? areaOf(parts) / (len * num('sheet', 1350)) : 0,
      hybridSource: 'Sparrow'
    };
  }

  function normalizeForSparrow(parts) {
    var out = [], skipped = [];
    for (var i = 0; i < (parts || []).length; i++) {
      var p = parts[i], rings = p && Array.isArray(p.rings) ? p.rings : [];
      var clean = [];
      for (var r = 0; r < rings.length; r++) {
        var ring = rings[r];
        if (!Array.isArray(ring)) continue;
        var pts = [];
        for (var k = 0; k < ring.length; k++) {
          var q = ring[k];
          if (Array.isArray(q) && q.length >= 2 && isFinite(q[0]) && isFinite(q[1])) pts.push([Number(q[0]), Number(q[1])]);
        }
        if (pts.length >= 3) clean.push(pts);
      }
      if (!clean.length) { skipped.push(p && p.id !== undefined ? p.id : i); continue; }
      out.push({ id: p.id, name: p.name, union: !!p.union, contours: clean });
    }
    return { parts: out, skipped: skipped };
  }

  function runSparrow(parts, opt, done, fail) {
    if (!window.SparrowBridge || !window.SparrowRun) {
      fail(new Error('SPARROW_BRIDGE_NOT_LOADED')); return;
    }
    if (!SparrowRun.available()) {
      var d = SparrowRun.diagnose ? SparrowRun.diagnose() : null;
      var e0 = new Error('SPARROW_UNAVAILABLE');
      e0.detail = d ? ('binary=' + d.binaryExists + ' · process=' + d.createProcess + ' · stat=' + d.cepFsStat + ' · path=' + d.binary) : 'diagnostic unavailable';
      fail(e0); return;
    }

    var effort = parseInt($id('effort').value, 10) || 16;
    var seconds = effort >= 100 ? 90 : effort >= 16 ? 60 : 25;
    var norm = normalizeForSparrow(parts);
    if (norm.skipped.length) {
      var ne = new Error('SPARROW_INVALID_GEOMETRY');
      ne.detail = 'pièces sans contour valide: ' + norm.skipped.join(', ');
      fail(ne); return;
    }

    /* Échelle de repli : un plan Sparrow valide
     * JSON is not necessarily a usable nest. jagua-rs can return a solution with
     * zero/partial placements when an irregular outline cannot survive the
     * requested separation. The old hybrid accepted that empty solution and its
     * 0 mm length then beat V10. We now reject incomplete results and retry with
     * the same progressively safer geometry rungs. */
    /* ORDRE DES NIVEAUX — corrigé.
     *
     * Avant, le premier niveau essayé était eps 0, c'est-à-dire les contours
     * bruts. Sur un kit réel, ça fait 25 000 points pour 25 pièces, jusqu'à
     * 1 600 pour une seule. Sparrow construit ses structures de collision à
     * partir de ces points : à ce volume il passe ses soixante secondes à
     * ramer au lieu d'explorer, et rend un plan médiocre. Comme la boucle
     * garde le PREMIER résultat valide, elle s'arrêtait toujours là.
     *
     * Mesuré sur le kit M73 : à 0,2 mm de tolérance le nombre de points est
     * divisé par quatorze et la surface des pièces ne bouge que de 0,03 %.
     * On commence donc par une géométrie que le moteur peut réellement
     * optimiser, et on ne descend vers les contours bruts qu'en dernier
     * recours, si tous les autres niveaux ont été refusés.
     *
     * La simplification peut raboter jusqu'à eps vers l'intérieur : on rend
     * cet eps à l'écart de lame (voir sepFor plus bas), de sorte que l'écart
     * réel entre deux pièces reste au moins celui demandé. */
    var rungs = [
      { eps: 0.25, hullGroups: false, forceHull: false },
      { eps: 0.5, hullGroups: false, forceHull: false },
      { eps: 0.1, hullGroups: false, forceHull: false },
      { eps: 1.5, hullGroups: false, forceHull: false },
      { eps: 0, hullGroups: false, forceHull: false },
      { eps: 0, hullGroups: true, forceHull: false },
      { eps: 0, hullGroups: false, forceHull: true }
    ];

    /* L'écart demandé, plus ce que la simplification a pu grignoter. */
    function sepFor(rung) { return (opt.gap || 0) + (rung.eps || 0); }
    var bestSr = null, bestMeta = null, lastErr = null;
    var total = rungs.length;

    function attempt(ridx) {
      if (ridx >= total) {
        if (bestSr) { done(bestSr); return; }
        fail(lastErr || new Error('SPARROW_NO_VALID_SOLUTION'));
        return;
      }
      var rung = rungs[ridx];
      if (window.MXNestSpirit) window.MXNestSpirit.hint('Sparrow : essai ' + (ridx + 1) + '/' + total + '…');
      var built;
      try {
        built = SparrowBridge.buildInstance(norm.parts, {
          usableWidthMm: opt.sheetWidth,
          spacingMm: opt.gap,
          /* Sparrow cherche en rotation continue. Le panneau
           * deliberately passes free rotation rather than mirroring V10's finite
           * angle menu. */
          rotStepDeg: 0,
          simplifyEpsMm: rung.eps,
          forceHull: rung.forceHull,
          hullGroups: rung.hullGroups
        });
      } catch (eBuild) { lastErr = eBuild; attempt(ridx + 1); return; }

      SparrowRun.run(built.instance, {
        seconds: seconds,
        separationMm: sepFor(rung),
        seed: Math.floor((Date.now() + ridx * 7919) % 2147483647),
        onLog: function (txt) {
          if (!window.MXNestSpirit) return;
          /* Sparrow n'écrit son JSON qu'à la toute fin : impossible de dessiner
             la planche en cours de route. En revanche il annonce chaque
             amélioration dans son journal — « feasible solution found! (width:
             721.4 ...) ». La largeur de bande, chez lui, c'est notre métrage.
             On la suit donc en direct : le chiffre descend sous les yeux même
             si les pièces ne bougent pas encore. */
          var all = String(txt), best = null, m;
          var re = /width:\s*([0-9]+(?:\.[0-9]+)?)/g;
          while ((m = re.exec(all)) !== null) {
            var v = parseFloat(m[1]);
            if (isFinite(v) && v > 0 && (best === null || v < best)) best = v;
          }
          if (best !== null) {
            window.MXNestSpirit.hint('Sparrow cherche… meilleure planche : ' +
                                     (best / 1000).toFixed(3) + ' m');
            return;
          }
          var lines = all.split(/[\r\n]+/), last = '';
          for (var i = lines.length - 1; i >= 0; i--) if (lines[i]) { last = lines[i]; break; }
          if (last) window.MXNestSpirit.hint('Sparrow : ' + last.substring(0, 90));
        }
      }).then(function (solution) {
        try {
          var sr = SparrowBridge.readSolution(solution, norm.parts, built.meta);
          var expected = norm.parts.length;
          if (!sr || !Array.isArray(sr.placements) || sr.placements.length === 0) {
            throw new Error('SPARROW_EMPTY_SOLUTION_' + (sr && sr.placements ? sr.placements.length : 0));
          }
          if (sr.placements.length !== expected || sr.notPlacedCount > 0 || sr.duplicatePlacements > 0) {
            throw new Error('SPARROW_INCOMPLETE_' + sr.placements.length + '/' + expected);
          }
          if (sr.maxErrorMm > 0.05) throw new Error('SPARROW_PLACEMENT_MISMATCH_' + sr.maxErrorMm.toFixed(3) + 'mm');
          if (sr.widthOvershootMm > 0.5) throw new Error('SPARROW_WIDTH_OVERSHOOT_' + sr.widthOvershootMm.toFixed(3) + 'mm');
          sr._meta = built.meta;
          sr._rung = rung;
          sr._sourceParts = norm.parts;
          /* First complete, geometry-verified result wins this rung. This mirrors
           * l'échelle est un mécanisme de repli en cas de plan refusé ou vide
           * geometry, not six serial 60-second searches of the same kit. */
          done(sr);
        } catch (eRead) {
          lastErr = eRead;
          attempt(ridx + 1);
        }
      }).catch(function (eRun) {
        lastErr = eRun;
        attempt(ridx + 1);
      });
    }
    attempt(0);
  }

  function verify(r, opt) {
    try { return MXNest.verify(r, opt); } catch (e) { return -1; }
  }

  function runHybrid() {
    if (!window.MXNestSpirit) return;
    var parts = window.MXNestSpirit.getParts();
    if (!parts || !parts.length) {
      window.MXNestSpirit.hint('Analyse d’abord le document.');
      return;
    }

    var opt = makeOptions();
    var tries = parseInt($id('effort').value, 10) || 16;
    var t0 = Date.now();
    window.MXNestSpirit.setBusy(true);
    window.MXNestSpirit.hint('Hybrid : V10 + Sparrow…');

    /* V10 n'est plus le moteur principal du bouton hybride : Sparrow cherche
     * mieux globalement. V10 reste le filet de sécurité — si Sparrow ne démarre
     * pas, échoue, ou rend un plan refusé par les contrôles, on a un plan
     * valide sous la main. Quatre essais suffisent pour ça, au lieu de seize ou
     * cent : sur un kit de 83 pièces ça rend une trentaine de secondes, et la
     * différence ne se voit pas puisque ce plan ne sert qu'en secours. */
    var v10Tries = Math.min(tries, 4);
    runV10(parts, opt, v10Tries, function (v10) {
      if (v10) {
        v10.sheetWidth = opt.sheetWidth;
        v10.partArea = areaOf(parts);
        v10.fill = v10.length > 0 ? v10.partArea / (v10.length * opt.sheetWidth) : 0;
      }
      window.MXNestSpirit.hint('Hybrid : V10 terminé. Lancement de Sparrow…');

      runSparrow(parts, opt, function (sr) {
        /* Le plan de Sparrow, converti tel quel : c'est LUI le candidat, et sa
         * longueur réelle est celle-ci — mesurée sur les contours d'origine,
         * pas sur la géométrie simplifiée envoyée au solveur. */
        var sp0 = toV10Result(parts, sr);
        var rawLen = sp0.length;

        /* V10 tente ensuite de resserrer localement. Mais compact() et
         * ruinRecreate() reposent les pièces sur la grille d'angles de V10 —
         * multiples de 10° — alors que Sparrow travaille en rotation continue.
         * Un plan de Sparrow retouché par V10 ressortait plus LONG que le plan
         * d'origine (0,733 m devenu 0,842 m sur un kit de 83 pièces), et le
         * pont finissait par garder V10. On garde donc une copie intacte et on
         * ne conserve la retouche que si elle raccourcit vraiment. */
        var sp = {
          placements: sp0.placements.slice(0), failed: sp0.failed,
          length: sp0.length, partArea: sp0.partArea,
          sheetWidth: sp0.sheetWidth, fill: sp0.fill, hybridSource: sp0.hybridSource
        };
        try { MXNest.compact(sp, opt, 6); } catch (e1) {}
        try { MXNest.ruinRecreate(sp, parts, opt, tries >= 100 ? 300 : 140,
                                 Math.floor(Math.random() * 2000000000)); } catch (e2) {}
        sp.length = sp.placements.reduce(function (m, p) { return Math.max(m, p.y + p.h); }, 0);
        if (!(sp.length < rawLen - 0.01)) { sp = sp0; sp.length = rawLen; }
        sp.fill = sp.length > 0 ? sp.partArea / (sp.length * opt.sheetWidth) : 0;
        sp._rawLen = rawLen;

        var best = better(v10, sp);
        best.sheetWidth = opt.sheetWidth;
        best.partArea = areaOf(parts);
        best.fill = best.length > 0 ? best.partArea / (best.length * opt.sheetWidth) : 0;
        best.hybridSource = best === sp ? 'V10 + Sparrow' : 'V10';

        var bad = verify(best, opt);
        var elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        window.MXNestSpirit.setExternalResult(best);
        window.MXNestSpirit.log(
          'HYBRID : V10 secours ' + (v10 ? (v10.length / 1000).toFixed(3) : '—') + ' m · ' +
          'Sparrow brut ' + (sr.usedLengthMm / 1000).toFixed(3) + ' m · ' +
          'Sparrow converti ' + ((sp._rawLen || 0) / 1000).toFixed(3) + ' m · ' +
          'Sparrow + V10 ' + (sp.length / 1000).toFixed(3) + ' m · ' +
          'retenu ' + (best.length / 1000).toFixed(3) + ' m · ' +
          best.placements.length + '/' + parts.length + ' pièces · ' + elapsed + ' s' +
          (bad === 0 ? ' · 0 collision' : bad > 0 ? ' · ' + bad + ' CONTACT' : '') +
          (best.placements.length !== parts.length ? ' · PLAN INCOMPLET' : ''));
        window.MXNestSpirit.hint('Hybrid terminé : ' + (best.length / 1000).toFixed(3) + ' m' +
                                 (best === sp ? ' — Sparrow + affinage V10 retenu.' : ' — V10 reste meilleur.'));
        window.MXNestSpirit.setBusy(false);
      }, function (err) {
        // A missing/blocked Sparrow must never destroy the good V10 result.
        if (v10) {
          v10.sheetWidth = opt.sheetWidth;
          v10.partArea = areaOf(parts);
          v10.fill = v10.length > 0 ? v10.partArea / (v10.length * opt.sheetWidth) : 0;
          v10.hybridSource = 'V10 (Sparrow indisponible)';
          window.MXNestSpirit.setExternalResult(v10);
        }
        var em = err && err.message ? err.message : String(err);
        var ed = err && err.detail ? (' · ' + err.detail) : '';
        window.MXNestSpirit.log('HYBRID : Sparrow erreur — ' + em + ed);
        window.MXNestSpirit.hint(v10 ? ('Sparrow : ' + em + ed) : ('Hybrid : ' + em + ed), 'warn');
        window.MXNestSpirit.setBusy(false);
      });
    });
  }

  function init() {
    var b = $id('hybrid');
    if (!b) return;
    b.addEventListener('click', runHybrid);
    try { SparrowRun.warmup(); } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
