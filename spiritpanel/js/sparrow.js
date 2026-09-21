/*
 * sparrow.js — pont entre MXNestSpirit et le solveur Sparrow.
 *
 * Zero dependency on Illustrator, the DOM or the browser: pure data in, pure
 * data out, so it runs under Node for the unit tests and inside the CEP panel
 * from a <script> tag (as window.SparrowBridge). Spawning the binary is NOT
 * done here — that is the panel's job — this file only translates.
 *
 * WHY: measured on a real 21-group Yamaha kit at 6 mm separation, 60 s each,
 * Sparrow atteint 852 mm là où le moteur intégré atteint 925 mm. Same
 * input, both verified geometrically. Sparrow is MIT licensed (jagua-rs, its
 * collision engine, is MPL-2.0), so it ships with the product; see
 * THIRD_PARTY_NOTICES.
 *
 * THE THREE TRAPS, all of which silently produce a plausible-looking but wrong
 * sheet, and all of which are guarded here:
 *
 * 1. AXIS ROLES ARE SWAPPED. Sparrow does strip packing: it constrains Y to
 *    strip_height and minimises the X extent. le panneau contraint X à la laize
 *    width and minimises Y (the length of vinyl consumed). So x and y are
 *    swapped going in and swapped back coming out. Two reflections compose to a
 *    rotation, so nothing ends up mirrored — but doing it on one side only
 *    would mirror every decal, which prints as scrap.
 *
 * 2. OPPOSITE ROTATION CONVENTIONS. nester.js works y-DOWN and its rotate is
 *    [cos, sin; -sin, cos]; Sparrow works y-up with the standard [cos, -sin;
 *    sin, cos]. The angle handed to Illustrator is therefore NOT Sparrow's
 *    angle. Rather than trust a sign derived on paper, readSolution() rebuilds
 *    each piece with the angle it is about to emit and compares it against
 *    Sparrow's own placement, vertex by vertex (see verifyPlacement).
 *
 * 3. GROUPS ARE RIGID, jagua-rs IS NOT. Une pièce du panneau peut contenir plusieurs
 *    cut paths that must travel together; jagua-rs declares a MultiPolygon
 *    shape but refuses to import one, so each group leaves as ONE ring
 *    (see ringToSend):
 *      - its LARGEST contour, when every other contour lies strictly inside
 *        it: holes, slots, inner cuts. Hulling those threw every cavity away.
 *        On a real 38-piece kit, 12 items reached the engine convex, the five
 *        biggest among them, and a U-shaped panel kept its whole mouth empty.
 *      - its convex hull otherwise, when a contour sits outside the largest
 *        one (really separate pieces grouped together), and always on the
 *        last-resort forceHull rung.
 *    Both are safe on the true cut lines: a piece kept outside the ring sent
 *    is at least as far from every cut inside it, because any segment from
 *    outside to a point inside crosses the ring. That covers the cut lines
 *    extraction could not make contours of too (open vent lines, rings under
 *    the minimum area, carried as part.droppedCuts): the outline is kept only
 *    when they lie inside it as well, and a hull is taken over them.
 *
 *    The ring sent does NOT always have the group's bounding box. It does at
 *    eps 0 with nothing trimmed; a simplified rung, a needle removed at an
 *    extreme or a hull over dropped cuts all make the two differ, by up to eps
 *    and more. Illustrator puts the box of ALL the group's cut paths on the
 *    target, so readSolution works the target out from both boxes, and the
 *    true cuts follow the ring the engine placed on every rung (see
 *    placementFrame).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SparrowBridge = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VERIFY_TOL_MM = 0.05;   // f32 solver; anything past this is a real bug

  /* ---------------- small geometry ---------------------------------------- */

  function openRing(ring) {
    var r = [];
    for (var i = 0; i < ring.length; i++) r.push([ring[i][0], ring[i][1]]);
    while (r.length > 1 &&
           r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
    return r;
  }

  /* jagua-rs rejects a ring outright if any two vertices coincide. */
  function dedupe(ring, eps) {
    var e = eps || 1e-6, out = [];
    for (var i = 0; i < ring.length; i++) {
      var p = ring[i], keep = true;
      if (out.length) {
        var q = out[out.length - 1];
        if (Math.abs(p[0] - q[0]) < e && Math.abs(p[1] - q[1]) < e) keep = false;
      }
      if (keep) out.push([p[0], p[1]]);
    }
    return out;
  }

  function convexHull(pts) {
    var P = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    function cross(o, a, b) {
      return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    }
    var lo = [], up = [], i;
    for (i = 0; i < P.length; i++) {
      while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], P[i]) <= 0) lo.pop();
      lo.push(P[i]);
    }
    for (i = P.length - 1; i >= 0; i--) {
      while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], P[i]) <= 0) up.pop();
      up.push(P[i]);
    }
    lo.pop(); up.pop();
    return lo.concat(up);
  }

  function bboxOf(polys) {
    var b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    if (!Array.isArray(polys)) return b;
    for (var i = 0; i < polys.length; i++) {
      var ring = polys[i];
      if (!Array.isArray(ring)) continue;
      for (var k = 0; k < ring.length; k++) {
        var p = ring[k];
        if (!Array.isArray(p) || p.length < 2 || !isFinite(p[0]) || !isFinite(p[1])) continue;
        if (p[0] < b.minX) b.minX = p[0];
        if (p[0] > b.maxX) b.maxX = p[0];
        if (p[1] < b.minY) b.minY = p[1];
        if (p[1] > b.maxY) b.maxY = p[1];
      }
    }
    return b;
  }

  /* nester.js's rotation, replicated EXACTLY (y-down, [cos, sin; -sin, cos]),
   * pivoting on the whole group's bbox centre so a multi-cut group stays rigid.
   * This is the transform Illustrator will perform, so it is the one the
   * verification must reproduce. */
  function rotateMulti(polys, deg) {
    var i, k, copy;
    if (!deg) {
      copy = [];
      for (i = 0; i < polys.length; i++) copy.push(polys[i].slice());
      return copy;
    }
    var bb = bboxOf(polys);
    var cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
    var rad = deg * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    var out = [];
    for (i = 0; i < polys.length; i++) {
      var src = polys[i], dst = new Array(src.length);
      for (k = 0; k < src.length; k++) {
        var dx = src[k][0] - cx, dy = src[k][1] - cy;
        dst[k] = [cx + dx * cos + dy * sin, cy - dx * sin + dy * cos];
      }
      out.push(dst);
    }
    return out;
  }

  function translateMulti(polys, dx, dy) {
    var out = [];
    for (var i = 0; i < polys.length; i++) {
      var src = polys[i], dst = new Array(src.length);
      for (var k = 0; k < src.length; k++) dst[k] = [src[k][0] + dx, src[k][1] + dy];
      out.push(dst);
    }
    return out;
  }

  /* ---------------- multi-contour groups ---------------------------------- */

  /*
   * A cut this close to the outline counts as touching it, and the group is
   * hulled as before. The outlines arrive rounded to 0.01 mm after a 0.1 mm
   * simplification, so a gap smaller than this is noise, not material.
   */
  var CONTAIN_TOL_MM = 0.05;

  function ptSegDist(p, u, v) {
    var dx = v[0] - u[0], dy = v[1] - u[1], L = dx * dx + dy * dy;
    if (L === 0) return Math.sqrt((p[0] - u[0]) * (p[0] - u[0]) + (p[1] - u[1]) * (p[1] - u[1]));
    var t = ((p[0] - u[0]) * dx + (p[1] - u[1]) * dy) / L;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    var qx = u[0] + t * dx, qy = u[1] + t * dy;
    return Math.sqrt((p[0] - qx) * (p[0] - qx) + (p[1] - qy) * (p[1] - qy));
  }

  /* Distance between segments a-b and c-d; 0 when they cross or touch. */
  function segSegDist(a, b, c, d) {
    var den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
    if (Math.abs(den) > 1e-12) {
      var u = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den;
      var t = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
      if (u >= 0 && u <= 1 && t >= 0 && t <= 1) return 0;
    }
    return Math.min(ptSegDist(a, c, d), ptSegDist(b, c, d),
                    ptSegDist(c, a, b), ptSegDist(d, a, b));
  }

  /*
   * The outline's edges, bucketed by height, so each question below reads the
   * few edges near it instead of all of them. A panel with hundreds of holes
   * on a detailed outline would otherwise cost holes x vertices x edges, and
   * the question is asked twice per solve (buildInstance, then readSolution).
   */
  function edgeIndex(ring) {
    var n = ring.length, minY = Infinity, maxY = -Infinity, i, k;
    for (i = 0; i < n; i++) {
      if (ring[i][1] < minY) minY = ring[i][1];
      if (ring[i][1] > maxY) maxY = ring[i][1];
    }
    var nb = Math.max(1, Math.min(4096, Math.ceil(n / 4)));
    var h = (maxY - minY) / nb;
    if (!(h > 0)) h = 1;
    function bucketOf(y) {
      var q = Math.floor((y - minY) / h);
      return q < 0 ? 0 : (q >= nb ? nb - 1 : q);
    }
    var buckets = new Array(nb), box = new Array(n);
    for (k = 0; k < nb; k++) buckets[k] = [];
    for (i = 0; i < n; i++) {
      var a = ring[i], b = ring[(i + 1) % n];
      box[i] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]),
                Math.max(a[0], b[0]), Math.max(a[1], b[1])];
      for (k = bucketOf(box[i][1]); k <= bucketOf(box[i][3]); k++) buckets[k].push(i);
    }
    return { ring: ring, n: n, minY: minY, maxY: maxY, bucketOf: bucketOf,
             buckets: buckets, box: box, seen: new Array(n), query: 0 };
  }

  /* Even-odd test of one point, against the edges spanning its height only. */
  function insideIndexed(idx, p) {
    if (p[1] < idx.minY || p[1] > idx.maxY) return false;
    var list = idx.buckets[idx.bucketOf(p[1])], ring = idx.ring, n = idx.n;
    var inside = false;
    for (var t = 0; t < list.length; t++) {
      var a = ring[list[t]], b = ring[(list[t] + 1) % n];
      if ((a[1] > p[1]) !== (b[1] > p[1]) &&
          p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }

  /* Does segment a-b come within tol of the outline? Crossing counts as 0. */
  function nearIndexed(idx, a, b, tol) {
    var x0 = Math.min(a[0], b[0]) - tol, x1 = Math.max(a[0], b[0]) + tol;
    var y0 = Math.min(a[1], b[1]) - tol, y1 = Math.max(a[1], b[1]) + tol;
    if (y1 < idx.minY || y0 > idx.maxY) return false;
    var q = ++idx.query, ring = idx.ring, n = idx.n;
    for (var k = idx.bucketOf(y0); k <= idx.bucketOf(y1); k++) {
      var list = idx.buckets[k];
      for (var t = 0; t < list.length; t++) {
        var e = list[t];
        if (idx.seen[e] === q) continue;          // spans several buckets
        idx.seen[e] = q;
        var bx = idx.box[e];
        if (bx[0] > x1 || bx[2] < x0 || bx[1] > y1 || bx[3] < y0) continue;
        if (segSegDist(a, b, ring[e], ring[(e + 1) % n]) <= tol) return true;
      }
    }
    return false;
  }

  /*
   * Is ring `inner` strictly inside the indexed outline? Two guards, and each
   * catches what the other cannot:
   *   - every VERTEX inside it. The edges alone would pass a cut lying wholly
   *     outside, in the mouth of a U, since nothing there touches the outline.
   *   - no EDGE within tol of it. The vertices alone would pass a slot whose
   *     corners sit in both arms of a U while its edges cross the mouth, or a
   *     cut that merely touches the outline.
   * `open`: a polyline rather than a ring, with no edge from its last point
   * back to its first (an open vent line; a closed one repeats its start).
   */
  function ringInside(idx, inner, tol, open) {
    var n = inner.length, i;
    for (i = 0; i < n; i++) if (!insideIndexed(idx, inner[i])) return false;
    var edges = open ? n - 1 : n;
    for (i = 0; i < edges; i++) {
      if (nearIndexed(idx, inner[i], inner[(i + 1) % n], tol)) return false;
    }
    return true;
  }

  /*
   * The cut lines extraction kept out of `contours` (jsx/nesting.jsx): open
   * chains it could not stitch into a ring, and closed rings under the minimum
   * piece area, closed by repeating their first point. The engine is never
   * sent them and the blade cuts them all the same, so one lying in a cavity
   * of the outline sent would be cut straight through the piece the engine
   * put there. Polylines, in the part's own millimetres.
   */
  function droppedCutsOf(part) {
    var d = part && part.droppedCuts, out = [];
    if (!d || !d.length) return out;
    for (var i = 0; i < d.length; i++) {
      if (d[i] && d[i].length) out.push(dedupe(d[i]));
    }
    return out;
  }

  /* Every dropped cut strictly inside the indexed outline. */
  function droppedInside(idx, dropped) {
    for (var i = 0; i < dropped.length; i++) {
      if (!ringInside(idx, dropped[i], CONTAIN_TOL_MM, true)) return false;
    }
    return true;
  }

  /*
   * The largest contour of a group, when every other contour lies strictly
   * inside it, and every dropped cut as well: the group's real outline,
   * cavities included. null otherwise, and the caller hulls the group.
   * Largest by area, never by position in the list: nothing guarantees the
   * outline comes first. `why`, when given, learns that a dropped cut was
   * what refused the outline.
   */
  function enclosingOutline(cs, dropped, why) {
    var rings = [], best = -1, bestArea = 0, c;
    for (c = 0; c < cs.length; c++) {
      var r = dedupe(openRing(cs[c]));
      rings.push(r);
      var a = r.length >= 3 ? ringArea(r) : 0;
      if (a > bestArea) { bestArea = a; best = c; }
    }
    if (best < 0) return null;
    var idx = edgeIndex(rings[best]);
    for (c = 0; c < rings.length; c++) {
      if (c !== best && !ringInside(idx, rings[c], CONTAIN_TOL_MM)) return null;
    }
    if (dropped && dropped.length && !droppedInside(idx, dropped)) {
      if (why) why.droppedOutside = true;
      return null;
    }
    return openRing(cs[best]);
  }


  /*
   * Contours traced from real Illustrator artwork contain micro "needles": the
   * path steps forward a tenth of a millimetre and doubles straight back. The
   * built-in placer rasterises and never notices; jagua-rs validates the ring
   * and refuses the WHOLE instance with "Simple polygon contains intersecting
   * edges", so one bad vertex in one decal stops the entire sheet.
   *
   * A needle encloses no area, so dropping its tip changes nothing physical --
   * unlike simplification, which would shrink the outline and could let a piece
   * sit closer than the blade allows.
   */
  function removeNeedles(ring, tolMm) {
    var tol = tolMm || 0.2;
    var pts = ring.slice(), changed = true, guard = 0;
    while (changed && guard++ < 50) {
      changed = false;
      var out = [], n = pts.length;
      if (n < 4) break;
      for (var i = 0; i < n; i++) {
        var a = pts[(i - 1 + n) % n], v = pts[i], b = pts[(i + 1) % n];
        var ax = v[0] - a[0], ay = v[1] - a[1];
        var bx = b[0] - v[0], by = b[1] - v[1];
        var la = Math.sqrt(ax * ax + ay * ay), lb = Math.sqrt(bx * bx + by * by);
        /* A point repeated: this copy goes, the next one stays, and is judged
         * on the next pass. Dropping a needle's tip leaves its base twice in a
         * row, and dropping BOTH copies took the base itself away: at the
         * corner of a straight-edged decal a whole triangle left the ring sent,
         * and a legal layout could put a piece inside it (review of 3.8.1). */
        if (lb < 1e-9) { changed = true; continue; }
        if (la < 1e-9) { out.push(v); continue; }
        // Reversal: the outgoing edge points back along the incoming one, and
        // the spike is short enough to be a tracing artefact rather than a
        // genuine feature of the decal.
        var cosang = (ax * bx + ay * by) / (la * lb);
        var area2 = Math.abs(ax * by - ay * bx);
        if (cosang < -0.999 && Math.min(la, lb) < tol && area2 < tol * tol) {
          changed = true; continue;
        }
        out.push(v);
      }
      if (changed) pts = out;
    }
    return pts;
  }

  /* Do any two non-adjacent edges of this ring cross? O(n^2), run once per
   * piece on a few hundred points -- irrelevant next to a 30 s solve, and it
   * turns a fatal solver error into a piece we can handle. */
  function selfIntersects(closedOrOpen) {
    /* Normalise first: a ring handed over with its closing vertex still on the
     * end has a zero-length wrap edge, which touches both its neighbours and
     * makes every single piece look broken. */
    var ring = dedupe(openRing(closedOrOpen));
    var n = ring.length;
    if (n < 4) return false;
    function cross(o, a, b) {
      return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    }
    /* A strict crossing test is not enough: jagua-rs also rejects edges that
     * merely TOUCH or lie on top of each other, which is exactly the shape of a
     * needle. Missing those made the detector report a clean kit that the
     * solver then refused. */
    function onSeg(p, q, r) {   // r collinear with pq: does it lie on it?
      return Math.min(p[0], q[0]) - 1e-9 <= r[0] && r[0] <= Math.max(p[0], q[0]) + 1e-9 &&
             Math.min(p[1], q[1]) - 1e-9 <= r[1] && r[1] <= Math.max(p[1], q[1]) + 1e-9;
    }
    function seg(p1, p2, p3, p4) {
      var d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2);
      var d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
          ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
      var E = 1e-9;
      if (Math.abs(d1) < E && onSeg(p3, p4, p1)) return true;
      if (Math.abs(d2) < E && onSeg(p3, p4, p2)) return true;
      if (Math.abs(d3) < E && onSeg(p1, p2, p3)) return true;
      if (Math.abs(d4) < E && onSeg(p1, p2, p4)) return true;
      return false;
    }
    for (var i = 0; i < n; i++) {
      var a1 = ring[i], a2 = ring[(i + 1) % n];
      for (var j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;      // adjacent through the wrap
        if (seg(a1, a2, ring[j], ring[(j + 1) % n])) return true;
      }
    }
    return false;
  }

  /*
   * Douglas-Peucker. jagua-rs runs its OWN simplifier on every item (observed
   * reducing 331 edges to 52), and on some real decal outlines that pass is
   * what CREATES a self-intersection -- the shape we send is provably clean and
   * the solver still refuses the whole instance. Pre-simplifying leaves it less
   * to do. Acceptance is not monotonic in the tolerance (0.3 and 0.5 mm pass on
   * the kit that failed, 1 and 2 mm do not), so the caller escalates rather
   * than trusting one value.
   *
   * Simplification can only pull the outline INWARD, by at most eps, so two
   * pieces can finish up to 2*eps closer than asked. Padding the request looks
   * like the fix and is NOT: measured on the failing kit, jagua-rs inflates
   * every shape by the separation and a BIGGER separation is exactly what makes
   * a concave outline self-intersect (eps 0 is refused from 6 mm up; eps 0.3
   * passes at 6 and 8 but not 12). So the caller asks for what it needs and
   * MEASURES what it got -- see measureMinGap.
   *
   * Distances are taken to the chord as a SEGMENT, not as a line. Measured to
   * the line, a thin tip running along a chord past its end scored next to
   * nothing and was cut off whole: 5.5 mm at eps 0.3 and 12 mm at eps 1.5 on a
   * 1 x 25 mm flame tip (review of 3.8.1). To the segment, every vertex left
   * out stays within eps of the ring sent, which the far-side reserve, the
   * near-edge move and the gap bar all rely on. On Alec's real kits the two
   * keep the same number of vertices, give the same worst loss and the same
   * self-crossings.
   */
  function simplify(ring, eps) {
    if (!eps || ring.length < 4) return ring;
    var keep = new Array(ring.length);
    keep[0] = keep[ring.length - 1] = true;
    var stack = [[0, ring.length - 1]];
    while (stack.length) {
      var seg = stack.pop(), s0 = seg[0], e0 = seg[1], mi = -1, md = 0;
      for (var i = s0 + 1; i < e0; i++) {
        var d = ptSegDist(ring[i], ring[s0], ring[e0]);
        if (d > md) { md = d; mi = i; }
      }
      if (md > eps && mi > 0) { keep[mi] = true; stack.push([s0, mi]); stack.push([mi, e0]); }
    }
    var out = [];
    for (var k = 0; k < ring.length; k++) if (keep[k]) out.push(ring[k]);
    return out.length >= 3 ? out : ring;
  }

  /*
   * Make a ring the solver will accept. Needles first; if the outline still
   * crosses itself it is a genuinely broken path, and the piece falls back to
   * its convex hull -- never smaller than the truth, so the separation stays
   * honest -- and is reported so the operator can fix the artwork.
   */
  function cleanRing(ring, eps) {
    var r = dedupe(removeNeedles(dedupe(ring)));
    if (eps) r = dedupe(simplify(r, eps));
    if (r.length >= 4 && selfIntersects(r)) return { ring: convexHull(r), repaired: true };
    return { ring: r, repaired: false };
  }

  /*
   * The ring a part is sent as, cleaned exactly as the engine receives it.
   * buildInstance AND readSolution both call this, so the ring a placement is
   * rebuilt from is, by construction, the ring that was sent.
   *
   * kind: "single" (one contour), "outline" (a group sent as its largest
   * contour, every other cut inside it), "hull" (the convex hull of every cut
   * line of the part: a contour or a dropped cut lies outside the outline, or
   * the rung asks for hulls).
   *
   * Rungs: hullGroups hulls every group and keeps single outlines exact, the
   * first rung as it was before groups kept their cavities. forceHull, the
   * last resort, hulls everything, single outlines included.
   *
   * A dropped cut outside the ring would be cut through whatever piece the
   * engine put over it, so the part then leaves as its hull, taken over the
   * dropped cut too. Single outlines included: a vent line in the notch of a
   * single decal is the same hazard.
   */
  function ringToSend(part, eps, forceHull, hullGroups) {
    var cs = part.contours || [part.contour];
    var dropped = droppedCutsOf(part);
    var kind = "single", ring = null, why = {};
    if (cs.length > 1) {
      // TRAP 3: rigid multi-contour group. Its own outline when every other
      // cut lies inside it, so its cavities stay open to other pieces.
      if (!forceHull && !hullGroups) ring = enclosingOutline(cs, dropped, why);
      kind = ring ? "outline" : "hull";
    } else {
      ring = openRing(cs[0]);
      if (dropped.length) {
        var own = dedupe(ring);
        if (own.length < 3 || !droppedInside(edgeIndex(own), dropped)) {
          ring = null;
          kind = "hull";
          why.droppedOutside = true;
        }
      }
    }
    if (!ring) {
      var all = [], polys = cs.concat(dropped);
      for (var c = 0; c < polys.length; c++) {
        var oc = openRing(polys[c]);
        for (var k = 0; k < oc.length; k++) all.push(oc[k]);
      }
      ring = convexHull(all);
    }
    // TRAP 4: a ring that crosses itself makes jagua-rs reject the whole
    // instance, so one bad decal loses the entire sheet. Clean it first.
    var cleaned = cleanRing(ring, eps);
    ring = cleaned.ring;
    if (forceHull) ring = convexHull(ring);
    return { ring: ring, kind: kind, repaired: cleaned.repaired,
             droppedOutside: !!why.droppedOutside };
  }

  /*
   * A fingerprint of the ring handed to the engine, so readSolution can prove
   * it rebuilt THAT ring. It cannot tell otherwise: the placement is checked
   * against the ring readSolution re-creates, so the wrong ring still
   * verifies to the micron. A hull and an enclosing outline even share a
   * bounding box at eps 0, and the layout would still be wrong by whatever
   * the two simplify differently.
   */
  function ringKey(ring) {
    var a = 0, b = 0;
    for (var i = 0; i < ring.length; i++) {
      a += ring[i][0] * (i % 7 + 1) + ring[i][1] * (i % 5 + 2);
      b += ring[i][0] * ring[i][1] * (i % 3 + 1);
    }
    return ring.length + "|" + a + "|" + b;
  }

  /* ---------------- instance ---------------------------------------------- */

  /*
   * parts: [{ id, contours: [ring, ...] }] en millimètres, y vers le bas.
   * opts:  { usableWidthMm, spacingMm, rotStepDeg }  rotStepDeg 0 = free.
   *
   * Returns { instance, meta }. meta carries what readSolution needs to undo
   * the swap and to find each part again by its numeric Sparrow id.
   */
  function buildInstance(parts, opts) {
    var o = opts || {};
    /*
     * The engine keeps its separation from the strip's EDGES as well as between
     * pieces. Measured on 43 real solutions: every one sat the separation
     * (6 mm) in from both sides and from the start of the strip. The sheet's
     * bleed margin is already reserved outside the usable width, so that inset
     * was lost vinyl: 12 mm of width on every sheet, and a white band at the top
     * of every sheet that an operator trimmed by hand each time. The strip is
     * widened by the separation on each side, and readSolution moves the pieces
     * back, so they reach the usable area's edges as the built-in placer's do.
     */
    var padMm = o.spacingMm || 0;
    var usableMm = o.usableWidthMm;
    /* Less the simplification's worst case on the far side: the engine sees the
     * simplified outline, Illustrator places the real one, up to 2 x eps wider,
     * and with the inset given back it would cross the usable width by that
     * much on a retry rung (review of 3.8). 0 when nothing is simplified. */
    var stripHeight = usableMm + 2 * padMm - 2 * (o.simplifyEpsMm || 0);
    var step = typeof o.rotStepDeg === "number" ? o.rotStepDeg : 0;
    var eps = o.simplifyEpsMm || 0;
    // Last-resort rung: a convex outline cannot cross itself however far the
    // solver inflates it, so this always parses. Costs space, never the sheet.
    var forceHull = !!o.forceHull;
    /* The first rung as it was before groups kept their cavities: every group
     * hulled, single outlines exact. The ladder tries it before forceHull,
     * which would hull the single outlines as well. */
    var hullGroups = !!o.hullGroups;

    var orientations = null;
    if (step > 0) {
      orientations = [];
      for (var a = 0; a < 360; a += step) orientations.push(a);
    }

    var items = [], index = [], keys = [], hulled = 0, outlined = 0, repaired = 0;
    var droppedHulled = 0;
    for (var i = 0; i < parts.length; i++) {
      // TRAP 3 and TRAP 4, in one place shared with readSolution.
      var sent = ringToSend(parts[i], eps, forceHull, hullGroups);
      if (sent.kind === "hull") hulled++;
      if (sent.kind === "outline") outlined++;
      if (sent.droppedOutside) droppedHulled++;
      if (sent.repaired) repaired++;
      if (forceHull) hulled++;
      var ring = sent.ring;

      // TRAP 1: x and y swapped so Sparrow's constrained axis is the roll width.
      var swapped = [];
      for (var s = 0; s < ring.length; s++) swapped.push([ring[s][1], ring[s][0]]);
      swapped = dedupe(swapped);
      if (swapped.length < 3) continue;          // degenerate: nothing to nest
      keys[items.length] = ringKey(swapped);     // before the closing vertex
      swapped.push([swapped[0][0], swapped[0][1]]);   // closed

      var item = { id: items.length, demand: 1,
                   shape: { type: "simple_polygon", data: swapped } };
      if (orientations) item.allowed_orientations = orientations.slice();
      items.push(item);
      index.push(i);
    }

    return {
      instance: { name: "mxnestspirit", strip_height: stripHeight, items: items },
      meta: {
        index: index,                 // sparrow item id -> parts[] index
        usableWidthMm: usableMm,
        stripPadMm: padMm,            // added on each side of the strip, removed on the way back
        spacingMm: o.spacingMm,
        hulledGroups: hulled,
        outlinedGroups: outlined,     // groups sent as their largest contour, cavities kept
        sentKeys: keys,               // sparrow item id -> ringKey of the ring sent
        repairedRings: repaired,
        simplifyEpsMm: eps,
        forceHull: forceHull,
        hullGroups: hullGroups,       // readSolution must rebuild the same ring
        droppedCutsHulled: droppedHulled,   // parts hulled because a dropped cut lay outside
        separationMm: (o.spacingMm || 0),
        // Worst case the simplification can cost, so the caller can tell the
        // operator the truth instead of repeating what it asked for.
        worstCaseLossMm: 2 * eps
      }
    };
  }

  /* ---------------- solution ---------------------------------------------- */

  /* Sparrow's own transform, in ITS space: rotate about the origin (degrees,
   * standard y-up CCW), then translate. */
  function applySparrow(ring, rotDeg, tx, ty) {
    var rad = rotDeg * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    var out = new Array(ring.length);
    for (var i = 0; i < ring.length; i++) {
      var x = ring[i][0], y = ring[i][1];
      out[i] = [x * cos - y * sin + tx, x * sin + y * cos + ty];
    }
    return out;
  }

  /*
   * TRAP 2 guard. Rebuild the piece the way Illustrator will and compare with
   * where Sparrow actually put it, vertex by vertex, in mm.
   *
   * `sentRing` must be the SAME ring that was sent to the solver -- for a
   * group that is its hull or its enclosing outline (see ringToSend), not
   * contours[0]. Comparing two different shapes reports a 390 mm error on a
   * layout that is in fact correct.
   *
   * Illustrator turns the WHOLE group and puts the bounding box of all its
   * cut paths on `target` (see cutFrame); the ring rides along. So the ring is
   * turned together with `frame`, and it is the frame's box that lands on the
   * target. Without a frame the ring is its own, as before. The two boxes are
   * the same only at eps 0 with nothing trimmed: see placementFrame.
   */
  function verifyPlacement(sentRing, deg, target, expectedRing, frame) {
    var polys = frame && frame.length ? frame.concat([sentRing]) : [sentRing];
    var rot = rotateMulti(polys, deg);
    var bb = bboxOf(polys.length > 1 ? rot.slice(0, -1) : rot);
    var got = translateMulti([rot[rot.length - 1]], target.x - bb.minX, target.y - bb.minY)[0];
    var want = expectedRing, worst = 0;
    if (!got.length || got.length !== want.length) return Infinity;
    for (var i = 0; i < got.length; i++) {
      var dx = got[i][0] - want[i][0], dy = got[i][1] - want[i][1];
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > worst) worst = d;
    }
    return worst;
  }

  /*
   * Every cut line of a part, as Illustrator lines it up: jsx turns the whole
   * group and puts the bounding box of ALL its cut paths on the target
   * (combinedCutBounds), dropped vent lines and small rings included. The
   * placement, the gap check and the used length all read this frame.
   */
  function cutFrame(part) {
    var src = part && (part.contours || part.rings || [part.contour]) || [];
    var out = [];
    for (var i = 0; i < src.length; i++) {
      if (!Array.isArray(src[i])) continue;
      var ring = [];
      for (var k = 0; k < src[i].length; k++) {
        var p = src[i][k];
        if (Array.isArray(p) && p.length >= 2 && isFinite(p[0]) && isFinite(p[1])) ring.push([Number(p[0]), Number(p[1])]);
      }
      if (ring.length) out.push(ring);
    }
    var dropped = droppedCutsOf(part);
    for (var d = 0; d < dropped.length; d++) if (dropped[d].length) out.push(dropped[d]);
    return out;
  }

  /*
   * Where jsx must put a part's frame so that the ring the engine placed, and
   * with it every true cut, lands exactly where the engine put it. `ringBox`
   * is the box of that ring as placed.
   *
   * The frame's rotated box and the ring's differ whenever the ring is not the
   * whole outline: simplified on a retry rung (the true outline reaches up to
   * eps past it), a needle trimmed at an extreme, a hull taken over dropped
   * cuts. Putting the frame's box where the ring's was moved the true cuts by
   * that difference, and the placement check could not see it: it compared
   * the ring with itself.
   */
  function placementFrame(frame, sentRing, deg, ringBox) {
    var rot = rotateMulti(frame.concat([sentRing]), deg);
    var fb = bboxOf(rot.slice(0, -1)), rb = bboxOf([rot[rot.length - 1]]);
    return { x: ringBox.minX + (fb.minX - rb.minX), y: ringBox.minY + (fb.minY - rb.minY),
             w: fb.maxX - fb.minX, h: fb.maxY - fb.minY };
  }

  /* Why a piece was left off, in the words js/main.js already shows (REASON_EN). */
  var REASON_DEGENERATE = "degenerate contour (fewer than 3 points)";
  var REASON_TOO_BIG = "larger than sheet";
  var REASON_NOT_PLACED = "could not place (internal)";

  /* An unplaced piece as the panel prints it, name then reason. A bare id
   * printed "Tank L: undefined" under the result. */
  function unplacedEntry(part, reason) {
    return { id: part.id, name: part.name || String(part.id), reason: reason };
  }

  /*
   * Could this part fit a W x H box at some angle? Only to name the reason a
   * piece was left out, never to place one. Its narrowest width lies along
   * one of its hull's edges, so those angles are tried, plus every degree for
   * the two-sided case. H 0: no height limit (one strip).
   */
  function fitsBox(part, W, H) {
    if (!(W > 0)) return true;
    var frame = cutFrame(part), pts = [], i, k;
    for (i = 0; i < frame.length; i++) {
      for (k = 0; k < frame[i].length; k++) pts.push(frame[i][k]);
    }
    var hull = convexHull(pts);
    if (hull.length < 2) return true;
    var angles = [];
    for (i = 0; i < hull.length; i++) {
      var p = hull[i], q = hull[(i + 1) % hull.length];
      angles.push(Math.atan2(q[1] - p[1], q[0] - p[0]));
    }
    for (i = 0; i < 180; i++) angles.push(i * Math.PI / 180);
    for (i = 0; i < angles.length; i++) {
      var c = Math.cos(angles[i]), s = Math.sin(angles[i]);
      var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (k = 0; k < hull.length; k++) {
        var x = hull[k][0] * c + hull[k][1] * s, y = hull[k][1] * c - hull[k][0] * s;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      var w = x1 - x0, h = y1 - y0;
      if (w <= W + 0.01 && (!(H > 0) || h <= H + 0.01)) return true;
      if (h <= W + 0.01 && (!(H > 0) || w <= H + 0.01)) return true;
    }
    return false;
  }

  /*
   * solution: the parsed JSON Sparrow writes.
   * Returns { placements, sheetHeightsMm, usedLengthMm, unplaced, maxErrorMm }
   * in exactly the shape jsx/nesting.jsx already consumes, so the whole apply
   * path is untouched. unplaced: [{ id, name, reason }], as the panel prints it.
   */
  function readSolution(solution, parts, meta) {
    var sol = solution && solution.solution;
    var layout = sol && sol.layout;
    var placed = layout && layout.placed_items;
    if (!placed) throw new Error("SPARROW_NO_LAYOUT");

    var placements = [], maxError = 0, seen = {}, duplicates = 0;
    var overshootX = [];   // per placement: how far its true cuts reach past its ring, across the roll

    for (var i = 0; i < placed.length; i++) {
      var pi = placed[i];
      var partIdx = meta.index[pi.item_id];
      if (partIdx === undefined) continue;
      /* The same piece placed twice would be moved twice and keep only its
       * last position: counted, and the panel refuses the layout (3.8.1). */
      if (seen[partIdx]) { duplicates++; continue; }
      seen[partIdx] = true;
      var part = parts[partIdx];

      var t = pi.transformation;
      /* Le JSON de solution de Sparrow expose
       * transformation.rotation in DEGREES. Do not convert it here: the
       * upstream 3.8.2 bridge passes this value directly into its geometry
       * verification. The input allowed_orientations are degrees as well. */
      var theta = Number(t.rotation);
      if (!isFinite(theta)) throw new Error('SPARROW_BAD_ROTATION_' + String(pi.item_id));
      var tx = Number(t.translation[0]), ty = Number(t.translation[1]);
      if (!isFinite(tx) || !isFinite(ty)) throw new Error('SPARROW_BAD_TRANSLATION_' + String(pi.item_id));

      // The exact ring that was sent: the same function, the same inputs.
      var ring = ringToSend(part, meta.simplifyEpsMm || 0, !!meta.forceHull, !!meta.hullGroups).ring;
      var swapped = [];
      for (var s = 0; s < ring.length; s++) swapped.push([ring[s][1], ring[s][0]]);
      swapped = dedupe(swapped);

      // Where Sparrow put it, puis ramené dans le repère du panneau.
      var inSparrow = applySparrow(swapped, theta, tx, ty);
      var back = new Array(inSparrow.length);
      for (var b = 0; b < inSparrow.length; b++) back[b] = [inSparrow[b][1], inSparrow[b][0]];

      /* jsx puts the rotated box of the part's whole frame (every cut line) on
       * `target`. That box is the ring's only at eps 0 with nothing trimmed, so
       * the target is worked out from both (see placementFrame). */
      var bb = bboxOf([back]);
      var frame = cutFrame(part);
      var sentRing = dedupe(swapped).map(function (q) { return [q[1], q[0]]; });

      /* Two reflections around a rotation negate its angle, and nester.js's
       * y-down matrix negates it again — so the angle Illustrator needs is
       * Sparrow's own. Asserted below rather than trusted: the error is
       * returned, and the panel refuses anything past VERIFY_TOL_MM
       * (SPARROW_PLACEMENT_MISMATCH). Tests 2 and 3 pin the convention. The
       * opposite angle used to be tried as a second chance; no layout ever
       * reached it, and a branch nothing reaches can hand Illustrator a target
       * worked out for the angle it then rejected (review of 3.8.1). */
      var deg = theta;
      var aim = placementFrame(frame, sentRing, deg, bb);
      var err = verifyPlacement(sentRing, deg, aim, back, frame);
      /* The ring rebuilt must be the ring sent (see ringKey). A mismatch is a
       * layout this bridge cannot vouch for, so it is refused like one. */
      var keyWanted = meta.sentKeys && meta.sentKeys[pi.item_id];
      if (keyWanted !== undefined && ringKey(swapped) !== keyWanted) err = Infinity;
      if (err > maxError) maxError = err;

      placements.push({
        id: part.id,
        rotationDeg: deg,
        sheetIndex: 0,              // one strip here; the caller cuts it into sheets
        targetBboxMinMm: { x: aim.x, y: aim.y },
        /* The placed box of the whole frame, so the caller can ask "does this
         * piece end before the sheet does?" of the cut lines Illustrator
         * really places, without rebuilding the rotation itself. */
        placedWidthMm: aim.w,
        placedHeightMm: aim.h
      });
      overshootX.push(bb.minX - aim.x);
    }

    /*
     * Give back the engine's edge inset (see buildInstance). Across the roll,
     * by exactly the padding the strip was widened by. Down the roll, by where
     * the first piece really starts, so the top of the sheet is as tight as the
     * bottom: the white band an operator saw above every nest.
     */
    var padBack = meta.stripPadMm || 0, startY = Infinity;
    for (var q = 0; q < placements.length; q++) {
      if (placements[q].targetBboxMinMm.y < startY) startY = placements[q].targetBboxMinMm.y;
    }
    if (!(startY < Infinity)) startY = 0;
    for (var q2 = 0; q2 < placements.length; q2++) {
      var tg = placements[q2].targetBboxMinMm;
      placements[q2].targetBboxMinMm = { x: tg.x - padBack, y: tg.y - startY };
    }

    /*
     * Across the roll the engine kept each RING off the strip's near edge. On a
     * simplified rung a piece's true cuts reach up to eps past its ring, and
     * now that they follow it exactly (placementFrame) they could start before
     * the usable area. buildInstance keeps 2 x eps free on the far side for
     * this, so the whole layout moves across by the largest such overshoot,
     * never by more than that piece's own: every gap is kept, and the cuts stay
     * inside the usable width.
     */
    var usableW = meta.usableWidthMm, shiftX = 0, maxX = -Infinity;
    for (var q3 = 0; q3 < placements.length; q3++) {
      var t3 = placements[q3].targetBboxMinMm;
      if (t3.x < 0) shiftX = Math.max(shiftX, Math.min(-t3.x, overshootX[q3]));
      if (t3.x + placements[q3].placedWidthMm > maxX) maxX = t3.x + placements[q3].placedWidthMm;
    }
    if (shiftX > 0 && usableW > 0) {
      shiftX = Math.min(shiftX, Math.max(0, usableW - maxX));
      for (var q4 = 0; q4 < placements.length; q4++) placements[q4].targetBboxMinMm.x += shiftX;
    }

    /*
     * How far any true cut still reaches past the usable width, on either
     * side, once moved. The move and the far-side reserve absorb what a ring
     * within eps of its cuts can leave, plus a trimmed needle's 0.2 mm. More
     * than that is a ring smaller than its cuts, and the panel refuses the
     * layout rather than cut off the sheet: the far side was never checked on
     * the true cuts, and a tip lost by the simplification ran 9 mm past it
     * (review of 3.8.1).
     */
    var overWidth = 0;
    if (usableW > 0) {
      for (var q5 = 0; q5 < placements.length; q5++) {
        var t5 = placements[q5].targetBboxMinMm;
        overWidth = Math.max(overWidth, -t5.x, t5.x + placements[q5].placedWidthMm - usableW);
      }
    }

    /* A piece never sent (nothing left to nest once cleaned) or sent and not
     * placed, with its name and a reason the panel can print under it. */
    var sentIdx = {};
    for (var si = 0; si < meta.index.length; si++) sentIdx[meta.index[si]] = true;
    var unplaced = [], notPlaced = 0;
    for (var p = 0; p < parts.length; p++) {
      if (seen[p]) continue;
      var why = !sentIdx[p] ? REASON_DEGENERATE
        : (fitsBox(parts[p], usableW, 0) ? REASON_NOT_PLACED : REASON_TOO_BIG);
      /* Sent, fits the roll, and missing from the answer: the engine lost it.
       * The panel refuses such a layout rather than apply it without the
       * piece (notPlacedCount, 3.8.1). A piece too big at any angle is not
       * counted: no layout can hold it, and it is named under the result. */
      if (why === REASON_NOT_PLACED) notPlaced++;
      unplaced.push(unplacedEntry(parts[p], why));
    }

    // Used length: how far down the roll the lowest piece reaches, measured on
    // the real cut lines after the transform jsx will apply.
    var usedLength = 0;
    for (var r = 0; r < placements.length; r++) {
      var bottom = placements[r].targetBboxMinMm.y + placements[r].placedHeightMm;
      if (bottom > usedLength) usedLength = bottom;
    }

    return {
      placements: placements,
      sheetsUsed: 1,
      sheetHeightsMm: [usedLength],
      usedLengthMm: usedLength,
      unplaced: unplaced,
      notPlacedCount: notPlaced,          // sent, fits the roll, not placed
      duplicatePlacements: duplicates,    // the same piece placed more than once
      maxErrorMm: maxError,
      widthOvershootMm: overWidth,
      strippedWidthMm: sol.strip_width
    };
  }


  /* ---------------- what we actually got ---------------------------------- */

  /*
   * Smallest real distance between any two placed pieces, measured on the TRUE
   * contours after the transform Illustrator will apply -- not on the
   * simplified rings handed to the solver, and not on bounding boxes.
   *
   * This is the number that decides whether a sheet is safe to cut, so it is
   * measured rather than assumed: the solver is asked for a separation, the
   * shapes it was given were simplified, and both of those are reasons the
   * result could differ from the request.
   *
   * needMm: the smallest gap the caller ACCEPTS, the bar it really applies.
   * A pair stops being measured once it is found closer than half of it, so
   * any figure larger than the bar lets a first value between the two hide a
   * crossing further round the same outline (review of 3.8.1).
   *
   * A piece lying wholly inside another's cut contour has no cut line near the
   * other's, and boundary to boundary it measured clear: it counts as 0. The
   * engine never does that with the rings it is sent; a ring smaller than its
   * true cuts can, and the blade then cuts one piece out of the other.
   */
  function measureMinGap(placements, parts, needMm) {
    var byId = {}, i;
    for (i = 0; i < parts.length; i++) byId[parts[i].id] = parts[i];
    var placed = [];
    for (i = 0; i < placements.length; i++) {
      var pl = placements[i], part = byId[pl.id];
      if (!part) continue;
      /* Every cut line, dropped ones included: the blade cuts them too, and
       * jsx lines up the box of all of them (see cutFrame). */
      var cs = cutFrame(part);
      var rot = rotateMulti(cs, pl.rotationDeg);
      var bb = bboxOf(rot);
      var polys = translateMulti(rot, pl.targetBboxMinMm.x - bb.minX, pl.targetBboxMinMm.y - bb.minY);
      /* The closed contours come first in the frame, the dropped cuts after. */
      var closed = (part.contours || [part.contour]).length, cboxes = [];
      for (var c = 0; c < closed; c++) cboxes.push(bboxOf([polys[c]]));
      placed.push({ id: pl.id, polys: polys, closed: closed, cboxes: cboxes });
    }
    function pointInRing(ring, p) {
      var inside = false;
      for (var a = 0, b = ring.length - 1; a < ring.length; b = a++) {
        var u = ring[a], v = ring[b];
        if ((u[1] > p[1]) !== (v[1] > p[1]) &&
            p[0] < (v[0] - u[0]) * (p[1] - u[1]) / (v[1] - u[1]) + u[0]) inside = !inside;
      }
      return inside;
    }
    /* Does a cut line of Q start inside a closed contour of P? One vertex per
     * line is enough: a line that does not cross P's contour is wholly on one
     * side of it, and one that crosses it measures 0 anyway. */
    function startsInside(P, Q) {
      for (var k = 0; k < Q.polys.length; k++) {
        var v = Q.polys[k][0];
        if (!v) continue;
        for (var c2 = 0; c2 < P.closed; c2++) {
          var cb = P.cboxes[c2];
          if (v[0] < cb.minX || v[0] > cb.maxX || v[1] < cb.minY || v[1] > cb.maxY) continue;
          if (P.polys[c2].length >= 3 && pointInRing(P.polys[c2], v)) return true;
        }
      }
      return false;
    }
    function ptSeg(p, u, v) {
      var dx = v[0] - u[0], dy = v[1] - u[1], L = dx * dx + dy * dy, t;
      if (L === 0) return Math.sqrt((p[0]-u[0])*(p[0]-u[0]) + (p[1]-u[1])*(p[1]-u[1]));
      t = ((p[0]-u[0])*dx + (p[1]-u[1])*dy) / L;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      var qx = u[0] + t*dx, qy = u[1] + t*dy;
      return Math.sqrt((p[0]-qx)*(p[0]-qx) + (p[1]-qy)*(p[1]-qy));
    }
    function segDist(a, b, c, d) {
      var den = (b[0]-a[0])*(d[1]-c[1]) - (b[1]-a[1])*(d[0]-c[0]);
      if (Math.abs(den) > 1e-12) {
        var u = ((c[0]-a[0])*(d[1]-c[1]) - (c[1]-a[1])*(d[0]-c[0])) / den;
        var t = ((c[0]-a[0])*(b[1]-a[1]) - (c[1]-a[1])*(b[0]-a[0])) / den;
        if (u >= 0 && u <= 1 && t >= 0 && t <= 1) return 0;
      }
      return Math.min(ptSeg(a,c,d), ptSeg(b,c,d), ptSeg(c,a,b), ptSeg(d,a,b));
    }
    function ringDist(P, Q, bail) {
      var best = Infinity;
      for (var x = 0; x + 1 < P.length; x++)
        for (var y = 0; y + 1 < Q.length; y++) {
          var dd = segDist(P[x], P[x+1], Q[y], Q[y+1]);
          if (dd < best) { best = dd; if (best < bail) return best; }
        }
      return best;
    }
    var need = needMm || 0, worst = Infinity, pair = null;
    var boxes = placed.map(function (p) { return bboxOf(p.polys); });
    for (i = 0; i < placed.length; i++)
      for (var j = i + 1; j < placed.length; j++) {
        var A = boxes[i], B = boxes[j];
        // Bounding boxes further apart than we care about cannot be the worst.
        var gx = Math.max(0, Math.max(A.minX - B.maxX, B.minX - A.maxX));
        var gy = Math.max(0, Math.max(A.minY - B.maxY, B.minY - A.maxY));
        if (worst < Infinity && gx * gx + gy * gy > worst * worst) continue;
        if (gx === 0 && gy === 0 &&
            (startsInside(placed[i], placed[j]) || startsInside(placed[j], placed[i]))) {
          worst = 0;
          pair = [placed[i].id, placed[j].id];
          continue;
        }
        for (var a = 0; a < placed[i].polys.length; a++)
          for (var b = 0; b < placed[j].polys.length; b++) {
            var d = ringDist(placed[i].polys[a], placed[j].polys[b], need * 0.5);
            if (d < worst) { worst = d; pair = [placed[i].id, placed[j].id]; }
          }
      }
    return { minGapMm: worst === Infinity ? null : worst, pair: pair };
  }

  /* ---------------- one strip -> real sheets -------------------------------- */

  /*
   * Which of these placements finish INSIDE a sheet `heightMm` tall, and how
   * far down the sheet they reach.
   *
   * The tolerance is 0.01 mm, not zero: the placement arrives through a
   * rotation and two axis swaps, so a piece meant to land exactly on the line
   * can measure 1e-9 past it, and refusing that would push a perfectly good
   * piece onto a second sheet of vinyl.
   */
  function sheetSlice(placements, heightMm) {
    var kept = [], ids = {}, bottom = 0;
    for (var i = 0; i < placements.length; i++) {
      var p = placements[i];
      var b = p.targetBboxMinMm.y + (p.placedHeightMm || 0);
      if (b <= heightMm + 0.01) {
        kept.push(p);
        ids[p.id] = true;
        if (b > bottom) bottom = b;
      }
    }
    return { kept: kept, ids: ids, bottomMm: bottom };
  }

  /* Signed area of one ring, and the area a part really covers. Used only to
   * SIZE a sheet's workload, so the same measure appears on both sides of the
   * ratio and its own imprecision cancels out. */
  function ringArea(ring) {
    var a = 0;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
    }
    return Math.abs(a) / 2;
  }
  /*
   * Holes are taken off, even-odd: a contour inside an odd number of larger
   * ones is a hole, inside an even number (none, or an island in a hole) it
   * is material. Adding them all up counted a panel's holes as more vinyl.
   * Inside is decided on a handful of the contour's vertices, by majority, so
   * a hole touching its outline at one point still counts as a hole.
   *
   * A contour drawn twice (a cut path pasted in place, a common slip) counts
   * once. Its vertices lie ON the other copy, which the even-odd test calls
   * outside, so the copy was added or taken off a second time: an outline
   * drawn twice doubled the piece's area (review of 3.8.1).
   */
  function sameContour(a, b) {
    var t = CONTAIN_TOL_MM;
    if (Math.abs(a.box.minX - b.box.minX) > t || Math.abs(a.box.maxX - b.box.maxX) > t ||
        Math.abs(a.box.minY - b.box.minY) > t || Math.abs(a.box.maxY - b.box.maxY) > t) return false;
    if (Math.abs(a.area - b.area) > 0.01 * Math.max(a.area, b.area) + 1e-9) return false;
    if (!b.idx) b.idx = edgeIndex(b.ring);
    for (var v = 0; v < a.ring.length; v++) {
      if (!nearIndexed(b.idx, a.ring[v], a.ring[v], t)) return false;
    }
    return true;
  }
  function partArea(part) {
    var cs = part.contours || [part.contour], rings = [], i, j;
    for (i = 0; i < cs.length; i++) {
      if (!cs[i] || cs[i].length < 3) continue;
      var r = dedupe(openRing(cs[i]));
      if (r.length >= 3) rings.push({ ring: r, area: ringArea(r), box: bboxOf([r]), idx: null });
    }
    rings.sort(function (a, b) { return b.area - a.area; });
    var sum = 0;
    for (i = 0; i < rings.length; i++) {
      var me = rings[i], depth = 0;
      for (j = 0; j < i && !me.copy; j++) {
        if (!rings[j].copy && sameContour(me, rings[j])) me.copy = true;
      }
      if (me.copy) continue;
      var every = Math.max(1, Math.floor(me.ring.length / 9));
      for (j = 0; j < i; j++) {
        var o = rings[j];
        if (o.copy) continue;
        if (me.box.minX < o.box.minX || me.box.maxX > o.box.maxX ||
            me.box.minY < o.box.minY || me.box.maxY > o.box.maxY) continue;
        if (!o.idx) o.idx = edgeIndex(o.ring);
        var inside = 0, tried = 0;
        for (var v = 0; v < me.ring.length; v += every) {
          tried++;
          if (insideIndexed(o.idx, me.ring[v])) inside++;
        }
        if (inside * 2 > tried) depth++;
      }
      sum += depth % 2 ? -me.area : me.area;
    }
    return sum;
  }

  /*
   * Fill sheets until the pieces run out.
   *
   * The solver packs one strip of unlimited length. A shop's sheet is not
   * unlimited -- a metre of table, a guillotine, a laminator -- so a long strip
   * has to become several sheets.
   *
   * THE OBVIOUS WAY IS WRONG, and it was tried: solve everything, keep what
   * finishes inside the first sheet, push the rest to the next one. The pieces
   * that straddle the cut leave their footprint empty, so sheet one comes back
   * with a hole in the middle the size of a fairing panel, and the vinyl that
   * hole would have held is bought again at the end of the last sheet.
   *
   * What works instead is to give each sheet its OWN problem: decide which
   * pieces belong on it, then let the solver pack exactly those into a strip of
   * their own. Nothing straddles anything, so nothing leaves a hole.
   *
   * Sizing that workload is the whole trick, and the first solve already
   * measured what is needed. It packed everything into a strip of known length,
   * so it knows the DENSITY this particular artwork reaches -- how much of the
   * roll a set of these shapes really covers, which for motorcycle panels is
   * nothing like their bounding boxes. One sheet can then hold
   * height x width x that density, and pieces are dealt out in the order the
   * first solve arranged them, so shapes that nest well together stay together.
   *
   * Safety net: if a sheet still overflows, whatever did not fit goes back to
   * the front of the queue rather than being lost, and the sheet keeps what
   * did. That is the old truncation, now the exception rather than the rule.
   *
   * `solve(parts, sheetIndex)` is injected so this can be driven without a
   * solver. `firstRes` is the full-strip solve: its length and its ordering are
   * what make the estimate, and it is never applied as a sheet itself.
   *
   * Two ways out, both needed: the pieces run out, or a pass fits nothing at
   * all, which means what is left is taller than the sheet however it is
   * turned. Without the second, one oversized decal would loop forever.
   */
  /*
   * 0.97, and it was measured rather than chosen. On a real 78-piece kit at
   * 1294 mm roll width, splitting onto 994 mm sheets: 0.97 finished in 1736 mm
   * of vinyl, 1.00 in 1783, 1.05 in 1816, against 1910 for cutting the long
   * strip up. Aiming just UNDER the sheet wins because an overshoot has to be
   * truncated and a truncation is what leaves a hole.
   */
  var FILL_SAFETY = 0.97;
  var DEFAULT_DENSITY = 0.7;   // only used when there is nothing to measure
  var TOPUP_BELOW = 0.9;       // a sheet this empty is worth one more solve
  var MAX_TOPUPS = 2;

  function packSheets(parts, opts, solve, firstRes) {
    opts = opts || {};
    var H = opts.heightMm || 0;
    var W = opts.widthMm || 0;
    var maxSheets = opts.maxSheets || 40;

    /* Deal the pieces out in the order the first solve laid them down the
     * strip: neighbours there are shapes that proved they nest together. */
    var queue = parts.slice();
    if (firstRes && firstRes.placements && firstRes.placements.length) {
      var yOf = {};
      for (var q = 0; q < firstRes.placements.length; q++) {
        yOf[firstRes.placements[q].id] = firstRes.placements[q].targetBboxMinMm.y;
      }
      queue.sort(function (a, b) {
        var ya = yOf[a.id], yb = yOf[b.id];
        if (ya === undefined) return 1;
        if (yb === undefined) return -1;
        return ya - yb;
      });
    }

    var areaOf = {}, totalArea = 0;
    for (var i = 0; i < parts.length; i++) {
      areaOf[parts[i].id] = partArea(parts[i]);
      totalArea += areaOf[parts[i].id];
    }

    var density = DEFAULT_DENSITY;
    if (firstRes && firstRes.usedLengthMm > 0 && W > 0) {
      var d = totalArea / (firstRes.usedLengthMm * W);
      if (d > 0.05 && d <= 1) density = d;
    }
    var capacity = H * W * density * FILL_SAFETY;

    var all = [], heights = [], sheet = 0;
    var maxErr = 0, minGap = null;

    /* Why a piece is left over, as the panel prints it under its name: too
     * big for a sheet at any angle, then the sheet limit when that is what
     * ended the run, then whatever the solver said about it last. */
    var lastReason = {};
    function reasonFor(pt) {
      if (!fitsBox(pt, W, H)) return REASON_TOO_BIG;
      if (sheet >= maxSheets) return "sheet limit reached (" + maxSheets + " sheets)";
      return lastReason[pt.id] || REASON_NOT_PLACED;
    }

    function done() {
      return {
        placements: all,
        sheetsUsed: heights.length,
        sheetHeightsMm: heights,
        usedLengthMm: heights.length ? heights[heights.length - 1] : 0,
        unplaced: queue.map(function (pt) { return unplacedEntry(pt, reasonFor(pt)); }),
        maxErrorMm: maxErr,
        minGapMm: minGap,
        /* Reported so the panel can say what it assumed rather than leaving the
         * operator to wonder why a sheet holds what it holds. */
        densityUsed: density
      };
    }

    /* This sheet's share. Always at least one piece, or a decal bigger than the
     * estimate would never be tried at all. */
    function deal() {
      var take = [], area = 0;
      while (queue.length) {
        var a = areaOf[queue[0].id] || 0;
        if (take.length && capacity > 0 && area + a > capacity) break;
        area += a;
        take.push(queue.shift());
      }
      return take;
    }

    function commit(b) {
      for (var m = 0; m < b.slice.kept.length; m++) b.slice.kept[m].sheetIndex = sheet;
      all = all.concat(b.slice.kept);
      heights.push(b.slice.bottomMm);
      if ((b.res.maxErrorMm || 0) > maxErr) maxErr = b.res.maxErrorMm || 0;
      if (b.res.minGapMm !== null && b.res.minGapMm !== undefined &&
          (minGap === null || b.res.minGapMm < minGap)) minGap = b.res.minGapMm;
      sheet++;
      return step();
    }

    /*
     * Solve this sheet's share; if it lands well short of the sheet, spend one
     * more solve trying to fit another piece.
     *
     * The area estimate is deliberately a little shy, because overshooting
     * costs a truncation and truncation is what leaves holes. But on a kit of
     * big panels "a little shy" can be a whole fairing side, and a sheet three
     * quarters full is most of a sheet wasted. So the estimate opens the sheet
     * and the solver closes it: add a piece, solve, and keep the result only if
     * it still fits. The last set that fitted is always kept, so a failed
     * top-up costs one solve and nothing else.
     */
    function attempt(take, topups, best) {
      return solve(take, sheet).then(function (res) {
        var told = res.unplaced || [];
        for (var u = 0; u < told.length; u++) {
          if (told[u] && told[u].reason) lastReason[told[u].id] = told[u].reason;
        }
        var slice = sheetSlice(res.placements, H);
        var dropped = [];
        for (var k = 0; k < take.length; k++) {
          if (!slice.ids[take[k].id]) dropped.push(take[k]);
        }

        if (!dropped.length && slice.kept.length) {
          best = { take: take, slice: slice, res: res };
          if (topups < MAX_TOPUPS && queue.length && slice.bottomMm < H * TOPUP_BELOW) {
            return attempt(take.concat([queue.shift()]), topups + 1, best);
          }
          return commit(best);
        }

        /* Overflowed. If a smaller set already fitted, that is the sheet, and
         * the pieces beyond it go back to the FRONT of the queue so the next
         * sheet sees them first. Nothing is ever quietly lost. */
        if (best) {
          var keptIds = {};
          for (var b = 0; b < best.take.length; b++) keptIds[best.take[b].id] = true;
          queue = take.filter(function (p) { return !keptIds[p.id]; }).concat(queue);
          return commit(best);
        }
        if (!slice.kept.length) {
          queue = dropped.concat(queue);
          return Promise.resolve(done());
        }
        queue = dropped.concat(queue);
        return commit({ take: take, slice: slice, res: res });
      });
    }

    function step() {
      if (!queue.length || sheet >= maxSheets) return Promise.resolve(done());
      return attempt(deal(), 0, null);
    }
    return step();
  }

  return {
    buildInstance: buildInstance,
    measureMinGap: measureMinGap,
    readSolution: readSolution,
    sheetSlice: sheetSlice,
    packSheets: packSheets,
    _internal: {
      convexHull: convexHull, dedupe: dedupe, rotateMulti: rotateMulti,
      removeNeedles: removeNeedles, selfIntersects: selfIntersects, cleanRing: cleanRing,
      simplify: simplify,
      ringToSend: ringToSend, enclosingOutline: enclosingOutline, edgeIndex: edgeIndex,
      ringInside: ringInside, CONTAIN_TOL_MM: CONTAIN_TOL_MM,
      bboxOf: bboxOf, applySparrow: applySparrow, verifyPlacement: verifyPlacement,
      cutFrame: cutFrame, placementFrame: placementFrame, droppedCutsOf: droppedCutsOf,
      fitsBox: fitsBox, partArea: partArea
    }
  };
});
