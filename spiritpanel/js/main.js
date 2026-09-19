/* MXNestSpirit — panneau. Le calcul tourne ici, dans Chrome. */
(function () {
  'use strict';

  var watchedDoc = null;

  var cs = new CSInterface();
  var $ = function (id) { return document.getElementById(id); };
  var parts = [], result = null, busy = false, session = '';

  function log(m) { var e = $('log'); e.textContent = m + '\n' + e.textContent; }
  function hint(m, cls) { var h = $('hint'); h.textContent = m; h.className = 'hint' + (cls ? ' ' + cls : ''); }
  function T(key, vars, fr) { var s = I18N.t(key, vars); return s === null ? fr : s; }
  function esc(s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
  function call(fn, args, cb) {
    var a = (args || []).map(function (v) { return '"' + esc(v) + '"'; }).join(',');
    cs.evalScript(fn + '(' + a + ')', function (r) { cb(String(r)); });
  }
  function lock(on) {
    busy = on;
    $('scan').disabled = on;
    $('diag').disabled = on;
    $('run').disabled = on || !parts.length;
    $('apply').disabled = on || !result;
    if ($('hybrid')) $('hybrid').disabled = on || !parts.length;
    $('marks').disabled = on;
    $('msave').disabled = on;
    $('dobleed').disabled = on;
  }


  /* ---------- calcul en parallèle ----------
     Un seul cœur travaillait pendant que les sept autres regardaient. Chaque
     ouvrier reçoit le même jeu de pièces et calcule une tranche des essais ;
     la liste des essais étant déterministe, chacun sait exactement lesquels
     lui reviennent sans qu'on ait à se les transmettre.
     Si les ouvriers ne démarrent pas (installation verrouillée), on retombe
     sans bruit sur le calcul séquentiel. */
  var WORKER_SRC = null;

  function workerSource(cb) {
    if (WORKER_SRC !== null) { cb(WORKER_SRC); return; }
    try {
      var x = new XMLHttpRequest();
      x.open('GET', 'js/engine.js', true);
      x.onload = function () {
        WORKER_SRC = x.responseText + '\n' + GLUE;
        cb(WORKER_SRC);
      };
      x.onerror = function () { cb(null); };
      x.send();
    } catch (e) { cb(null); }
  }

  var REBUILD = [
    'function rebuildParts(flat) {',
    '  var c = flat.coords, k = 0, out = [];',
    '  for (var i = 0; i < flat.meta.length; i++) {',
    '    var m = flat.meta[i], rings = [];',
    '    for (var r = 0; r < m.rings.length; r++) {',
    '      var n = m.rings[r], ring = new Array(n);',
    '      for (var q = 0; q < n; q++) { ring[q] = [c[k], c[k + 1]]; k += 2; }',
    '      rings.push(ring);',
    '    }',
    '    out.push({ id: m.id, name: m.name, union: m.union, rings: rings });',
    '  }',
    '  return out;',
    '}'
  ].join('\n');

  var GLUE = [
    REBUILD,
    'self.onmessage = function (e) {',
    '  var d = e.data, best = null;',
    '  var parts = rebuildParts(d.flat);',
    '  d.flat = null;',
    '  var orders = MXNest.orderings(parts, d.total);',
    '  for (var i = d.from; i < d.to && i < orders.length; i++) {',
    '    var r = MXNest.nestOnce(parts, orders[i], d.opt, null);',
    '    if (!r) continue;',
    '    if (!best || r.failed.length < best.failed.length ||',
    '       (r.failed.length === best.failed.length && r.length < best.length)) best = r;',
    '    self.postMessage({ progress: 1 });',
    '  }',
    '  self.postMessage({ done: true, result: best });',
    '};'
  ].join('\n');

  /* Les contours ne sont plus recopiés dans chaque ouvrier : ils partent une
     seule fois, à plat, dans un tableau de nombres transféré (et non cloné).
     Une copie complète du kit par ouvrier, c'est ce qui saturait la mémoire du
     panneau et le faisait tuer en fin de calcul, sans message d'erreur. */
  function flattenParts(list) {
    var xs = [], meta = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i], ringsMeta = [];
      for (var r = 0; r < p.rings.length; r++) {
        var ring = p.rings[r];
        ringsMeta.push(ring.length);
        for (var q = 0; q < ring.length; q++) { xs.push(ring[q][0]); xs.push(ring[q][1]); }
      }
      meta.push({ id: p.id, name: p.name, union: !!p.union, rings: ringsMeta });
    }
    return { coords: new Float64Array(xs), meta: meta };
  }


  function runParallel(list, opt, total, onProgress, done) {
    workerSource(function (src) {
      if (!src) { done(null); return; }
      var n = 4;
      try { n = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)); } catch (e) {}
      if (list.length > 60) n = Math.min(n, 2);
      if (total < n) n = Math.max(1, total);

      var url, workers = [], best = null, finished = 0, seen = 0, failed = false;
      try {
        url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      } catch (e2) { done(null); return; }

      function stopAll() {
        for (var q = 0; q < workers.length; q++) { try { workers[q].terminate(); } catch (e4) {} }
        try { URL.revokeObjectURL(url); } catch (e6) {}
      }

      var per = Math.ceil(total / n);
      for (var w = 0; w < n; w++) {
        var from = w * per, to = Math.min(total, from + per);
        if (from >= to) break;
        var wk;
        try { wk = new Worker(url); } catch (e3) { failed = true; break; }
        workers.push(wk);
        wk.onerror = function () {
          if (failed) return;
          failed = true;
          stopAll();
          done(best);            // on rend ce qui a été trouvé, jamais rien
        };
        wk.onmessage = function (ev) {
          if (failed) return;
          var msg = ev.data;
          if (msg.progress) { seen++; if (seen % 4 === 0 || seen === total) onProgress(seen, total); return; }
          if (msg.done) {
            var r = msg.result;
            if (r && (!best || r.length < best.length)) { best = r; onProgress(seen, total, best); }
            finished++;
            if (finished >= workers.length) { stopAll(); done(best); }
          }
        };
        /* un exemplaire des contours par ouvrier, mais TRANSFÉRÉ : le tableau
           change de propriétaire au lieu d'être dupliqué. */
        var flat = flattenParts(list);
        wk.postMessage({ flat: flat, opt: opt, total: total, from: from, to: to },
                       [flat.coords.buffer]);
      }
      if (failed || !workers.length) { stopAll(); done(best); }
    });
  }

  function options() {
    var rot = $('rot').value;
    var o = {
      sheetWidth: parseFloat($('sheet').value) || 1350,
      gap: (function () {
        var g = parseFloat($('gap').value) || 0;
        var b = parseFloat($('bleed').value) || 0;
        /* Chaque pièce déborde de b : deux voisines doivent donc s'écarter de
           2b en plus, sinon un fond perdu s'imprime sur la découpe de l'autre. */
        if (b > 0 && $('bleedgap').checked) g += 2 * b;
        return g;
      })(),
      edgeMargin: parseFloat($('edge').value) || 0,
      resolution: parseFloat($('prec').value) || 1,
      angleStep: rot === '0' ? -1 : parseFloat(rot),
      candidates: 24,
      angleTries: 10,
      fillHoles: $('holes').checked,
      smallPx: 120000,      // seuil « petite pièce » : elle balaie toute la planche
      scanFine: 8,
      maxLength: (parseFloat($('maxlen').value) > 0 ? parseFloat($('maxlen').value) : 60000)
    };
    o.xStep = o.resolution >= 1 ? 6 : 4;
    return o;
  }

  $('mode').addEventListener('change', function () {
    $('namesrow').style.display = this.value === 'spot' ? '' : 'none';
    if (this.value === 'color') hint(T('msg.selcolor', null, 'Sélectionne un contour de coupe dans Illustrator, puis Analyser.'));
  });

  // ---------- analyse ----------
  $('scan').addEventListener('click', function () {
    lock(true);
    hint(T('msg.reading', null, 'Lecture du document…'));
    call('mxnsScan', [$('mode').value, $('cutnames').value,
                      $('selonly').checked ? 'true' : 'false',
                      $('regroup').checked ? 'true' : 'false',
                      $('tight').checked ? 'true' : 'false'], function (txt) {
      var lines = txt.split('\n');
      if (lines[0].indexOf('ERR') === 0) { hint(lines[0].split('\t')[1], 'err'); lock(false); return; }
      var list = [], cur = null, stat = null;
      session = '';
      for (var i = 1; i < lines.length; i++) {
        var f = lines[i].split('\t');
        if (f[0] === 'SESSION') session = f[1];
        else if (f[0] === 'P') { cur = { id: f[1], name: f[2], src: f[3], union: f[4] === '1', rings: [] }; list.push(cur); }
        else if (f[0] === 'R' && cur) {
          var pts = f[1].split(' '), ring = [];
          for (var k = 0; k < pts.length; k++) {
            var xy = pts[k].split(',');
            ring.push([parseFloat(xy[0]), parseFloat(xy[1])]);
          }
          if (ring.length > 2) cur.rings.push(ring);
        } else if (f[0] === 'END') stat = f;
      }
      for (var j = list.length - 1; j >= 0; j--) if (!list[j].rings.length) list.splice(j, 1);
      parts = list;
      result = null;
      setResult(null);
      draw(null);
      if (!parts.length) hint(T('msg.none', null, 'Aucune pièce trouvée — essaie « Que contient le fichier ? »'), 'err');
      else hint(T('msg.ready', { n: parts.length }, parts.length + ' pièces prêtes.'));
      if (stat) log('Analyse : ' + stat[1] + ' pièces, ' + stat[2] + ' ignorés, ' + stat[3] + ' regroupés · ' +
                    stat[4] + ' masque, ' + stat[5] + ' silhouette, ' + stat[6] + ' boîte.');
      lock(false);
    });
  });

  $('diag').addEventListener('click', function () {
    lock(true);
    call('mxnsDiag', [], function (txt) {
      var lines = txt.split('\n'), out = [];
      for (var i = 0; i < lines.length; i++) {
        var f = lines[i].split('\t');
        if (f[0] === 'TOTAL') out.push(f[1] + ' tracés');
        if (f[0] === 'SPOT') out.push('ton direct : ' + f[1]);
        if (f[0] === 'COL') out.push(f[1] + ' × ' + f[2]);
      }
      log(out.join('\n'));
      hint('Contenu listé ci-dessous.');
      lock(false);
    });
  });

  // ---------- imbrication ----------
  $('run').addEventListener('click', function () {
    if (!parts.length || busy) return;
    lock(true);
    var opt = options();
    var tries = parseInt($('effort').value, 10) || 12;
    // plus on se donne d'essais, plus on fouille finement à chaque essai
    if (tries >= 100) { opt.angleTries = 14; opt.xStep = 3; opt.candidates = 30; }
    else if (tries >= 16) { opt.angleTries = 12; opt.xStep = 4; opt.candidates = 24; }
    else { opt.angleTries = 8; opt.xStep = 6; opt.candidates = 16; }
    var t0 = Date.now();
    var best = null, pairsMade = 0;

    function runSequential(list, done) {
      var orders = MXNest.orderings(list, tries), i = 0, b = null;
      (function step() {
        if (i >= orders.length) { done(b); return; }
        hint(T('msg.search', { i: i + 1, n: orders.length }, 'Recherche ' + (i + 1) + '/' + orders.length + '…'));
        var r = null;
        try { r = MXNest.nestOnce(list, orders[i], opt, null); } catch (eRun) { r = null; }
        if (r && (!b || r.failed.length < b.failed.length ||
                 (r.failed.length === b.failed.length && r.length < b.length))) {
          b = r;
          result = b;                 // applicable immédiatement, sans attendre la fin
          setResult(b);
          draw(b);
          $('apply').disabled = false;
        }
        i++;
        setTimeout(step, 0);
      })();
    }

    function runList(list, done) {
      runSequential(list, done);
      return;
      /* eslint-disable no-unreachable */
      runParallel(list, opt, tries, function (seen, tot, cur) {
        hint('Recherche ' + seen + '/' + tot + ' (calcul réparti sur plusieurs cœurs)…');
        if (cur) { setResult(cur); draw(cur); }
      }, function (b) {
        if (b) { done(b); return; }
        hint(T('msg.single', null, 'Calcul sur un seul cœur…'));
        runSequential(list, done);
      });
    }

    runList(parts, function (plain) {
      best = plain;
      if (!$('pairs').checked || parts.length < 2 || parts.length > 60) return refine(finish);
      hint('Essai d\'emboîtement par paires…');
      setTimeout(function () {
        try {
          var resP = MXNest.safeResolution(parts, opt);
          var pr = MXNest.buildPairs(parts, opt, resP, Math.round(opt.gap * resP), 24);
          if (!pr.made) return finish();
          runList(pr.parts, function (withPairs) {
            if (withPairs && best && withPairs.length < best.length - 0.5) { best = withPairs; pairsMade = pr.made; }
            refine(finish);
          });
        } catch (e) { refine(finish); }
      }, 0);
    });

    /* Affinage : on démolit et on repose quelques pièces, par paquets, pour que
       le panneau reste vivant et que l'aperçu suive. Chaque paquet ne peut que
       raccourcir le plan, jamais l'allonger. */
    function refine(done) {
      var total = !$('refine').checked ? 0 : (tries >= 100 ? 1200 : 400);
      if (!total || !best || best.placements.length < 4) { done(); return; }
      var doneRounds = 0;
      (function step() {
        if (doneRounds >= total) { done(); return; }
        hint(T('msg.refining', { i: doneRounds, n: total }, 'Affinage ' + doneRounds + '/' + total + '…'));
        try {
          /* graine tirée au hasard à chaque paquet : l'affinage ne paie qu'une
             fois sur sept environ, autant multiplier les tirages. Il ne peut
             jamais rallonger le plan, seulement le raccourcir. */
          MXNest.ruinRecreate(best, parts, opt, 50, Math.floor(Math.random() * 2000000000));
          result = best;
          setResult(best);
          draw(best);
        } catch (e) { done(); return; }
        doneRounds += 50;
        setTimeout(step, 0);
      })();
    }

    function finish() {
      if (!best) { best = result; }
      result = best;
      if (!result) { hint(T('msg.noplan', null, 'Aucun plan trouvé.'), 'err'); lock(false); return; }
      setResult(best);
      draw(best);
      var bad = -1;
      try {
        /* sur un très gros kit, la vérification coûte autant qu'un essai :
           on la saute plutôt que de risquer de perdre le résultat. */
        if (best && best.placements.length <= 120) bad = MXNest.verify(best, opt);
      } catch (e) { bad = -1; }
      var s = ((Date.now() - t0) / 1000).toFixed(1);
      log('Imbrication : ' + best.placements.length + ' pièces, ' + (best.length / 1000).toFixed(3) + ' m, ' +
          (best.fill * 100).toFixed(1) + ' % en ' + s + ' s' +
          (pairsMade ? ' · ' + pairsMade + ' couple(s) retenus' : '') +
          (bad === 0 ? ' · aucun contact' : bad > 0 ? ' · ' + bad + ' CONTACT' : ''));
      var nf = best.failed ? best.failed.length : 0;
      hint(nf > 0 ? T('msg.unplaced', { n: nf }, nf + ' pièce(s) non placée(s) : planche trop courte ou pièce plus large que la laize.')
         : bad > 0 ? T('msg.contact', { n: bad }, bad + ' pièce(s) en contact — écart lame trop faible.')
         : T('msg.done', { s: s }, 'Terminé en ' + s + ' s.'),
           (nf > 0 || bad > 0) ? 'warn' : null);
      lock(false);
    }
  });

  function setResult(r) {
    $('wid').textContent = (parseFloat($('sheet').value) || 1350) + ' mm';
    if (!r) {
      $('len').textContent = '—'; $('fill').textContent = '—'; $('waste').textContent = '—';
      $('result').className = 'result';
      return;
    }
    $('len').textContent = (r.length / 1000).toFixed(3).replace('.', ',');
    $('fill').textContent = (r.fill * 100).toFixed(1).replace('.', ',') + ' %';
    var surf = r.length * r.sheetWidth / 1e6;
    if (!r.sheetWidth) surf = r.length * (parseFloat($('sheet').value) || 1350) / 1e6;
    $('waste').textContent = (surf - r.partArea / 1e6).toFixed(2).replace('.', ',') + ' m²';
    $('result').className = 'result done';
  }

  // ---------- aperçu ----------
  var PAL = ['#ff5a1f', '#4aa3df', '#6ec07a', '#e8c14a', '#b07ad4', '#4fc3bd'];

  function draw(r) {
    var cv = $('preview'), ctx = cv.getContext('2d');
    var sw = parseFloat($('sheet').value) || 1350;
    var len = r ? Math.max(r.length, 100) : sw * 0.5;

    /* L'aperçu tenait toute la largeur et laissait la hauteur filer : sur une
       planche longue, il débordait ; en panneau large, il restait riquiqui avec
       du vide autour. On le met maintenant à l'échelle des DEUX dimensions
       disponibles, en gardant les proportions de la planche — ce qu'on voit
       correspond donc vraiment au rapport laize/métrage. */
    var host = cv.parentNode;
    var availW = (host && host.clientWidth ? host.clientWidth : 380) - 2;
    var top = 0;
    try { top = cv.getBoundingClientRect().top; } catch (e) { top = 200; }
    var availH = Math.max(160, (window.innerHeight || 900) - top - 70);
    if (availW < 60) availW = 380;

    var scale = Math.min(availW / sw, availH / len);
    if (!isFinite(scale) || scale <= 0) scale = availW / sw;

    cv.width = Math.max(60, Math.round(sw * scale));
    cv.height = Math.max(40, Math.round(len * scale));
    ctx.fillStyle = '#1c1c1c';
    ctx.fillRect(0, 0, cv.width, cv.height);
    if (!r) return;
    for (var p = 0; p < r.placements.length; p++) {
      var P = r.placements[p], src = P.part;
      if (!src) continue;
      var rings = [];
      for (var k = 0; k < src.rings.length; k++) rings.push(MXNest.rotatePoly(src.rings[k], P.angle * Math.PI / 180));
      var bb = MXNest.bboxOf(rings);
      var dx = P.x - bb[0], dy = P.y - bb[1];
      ctx.beginPath();
      for (var i = 0; i < rings.length; i++) {
        for (var q = 0; q < rings[i].length; q++) {
          var X = (rings[i][q][0] + dx) * scale, Y = (rings[i][q][1] + dy) * scale;
          if (q === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
        }
        ctx.closePath();
      }
      ctx.fillStyle = PAL[p % PAL.length];
      ctx.globalAlpha = 0.6;
      ctx.fill(src.union ? 'nonzero' : 'evenodd');
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // ---------- application ----------
  $('apply').addEventListener('click', function () {
    if (!result || busy) return;

    /* Garde-fou : un plan doit contenir AUTANT de pièces que l'analyse en a
       trouvées. Si ce n'est pas le cas, les pièces manquantes resteraient où
       elles sont dans le document — donc potentiellement sous une autre pièce,
       sans que rien ne le signale. On préfère refuser et le dire. */
    if (result.placements.length !== parts.length) {
      var manque = parts.length - result.placements.length;
      hint(manque + ' pièce(s) absente(s) du plan sur ' + parts.length +
           ' — rien n\'a été appliqué. Relance le calcul, et préviens-moi si ça se répète.', 'err');
      log('REFUSÉ : plan incomplet, ' + result.placements.length + '/' + parts.length + ' pièces.');
      return;
    }

    lock(true);
    hint('Application…');
    var rows = [];
    for (var i = 0; i < result.placements.length; i++) {
      var P = result.placements[i];
      rows.push(P.part.id + ',' + P.angle + ',' + P.x.toFixed(2) + ',' + P.y.toFixed(2));
    }
    call('mxnsApply', [rows.join(';'), String(parseFloat($('sheet').value) || 1350),
                       String(result.length), $('fitab').checked ? 'true' : 'false', session], function (txt) {
      var f = txt.split('\t');
      if (f[0] !== 'OK') hint(f[1] || txt, 'err');
      else {
        hint(T('msg.applied', { n: f[1], miss: f[2] > 0 ? T('msg.miss', { n: f[2] }, ' — ' + f[2] + ' introuvable(s)') : '' },
             f[1] + ' pièce(s) placées' + (f[2] > 0 ? ' — ' + f[2] + ' introuvable(s)' : '') + '. Ctrl+Z annule.'));
        log('Appliqué : ' + f[1] + ' pièces sur ' + (result.length / 1000).toFixed(3) + ' m.');
      }
      lock(false);
    });
  });

  $('marks').addEventListener('click', function () {
    if (busy) return;
    lock(true);
    call('mxnsMarks', [$('markd').value, $('marki').value, 'Regmark', 'false',
                       $('mshape').value, $('markw').value], function (txt) {
      var f = txt.split('\t');
      if (f[0] !== 'OK') hint(f[1] || txt, 'err');
      else {
        hint(T('msg.marks', { n: f[1], warn: f[2] > 0 ? T('msg.markswarn', { n: f[2] }, ' — ATTENTION, ' + f[2] + ' repère(s) recouvert(s) par une pièce.') : '.' },
             f[1] + ' repère(s) posé(s) sur le calque Regmark' +
             (f[2] > 0 ? ' — ATTENTION, ' + f[2] + ' repère(s) recouvert(s) par une pièce.' : '.')),
             f[2] > 0 ? 'warn' : null);
        log('Repères : ' + f[1] + ' posés, ' + f[2] + ' recouverts.');
      }
      lock(false);
    });
  });

  /* Presets machine. Seules deux valeurs sont documentées : les ronds de 10 mm
     relevés sur les planches de l'atelier, et les angles Graphtec (manuel
     CE7000 : taille 5 à 20 mm, trait 0,3 à 1,0 mm, ligne unique). Pour les
     autres machines, rien n'est deviné : tu règles une fois et tu mémorises. */
  /* Deux préréglages seulement sont documentés :
       - Valiani : ronds de 10 mm, mesurés sur des planches de production
       - Graphtec CE7000 / FC9000 : angles en L. Le manuel autorise une taille de
         5 à 20 mm et un trait de 0,3 à 1,0 mm, et impose une ligne unique ;
         on prend le maximum, le plus précis sur une grande planche.
     Les autres machines sont laissées vides : un repère de la mauvaise taille
     ne se voit qu'une fois la planche imprimée. Tu règles une fois d'après un
     fichier validé, puis tu mémorises. */
  var PRESETS = {
    valiani:  { shape: 'circle', size: 10, inset: 10, line: 1 },
    graphtec: { shape: 'corner', size: 20, inset: 15, line: 1 }
  };
  try {
    var saved = window.localStorage.getItem('mxns_presets');
    if (saved) {
      var extra = JSON.parse(saved);
      for (var kk in extra) if (extra.hasOwnProperty(kk)) PRESETS[kk] = extra[kk];
    }
  } catch (ePr) { }

  function loadPreset(name) {
    var p = PRESETS[name];
    if (!p) {
      hint(T('msg.nopreset', null, 'Aucune cote connue pour cette machine : règle la forme, la taille et le retrait d\'après un fichier validé, puis clique Mémoriser.'));
      return;
    }
    $('mshape').value = p.shape;
    $('markd').value = p.size;
    $('marki').value = p.inset;
    $('markw').value = p.line;
  }
  $('mpreset').addEventListener('change', function () { loadPreset(this.value); });
  loadPreset('valiani');

  $('msave').addEventListener('click', function () {
    var name = $('mpreset').value;
    PRESETS[name] = { shape: $('mshape').value, size: parseFloat($('markd').value),
                      inset: parseFloat($('marki').value), line: parseFloat($('markw').value) };
    try {
      window.localStorage.setItem('mxns_presets', JSON.stringify(PRESETS));
      hint(T('msg.saved', { name: name }, 'Réglage de repères mémorisé pour « ' + name + ' ».'));
    } catch (eS) { hint('Mémorisation impossible sur cette installation.', 'warn'); }
  });

  $('lang').value = I18N.get();
  I18N.apply();
  $('lang').addEventListener('change', function () {
    I18N.set(this.value);
    hint(T('msg.start', null, 'Ouvre ton kit, puis analyse le document.'));
  });

  /* Surveillance du document actif.
     Un plan ne vaut que pour le fichier sur lequel il a été calculé. Si
     l'utilisateur passe sur un autre document, l'analyse et le plan en mémoire
     ne correspondent plus à rien : on les jette et on le dit, plutôt que de
     laisser cliquer Appliquer et de voir des pièces rester en arrière. */
  function watchDocument() {
    call('mxnsPing', [], function (txt) {
      var f = txt.split('\t');
      if (f[0] !== 'OK') return;
      var name = f[3] || '';
      $('hostinfo').textContent = f[1] + ' ' + String(f[2]).split(' ')[0] + ' · ' + name;
      if (watchedDoc === null) { watchedDoc = name; return; }
      if (name !== watchedDoc) {
        watchedDoc = name;
        if (parts.length || result) {
          parts = [];
          result = null;
          session = '';
          setResult(null);
          draw(null);
          lock(false);
          hint('Document changé (' + name + ') — relance l\'analyse.', 'warn');
          log('Document changé : analyse et plan précédents abandonnés.');
        }
      }
    });
  }
  setInterval(watchDocument, 2500);

  /* ---------- fond perdu ----------
     On agrandit le MASQUE d'écrêtage de la pièce, pas son tracé de coupe : la
     coupe reste où elle est, et le dessin déborde derrière. Le décalage est
     calculé avec Clipper, en arrondi, donc les angles rentrants ne se croisent
     pas — ce qu'un simple agrandissement à l'échelle aurait fait. */
  $('dobleed').addEventListener('click', function () {
    if (busy) return;
    var mm = parseFloat($('bleed').value) || 0;
    if (mm <= 0) { hint(T('msg.bleed0', null, 'Mets une valeur de fond perdu supérieure à 0.'), 'warn'); return; }
    if (!parts.length) { hint(T('msg.bleedscan', null, 'Analyse d\'abord le document.'), 'warn'); return; }
    if (typeof ClipperLib === 'undefined') { hint('Clipper absent du panneau.', 'err'); return; }

    lock(true);
    var S = 10000, rows = [], skipped = 0;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var src = p.rings && p.rings.length ? p.rings[0] : null;
      if (!src || src.length < 3) { skipped++; continue; }
      var path = [];
      for (var q = 0; q < src.length; q++) {
        path.push({ X: Math.round(src[q][0] * S), Y: Math.round(src[q][1] * S) });
      }
      var co = new ClipperLib.ClipperOffset(2, 0.25 * S);
      co.AddPath(path, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
      var sol = new ClipperLib.Paths();
      co.Execute(sol, mm * S);
      if (!sol.length) { skipped++; continue; }
      var best = 0, bestA = -1;
      for (var k = 0; k < sol.length; k++) {
        var a = Math.abs(ClipperLib.Clipper.Area(sol[k]));
        if (a > bestA) { bestA = a; best = k; }
      }
      var out = sol[best], buf = [];
      for (var z = 0; z < out.length; z++) {
        buf.push((out[z].X / S).toFixed(2) + ',' + (out[z].Y / S).toFixed(2));
      }
      rows.push(p.id + '|' + buf.join(' '));
    }
    if (!rows.length) { hint(T('msg.bleednone', null, 'Aucune pièce exploitable pour le fond perdu.'), 'warn'); lock(false); return; }

    call('mxnsBleed', [rows.join(';'), session], function (txt) {
      var f = txt.split('\t');
      if (f[0] !== 'OK') hint(f[1] || txt, 'err');
      else {
        var surSel = f[4] === '1';
        var msg = f[1] + ' pièce(s) élargies de ' + mm + ' mm' +
                  (surSel ? ' (sélection)' : ' (tout le document)') +
                  (f[2] > 0 ? ' — ' + f[2] + ' sans masque, inchangée(s).' : '.');
        hint(msg, f[2] > 0 ? 'warn' : null);
        log('Fond perdu : ' + f[1] + ' masque(s) de ' + mm + ' mm' +
            (surSel ? ', sur la sélection' : ', document entier') +
            ', ' + f[2] + ' sans masque, ' + (f[3] || 0) + ' hors sélection.');
      }
      lock(false);
    });
  });

  window.addEventListener('resize', function () { draw(result); });
  call('mxnsPing', [], function (txt) {
    var f = txt.split('\t');
    $('hostinfo').textContent = f[0] === 'OK' ? f[1] + ' ' + String(f[2]).split(' ')[0] + ' · ' + f[3] : 'hôte indisponible';
    if (f[0] === 'OK') watchedDoc = f[3] || '';
  });
  draw(null);
  lock(false);

  // API publique minimale pour le moteur hybride V10 + Sparrow.
  // Le nesting historique reste inchangé : le bouton hybride injecte simplement
  // un autre candidat dans le même résultat que le bouton Appliquer consomme.
  window.MXNestSpirit = {
    getParts: function () { return parts; },
    getResult: function () { return result; },
    getOptions: function () { return options(); },
    setExternalResult: function (r) {
      result = r;
      setResult(r);
      draw(r);
      $('apply').disabled = !r;
    },
    setBusy: function (v) { lock(!!v); },
    log: log,
    hint: hint,
    draw: draw
  };
})();
