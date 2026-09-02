/* Generation pipeline — a sequence of named passes rather than raw noise.
 *
 *   1. sample     world-space fBm + domain warp -> raw height
 *   2. shape      blend ridged mountains, radial island falloff
 *   3. repair     kill single-tile spikes / pits, light smoothing
 *   4. sea level  absolute threshold from a fixed reference (map size independent)
 *   5. climate    moisture + temperature (latitude band + noise + altitude)
 *   6. classify   biome per cell, slope-aware coasts
 *   7. hydrology  distance-from-shore water depth, downhill rivers
 *  7z. settle     bounded water/lava spreading and local pooling
 *   8. voxelize   signed discrete levels, clamp towers
 *
 * World-space sampling means terrain features keep a constant size — growing
 * the map reveals more world at the edges instead of scaling everything up. */
(function (SM) {
  'use strict';

  var REF = 112;          // reference tile span for world-space coords
  var ISLAND_R = 0.62;    // island radius in world units (falloff)
  var RIDGE_W = 0.13;     // half-width of a mountain range, world units
  var RIDGE_H = 0.30;     // how much a range lifts the terrain
  var RFS = 128;          // ridge distance-field resolution
  var RF_SPAN = 1.35;     // ridge field covers world ±RF_SPAN

  /* Mountain ranges follow LINES (fault lines / plate boundaries), not random
   * blobs. Build a few wandering polylines, then a coarse distance field so the
   * per-cell lookup is cheap. */
  function makeRidgeField(cfg) {
    var rnd = SM.mulberry32((cfg.seed ^ 0x1b56c4e9) >>> 0);
    var count = 2 + (rnd() * 3 | 0);
    var segs = [];
    for (var r = 0; r < count; r++) {
      var px = (rnd() * 2 - 1) * 1.1, py = (rnd() * 2 - 1) * 1.1;
      var ang = rnd() * Math.PI * 2;
      var len = 14 + (rnd() * 12 | 0);
      for (var s = 0; s < len; s++) {
        ang += (rnd() - 0.5) * 0.55;
        var nx2 = px + Math.cos(ang) * 0.09, ny2 = py + Math.sin(ang) * 0.09;
        segs.push([px, py, nx2, ny2]);
        px = nx2; py = ny2;
      }
    }
    var field = new Float32Array(RFS * RFS);
    for (var gy = 0; gy < RFS; gy++) {
      for (var gx = 0; gx < RFS; gx++) {
        var wx = (gx / (RFS - 1) * 2 - 1) * RF_SPAN;
        var wy = (gy / (RFS - 1) * 2 - 1) * RF_SPAN;
        var best = 1e9;
        for (var k2 = 0; k2 < segs.length; k2++) {
          var d = segDist(wx, wy, segs[k2]);
          if (d < best) best = d;
        }
        var t = best / RIDGE_W;
        field[gy * RFS + gx] = t >= 1 ? 0 : (1 - t) * (1 - t);
      }
    }
    return field;
  }

  function segDist(px, py, s) {
    var ax = s[0], ay = s[1], bx = s[2], by = s[3];
    var vx = bx - ax, vy = by - ay;
    var wx = px - ax, wy = py - ay;
    var c1 = vx * wx + vy * wy;
    if (c1 <= 0) return Math.sqrt(wx * wx + wy * wy);
    var c2 = vx * vx + vy * vy;
    if (c2 <= c1) return Math.sqrt((px - bx) * (px - bx) + (py - by) * (py - by));
    var tt = c1 / c2;
    var qx = ax + tt * vx, qy = ay + tt * vy;
    return Math.sqrt((px - qx) * (px - qx) + (py - qy) * (py - qy));
  }

  function ridgeAt(field, wx, wy) {
    var fx = (wx / RF_SPAN * 0.5 + 0.5) * (RFS - 1);
    var fy = (wy / RF_SPAN * 0.5 + 0.5) * (RFS - 1);
    if (fx < 0 || fy < 0 || fx > RFS - 1 || fy > RFS - 1) return 0;
    var x0 = fx | 0, y0 = fy | 0;
    var x1 = x0 < RFS - 1 ? x0 + 1 : x0, y1 = y0 < RFS - 1 ? y0 + 1 : y0;
    var tx = fx - x0, ty = fy - y0;
    var a = field[y0 * RFS + x0], b = field[y0 * RFS + x1];
    var c = field[y1 * RFS + x0], d = field[y1 * RFS + x1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  var DEFAULTS = {
    width: 192,
    height: 192,
    seed: 1337,
    seaLevel: 0.38,        // ~fraction of the reference area that is water
    elevationScale: 2.5,   // world-space noise frequency
    octaves: 5,
    ruggedness: 0.35,
    warp: 0.18,            // domain-warp strength (organic coastlines)
    moistureScale: 3.0,
    temperatureBias: 0.0,
    moistureBias: 0.0,
    islandFalloff: 0.0,    // 0 = continents to the edge, 1 = single centred island
    rivers: 1.0,           // 0 = none, 1 = normal, 2 = many
    levels: 10,
    waterDepth: 3
  };

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  function smoothstep(lo, hi, v) {
    var t = clamp01((v - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
  }

  /* One height sample through the full shaping chain, at world coords (wx, wy).
   * `norm` remaps the typical fBm range to [0,1] without per-map min/max, so
   * the result is comparable across map sizes. */
  function heightAt(baseN, ridgeN, warpN, rfield, wx, wy, cfg) {
    if (cfg.warp > 0) {
      var wux = SM.fbm(warpN, wx * 0.7 + 11.3, wy * 0.7 + 5.1, 2, 2, 0.5);
      var wuy = SM.fbm(warpN, wx * 0.7 - 7.7, wy * 0.7 - 3.2, 2, 2, 0.5);
      wx += wux * cfg.warp;
      wy += wuy * cfg.warp;
    }
    var base = SM.fbm(baseN, wx * cfg.elevationScale, wy * cfg.elevationScale, cfg.octaves, 2, 0.5);
    base = (base + 1) / 2;
    // fixed contrast curve (no per-map normalize) — pushes the fBm's clustered
    // mid-values apart so land/sea separate cleanly and features have body.
    base = clamp01(0.5 + (base - 0.5) * 1.75);

    var ridge = SM.fbmRidged(ridgeN, wx * cfg.elevationScale * 1.7, wy * cfg.elevationScale * 1.7, Math.min(cfg.octaves, 5), 2, 0.5);
    var mix = cfg.ruggedness * 0.5;
    var e = base * (1 - mix) + ridge * mix;

    // fold mountain ranges along the fault lines, textured by the ridged noise
    if (rfield) {
      var rb = ridgeAt(rfield, wx, wy);
      if (rb > 0) e += Math.pow(rb, 1.5) * RIDGE_H * (0.55 + 0.45 * ridge);
    }

    if (cfg.islandFalloff > 0) {
      var d = Math.sqrt(wx * wx + wy * wy) / ISLAND_R;
      var fall = Math.max(0, 1 - d * d);
      e = e * (1 - cfg.islandFalloff) + e * fall * cfg.islandFalloff;
    }
    return clamp01(e);
  }

  function generate(opts) {
    var cfg = Object.assign({}, DEFAULTS, opts || {});
    var w = cfg.width, h = cfg.height, n = w * h;
    var grid = SM.createGrid(w, h);
    var B = SM.BIOME_IDX;

    var baseN = SM.makeNoise2D(cfg.seed);
    var ridgeN = SM.makeNoise2D((cfg.seed ^ 0x2545f491) >>> 0);
    var warpN = SM.makeNoise2D((cfg.seed ^ 0x27d4eb2f) >>> 0);
    var moistN = SM.makeNoise2D((cfg.seed ^ 0x9e3779b9) >>> 0);
    var tempN = SM.makeNoise2D((cfg.seed ^ 0x85ebca6b) >>> 0);

    var cx0 = (w - 1) / 2, cy0 = (h - 1) / 2;
    function wxOf(x) { return (x - cx0) / REF; }
    function wyOf(y) { return (y - cy0) / REF; }

    var rfield = makeRidgeField(cfg);

    // sea level first — an absolute threshold from a fixed reference sample
    // (no island falloff) so it doesn't depend on map size.
    var refCfg0 = Object.assign({}, cfg, { islandFalloff: 0 });
    var RS = 96, ref = new Float32Array(RS * RS), rk = 0;
    for (y = 0; y < RS; y++) {
      for (x = 0; x < RS; x++) {
        ref[rk++] = heightAt(baseN, ridgeN, warpN, rfield,
          (x - RS / 2) / (RS / 1.8), (y - RS / 2) / (RS / 1.8), refCfg0);
      }
    }
    ref.sort();
    var seaThresh = ref[Math.min(ref.length - 1, Math.floor(cfg.seaLevel * (ref.length - 1)))];
    var refPeak = ref[ref.length - 1];
    var beachThresh = seaThresh + 0.02;

    // --- 1+2: sample world-space height into the grid ---
    var e = new Float32Array(n);
    var x, y, i;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        e[y * w + x] = heightAt(baseN, ridgeN, warpN, rfield, wxOf(x), wyOf(y), cfg);
      }
    }

    // --- 3: repair — clamp single-tile spikes/pits, then a gentle smooth ---
    // SPIKE is kept below one discrete level so no tile can tower over its
    // neighbourhood after voxelization.
    var SPIKE = 0.05;
    var tmp = new Float32Array(n);
    function at(a, xx, yy) {
      if (xx < 0) xx = 0; else if (xx >= w) xx = w - 1;
      if (yy < 0) yy = 0; else if (yy >= h) yy = h - 1;
      return a[yy * w + xx];
    }
    var pass;
    for (pass = 0; pass < 3; pass++) {
      for (y = 0; y < h; y++) {
        for (x = 0; x < w; x++) {
          i = y * w + x;
          var u = at(e, x, y - 1), dn = at(e, x, y + 1);
          var l = at(e, x - 1, y), r = at(e, x + 1, y);
          var mx = Math.max(u, dn, l, r), mn = Math.min(u, dn, l, r);
          var v = e[i];
          if (v - mx > SPIKE) v = mx + SPIKE;
          else if (mn - v > SPIKE) v = mn - SPIKE;
          tmp[i] = v;
        }
      }
      e.set(tmp);
    }
    // --- 3b: peak prominence — a tall summit pulls down rival peaks nearby so a
    // big mountain stands alone, not in a clump. Tallest peaks are processed
    // first and claim a dominance radius; near-equal ground inside it is lowered
    // into shoulders and saddles. ---
    var peaks = [];
    for (y = 3; y < h - 3; y++) {
      for (x = 3; x < w - 3; x++) {
        i = y * w + x;
        var pv = e[i];
        if (pv < seaThresh + 0.16) continue;
        if (pv >= e[i - 1] && pv >= e[i + 1] && pv >= e[i - w] && pv >= e[i + w] &&
            pv >= e[i - w - 1] && pv >= e[i - w + 1] && pv >= e[i + w - 1] && pv >= e[i + w + 1]) {
          peaks.push({ x: x, y: y, v: pv });
        }
      }
    }
    peaks.sort(function (a, b) { return b.v - a.v; });
    var DOM_R = 13, claimed = new Uint8Array(n);
    for (var pp = 0; pp < peaks.length; pp++) {
      var pk = peaks[pp], pkI = pk.y * w + pk.x;
      if (claimed[pkI]) continue;
      for (var ddy = -DOM_R; ddy <= DOM_R; ddy++) {
        var ny2 = pk.y + ddy; if (ny2 < 0 || ny2 >= h) continue;
        for (var ddx = -DOM_R; ddx <= DOM_R; ddx++) {
          var nx2 = pk.x + ddx; if (nx2 < 0 || nx2 >= w) continue;
          var dd = Math.sqrt(ddx * ddx + ddy * ddy);
          if (dd > DOM_R) continue;
          var ci = ny2 * w + nx2;
          claimed[ci] = 1;
          if (ci === pkI) continue;
          // force a downslope away from the dominant summit — rivals become shoulders
          var cap = pk.v - 0.045 - dd * 0.0135;
          if (e[ci] > cap) e[ci] = e[ci] * 0.18 + cap * 0.82;
        }
      }
    }

    // --- 3c: plateaus — seeded highland caps with broad, level interiors ---
    var plateauRnd = SM.mulberry32((cfg.seed ^ 0x6d2b79f5) >>> 0);
    var plateauCandidates = [];
    for (y = 10; y < h - 10; y += 3) {
      for (x = 10; x < w - 10; x += 3) {
        i = y * w + x;
        if (e[i] > seaThresh + 0.55 * Math.max(0.32, refPeak - seaThresh)) {
          plateauCandidates.push(i);
        }
      }
    }
    for (var pc = plateauCandidates.length - 1; pc > 0; pc--) {
      var ps = (plateauRnd() * (pc + 1)) | 0;
      var pSwap = plateauCandidates[pc]; plateauCandidates[pc] = plateauCandidates[ps]; plateauCandidates[ps] = pSwap;
    }
    var plateauCount = Math.min(plateauCandidates.length, 1 + (plateauRnd() * 3 | 0));
    var plateauUsed = [];
    for (var pn = 0, made = 0; pn < plateauCandidates.length && made < plateauCount; pn++) {
      var pCenter = plateauCandidates[pn], pcx = pCenter % w, pcy = (pCenter / w) | 0;
      var pFar = true;
      for (var pu = 0; pu < plateauUsed.length; pu++) {
        var pudx = pcx - plateauUsed[pu][0], pudy = pcy - plateauUsed[pu][1];
        if (pudx * pudx + pudy * pudy < 324) { pFar = false; break; }
      }
      if (!pFar) continue;
      var pr = 6 + (plateauRnd() * 4 | 0), pVals = [];
      for (var py = -pr; py <= pr; py++) for (var px = -pr; px <= pr; px++) {
        if (px * px + py * py <= (pr - 1) * (pr - 1)) pVals.push(e[(pcy + py) * w + pcx + px]);
      }
      pVals.sort(function (a, b) { return a - b; });
      var pTop = pVals[Math.floor(pVals.length * 0.75)];
      if (pTop < seaThresh + 0.12) continue;
      for (py = -pr; py <= pr; py++) {
        for (px = -pr; px <= pr; px++) {
          var pd = Math.sqrt(px * px + py * py);
          if (pd > pr) continue;
          var pidx = (pcy + py) * w + pcx + px;
          if (pd <= pr - 1.5) e[pidx] = pTop + (e[pidx] - pTop) * 0.08;
          else e[pidx] = Math.min(e[pidx], pTop - 0.035 * (pd - pr + 1.5));
        }
      }
      plateauUsed.push([pcx, pcy]); made++;
    }
    for (i = 0; i < n; i++) grid.elevation[i] = e[i];

    var mapMax = 0;
    for (i = 0; i < n; i++) if (e[i] > mapMax) mapMax = e[i];
    var landSpan = Math.max(0.32, Math.max(mapMax, refPeak) - seaThresh);

    // --- 5a: base moisture + water flag ---
    var mois = new Float32Array(n);
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x;
        grid.water[i] = e[i] < seaThresh ? 1 : 0;
        var mo = SM.fbm(moistN, wxOf(x) * cfg.moistureScale, wyOf(y) * cfg.moistureScale, 4, 2, 0.5);
        mois[i] = clamp01((mo + 1) / 2 * 0.9 + 0.14 + cfg.moistureBias);
      }
    }

    // --- 5b: rain shadow + orographic — march upwind; mountains block rain on
    // their lee side, windward slopes get extra. Prevailing wind is seeded. ---
    var wr = SM.mulberry32((cfg.seed ^ 0x632be59b) >>> 0)();
    var wdx = Math.cos(wr * 6.2832), wdy = Math.sin(wr * 6.2832);
    var MARCH = 20;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x;
        if (grid.water[i]) continue;
        var here = e[i], maxUp = here, upStep1 = here;
        for (var m = 1; m <= MARCH; m++) {
          var ux = Math.round(x - wdx * m), uy = Math.round(y - wdy * m);
          var ue = at(e, ux, uy);
          if (m === 1) upStep1 = ue;
          if (ue > maxUp) maxUp = ue;
        }
        var barrier = maxUp - here;                 // mountains upwind
        if (barrier > 0) mois[i] = clamp01(mois[i] - 0.42 * Math.min(1, barrier / 0.22));
        var climb = here - upStep1;                 // this cell on a windward rise
        if (climb > 0) mois[i] = clamp01(mois[i] + 0.45 * Math.min(1, climb / 0.10));
      }
    }
    for (i = 0; i < n; i++) grid.moisture[i] = mois[i];

    // --- 5c: continentality — distance from border-connected ocean moderates climate ---
    var climateOcean = new Uint8Array(n), climateDist = new Int16Array(n);
    var cq = [], ch = 0;
    for (x = 0; x < w; x++) {
      if (grid.water[x]) { climateOcean[x] = 1; cq.push(x); }
      var cbi = (h - 1) * w + x;
      if (grid.water[cbi] && !climateOcean[cbi]) { climateOcean[cbi] = 1; cq.push(cbi); }
    }
    for (y = 0; y < h; y++) {
      var cli = y * w, cri = cli + w - 1;
      if (grid.water[cli] && !climateOcean[cli]) { climateOcean[cli] = 1; cq.push(cli); }
      if (grid.water[cri] && !climateOcean[cri]) { climateOcean[cri] = 1; cq.push(cri); }
    }
    while (ch < cq.length) {
      var cc = cq[ch++], ccx = cc % w, ccy = (cc / w) | 0;
      var cnb = [ccx > 0 ? cc - 1 : -1, ccx < w - 1 ? cc + 1 : -1,
        ccy > 0 ? cc - w : -1, ccy < h - 1 ? cc + w : -1];
      for (var cn = 0; cn < 4; cn++) {
        var cni = cnb[cn];
        if (cni >= 0 && grid.water[cni] && !climateOcean[cni]) { climateOcean[cni] = 1; cq.push(cni); }
      }
    }
    cq = []; ch = 0;
    for (i = 0; i < n; i++) {
      climateDist[i] = climateOcean[i] ? 0 : -1;
      if (climateOcean[i]) cq.push(i);
    }
    while (ch < cq.length) {
      cc = cq[ch++]; ccx = cc % w; ccy = (cc / w) | 0;
      cnb = [ccx > 0 ? cc - 1 : -1, ccx < w - 1 ? cc + 1 : -1,
        ccy > 0 ? cc - w : -1, ccy < h - 1 ? cc + w : -1];
      for (cn = 0; cn < 4; cn++) {
        cni = cnb[cn];
        if (cni >= 0 && climateDist[cni] < 0) { climateDist[cni] = climateDist[cc] + 1; cq.push(cni); }
      }
    }
    for (i = 0; i < n; i++) {
      if (!grid.water[i]) grid.moisture[i] = mois[i] = clamp01(mois[i] - 0.15 * clamp01(climateDist[i] / 42));
    }

    // --- 5d + 6: temperature + biome classification ---
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x;
        var ev = e[i];
        var ny = y / h;
        var isWater = grid.water[i];
        var landFrac = isWater ? 0 : clamp01((ev - seaThresh) / landSpan);

        var latBand = 1 - Math.abs(ny - 0.5) * 1.7;
        var tn = SM.fbm(tempN, wxOf(x) * 2.2, wyOf(y) * 2.2, 3, 2, 0.5) * 0.13;
        var t = 0.16 + 0.78 * latBand + tn - landFrac * 0.30 + cfg.temperatureBias;
        var contin = isWater ? 0 : clamp01(climateDist[i] / 42);
        t = clamp01(t + (t - 0.5) * 0.25 * contin);
        grid.temperature[i] = t;

        var slope = 0.5 * (
          Math.abs(ev - at(e, x - 1, y)) + Math.abs(ev - at(e, x + 1, y)) +
          Math.abs(ev - at(e, x, y - 1)) + Math.abs(ev - at(e, x, y + 1))
        );

        if (isWater) {
          grid.biome[i] = B.shallow_water;
        } else if (ev < beachThresh) {
          grid.biome[i] = slope > 0.075 ? B.cliff : B.beach;
        } else if (slope > 0.125) {
          grid.biome[i] = B.cliff;
        } else {
          grid.biome[i] = SM.classifyBiome(landFrac, grid.moisture[i], t);
        }
      }
    }

    // --- 6b: de-speckle the coastline — 1-tile islands sink, 1-tile puddles fill ---
    var wbuf = new Uint8Array(n);
    wbuf.set(grid.water);
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x;
        var lc = 0, wc = 0;
        if (x > 0) (grid.water[i - 1] ? wc++ : lc++);
        if (x < w - 1) (grid.water[i + 1] ? wc++ : lc++);
        if (y > 0) (grid.water[i - w] ? wc++ : lc++);
        if (y < h - 1) (grid.water[i + w] ? wc++ : lc++);
        if (!grid.water[i] && lc === 0 && e[i] < seaThresh + 0.015) {
          wbuf[i] = 1;
        } else if (grid.water[i] && wc <= 1 && e[i] > seaThresh - 0.06) {
          wbuf[i] = 0;
        }
      }
    }
    for (i = 0; i < n; i++) {
      if (wbuf[i] !== grid.water[i]) {
        grid.water[i] = wbuf[i];
        if (wbuf[i]) grid.biome[i] = B.shallow_water;
        else grid.biome[i] = e[i] < seaThresh + 0.02 ? B.beach : SM.classifyBiome(
          clamp01((e[i] - seaThresh) / landSpan), grid.moisture[i], grid.temperature[i]);
      }
    }

    // --- 6c: flood-fill the ocean from the map border; landlocked water = lake ---
    var ocean = new Uint8Array(n);
    var oq = [], ohd = 0;
    for (x = 0; x < w; x++) {
      if (grid.water[x] && !ocean[x]) { ocean[x] = 1; oq.push(x); }
      var bi = (h - 1) * w + x;
      if (grid.water[bi] && !ocean[bi]) { ocean[bi] = 1; oq.push(bi); }
    }
    for (y = 0; y < h; y++) {
      var li = y * w, ri = y * w + w - 1;
      if (grid.water[li] && !ocean[li]) { ocean[li] = 1; oq.push(li); }
      if (grid.water[ri] && !ocean[ri]) { ocean[ri] = 1; oq.push(ri); }
    }
    while (ohd < oq.length) {
      var oi = oq[ohd++];
      var oxx = oi % w, oyy = (oi / w) | 0;
      if (oxx > 0 && grid.water[oi - 1] && !ocean[oi - 1]) { ocean[oi - 1] = 1; oq.push(oi - 1); }
      if (oxx < w - 1 && grid.water[oi + 1] && !ocean[oi + 1]) { ocean[oi + 1] = 1; oq.push(oi + 1); }
      if (oyy > 0 && grid.water[oi - w] && !ocean[oi - w]) { ocean[oi - w] = 1; oq.push(oi - w); }
      if (oyy < h - 1 && grid.water[oi + w] && !ocean[oi + w]) { ocean[oi + w] = 1; oq.push(oi + w); }
    }
    for (i = 0; i < n; i++) {
      if (grid.water[i] && !ocean[i]) grid.biome[i] = B.lake;
    }

    // --- 6d: island consolidation — retain a sea-level-dependent set of land bodies ---
    var landSeen = new Uint8Array(n), landBodies = [];
    for (i = 0; i < n; i++) {
      if (grid.water[i] || landSeen[i]) continue;
      var landBody = [i], lhead = 0; landSeen[i] = 1;
      while (lhead < landBody.length) {
        var lc0 = landBody[lhead++], lcx = lc0 % w, lcy = (lc0 / w) | 0;
        var lnb0 = [lcx > 0 ? lc0 - 1 : -1, lcx < w - 1 ? lc0 + 1 : -1,
          lcy > 0 ? lc0 - w : -1, lcy < h - 1 ? lc0 + w : -1];
        for (var ln0 = 0; ln0 < 4; ln0++) {
          var lni0 = lnb0[ln0];
          if (lni0 >= 0 && !grid.water[lni0] && !landSeen[lni0]) {
            landSeen[lni0] = 1; landBody.push(lni0);
          }
        }
      }
      landBodies.push({ cells: landBody, size: landBody.length, keep: false });
    }
    landBodies.sort(function (a, b) { return b.size - a.size; });
    // As the sea rises the minimum surviving island size sweeps up through the
    // size distribution: specks go first, then small isles, and near the top of
    // the range only the main landmass clears the bar. So the island COUNT
    // falls smoothly and, at the extreme, collapses to one — rather than the
    // map shattering into more and more confetti. The largest body is always
    // kept. `consT*consT` keeps the bar low across most of the slider and only
    // ramps hard near the end.
    var biggestBody = landBodies.length ? landBodies[0].size : 1;
    var consT = smoothstep(0.28, 0.72, cfg.seaLevel);
    var minKeep = Math.round(4 + (biggestBody * 0.85 - 4) * consT * consT);
    for (var lb = 0; lb < landBodies.length; lb++) {
      landBodies[lb].keep = lb === 0 || landBodies[lb].size >= minKeep;
      if (!landBodies[lb].keep) {
        for (var lbc = 0; lbc < landBodies[lb].cells.length; lbc++) {
          var sink = landBodies[lb].cells[lbc];
          grid.water[sink] = 1;
          e[sink] = Math.min(e[sink], seaThresh - 0.02);
          grid.biome[sink] = B.shallow_water;
        }
      }
    }
    // Re-label ocean after the newly submerged cells join the sea.
    for (i = 0; i < n; i++) ocean[i] = 0;
    oq = []; ohd = 0;
    for (x = 0; x < w; x++) {
      if (grid.water[x]) { ocean[x] = 1; oq.push(x); }
      bi = (h - 1) * w + x;
      if (grid.water[bi] && !ocean[bi]) { ocean[bi] = 1; oq.push(bi); }
    }
    for (y = 0; y < h; y++) {
      li = y * w; ri = li + w - 1;
      if (grid.water[li] && !ocean[li]) { ocean[li] = 1; oq.push(li); }
      if (grid.water[ri] && !ocean[ri]) { ocean[ri] = 1; oq.push(ri); }
    }
    while (ohd < oq.length) {
      oi = oq[ohd++]; oxx = oi % w; oyy = (oi / w) | 0;
      var onb = [oxx > 0 ? oi - 1 : -1, oxx < w - 1 ? oi + 1 : -1,
        oyy > 0 ? oi - w : -1, oyy < h - 1 ? oi + w : -1];
      for (var on = 0; on < 4; on++) {
        var oni0 = onb[on];
        if (oni0 >= 0 && grid.water[oni0] && !ocean[oni0]) { ocean[oni0] = 1; oq.push(oni0); }
      }
    }
    for (i = 0; i < n; i++) if (grid.water[i] && !ocean[i]) grid.biome[i] = B.lake;

    // --- 6e: fjords — sparse cold, steep coastal inlets with cliff walls ---
    var fjordRnd = SM.mulberry32((cfg.seed ^ 0xa4c3f129) >>> 0);
    var fjordCandidates = [];
    for (y = 2; y < h - 2; y++) for (x = 2; x < w - 2; x++) {
      i = y * w + x;
      if (grid.water[i] || grid.temperature[i] >= 0.32) continue;
      var fslope = 0.5 * (Math.abs(e[i] - e[i - 1]) + Math.abs(e[i] - e[i + 1]) +
        Math.abs(e[i] - e[i - w]) + Math.abs(e[i] - e[i + w]));
      if (fslope < 0.075) continue;
      if (ocean[i - 1] || ocean[i + 1] || ocean[i - w] || ocean[i + w]) fjordCandidates.push(i);
    }
    var fjordWant = fjordCandidates.length ? (fjordRnd() * 4 | 0) : 0;
    for (var fj = 0; fj < fjordWant && fjordCandidates.length; fj++) {
      var fci = fjordCandidates[(fjordRnd() * fjordCandidates.length) | 0];
      var fcx = fci % w, fcy = (fci / w) | 0, fdx = 0, fdy = 0;
      if (ocean[fci - 1]) fdx++; if (ocean[fci + 1]) fdx--;
      if (ocean[fci - w]) fdy++; if (ocean[fci + w]) fdy--;
      var fcur = fci, flen = 6 + (fjordRnd() * 7 | 0);
      for (var fst = 0; fst < flen; fst++) {
        var fxx = fcur % w, fyy = (fcur / w) | 0;
        if (fxx < 2 || fyy < 2 || fxx >= w - 2 || fyy >= h - 2 || grid.water[fcur]) break;
        grid.water[fcur] = 1; ocean[fcur] = 1; e[fcur] = Math.min(e[fcur], seaThresh - 0.012);
        grid.biome[fcur] = B.shallow_water;
        var fwalls = [fcur - 1, fcur + 1, fcur - w, fcur + w];
        for (var fwi = 0; fwi < 4; fwi++) if (!grid.water[fwalls[fwi]]) grid.biome[fwalls[fwi]] = B.cliff;
        var fbest = -1, fbestScore = 1e9;
        for (var fsy = -1; fsy <= 1; fsy++) for (var fsx = -1; fsx <= 1; fsx++) {
          if (!fsx && !fsy) continue;
          var fnx = fxx + fsx, fny = fyy + fsy, fni = fny * w + fnx;
          if (grid.water[fni]) continue;
          var forward = fsx * fdx + fsy * fdy;
          if (forward < 0) continue;
          var fscore = e[fni] - forward * 0.025 + fjordRnd() * 0.006;
          if (fscore < fbestScore) { fbestScore = fscore; fbest = fni; }
        }
        if (fbest < 0) break;
        fcur = fbest;
      }
    }

    // --- 6f: coastal spits and lagoons — curving beach fingers along gentle shores ---
    var spitRnd = SM.mulberry32((cfg.seed ^ 0x3f84d5b5) >>> 0);
    var spitCandidates = [];
    for (y = 2; y < h - 2; y++) for (x = 2; x < w - 2; x++) {
      i = y * w + x;
      if (grid.water[i] || grid.biome[i] !== B.beach) continue;
      var sWater = ocean[i - 1] + ocean[i + 1] + ocean[i - w] + ocean[i + w];
      if (sWater) spitCandidates.push(i);
    }
    var spitWant = spitCandidates.length ? (spitRnd() * 3 | 0) : 0;
    for (var sp = 0; sp < spitWant && spitCandidates.length; sp++) {
      var sci = spitCandidates[(spitRnd() * spitCandidates.length) | 0];
      var scx = sci % w, scy = (sci / w) | 0, snx = 0, sny = 0;
      if (ocean[sci - 1]) snx--; if (ocean[sci + 1]) snx++;
      if (ocean[sci - w]) sny--; if (ocean[sci + w]) sny++;
      var stx = -sny, sty = snx;
      if (spitRnd() < 0.5) { stx = -stx; sty = -sty; }
      var sxp = scx, syp = scy, slen = 4 + (spitRnd() * 4 | 0);
      for (var ss = 0; ss < slen; ss++) {
        if (ss > slen / 2 && spitRnd() < 0.45) { stx += snx; sty += sny; }
        var sl = Math.max(1, Math.sqrt(stx * stx + sty * sty));
        sxp += Math.round(stx / sl); syp += Math.round(sty / sl);
        if (sxp <= 0 || syp <= 0 || sxp >= w - 1 || syp >= h - 1) break;
        var spi = syp * w + sxp;
        if (!grid.water[spi] || !ocean[spi]) break;
        grid.water[spi] = 0; ocean[spi] = 0; e[spi] = Math.max(e[spi], seaThresh + 0.006); grid.biome[spi] = B.beach;
        var lagx = sxp + snx, lagy = syp + sny;
        if (lagx > 0 && lagy > 0 && lagx < w - 1 && lagy < h - 1) {
          var lagi = lagy * w + lagx;
          if (grid.water[lagi]) grid.biome[lagi] = B.lake;
        }
      }
    }

    // --- 6g: volcanic cones — hot, dry ridge summits with lava craters and flows ---
    grid.lava = new Uint8Array(n);
    var volcanoRnd = SM.mulberry32((cfg.seed ^ 0xd1b54a35) >>> 0);
    var volcanoCandidates = [];
    for (y = 7; y < h - 7; y += 2) for (x = 7; x < w - 7; x += 2) {
      i = y * w + x;
      var vrf = ridgeAt(rfield, wxOf(x), wyOf(y));
      if (!grid.water[i] && grid.temperature[i] > 0.42 && grid.moisture[i] < 0.62 &&
          e[i] > seaThresh + 0.13 && vrf > 0.05) volcanoCandidates.push(i);
    }
    volcanoCandidates.sort(function (a, b) { return e[b] - e[a]; });
    var volcanoWant = volcanoCandidates.length ? 1 + (volcanoRnd() * 2 | 0) : 0;
    for (var vv = 0; vv < volcanoWant && vv < volcanoCandidates.length; vv++) {
      var vci = volcanoCandidates[Math.min(volcanoCandidates.length - 1, vv * 4)], vcx = vci % w, vcy = (vci / w) | 0;
      // a real cone: sharp peak, flanks that descend a full level or so per tile
      // and blend into the surrounding terrain — never a flat-topped drum.
      var vRad = 6 + (volcanoRnd() * 5 | 0), craterRad = 1 + (volcanoRnd() * 2 | 0);
      var rimE = e[vci] + 0.16;
      var lvUnit = landSpan / (cfg.levels || 10);   // elevation of one voxel step
      var coneDrop = vRad * lvUnit * 0.9;           // ~1 level per tile of radius
      for (var vry = -vRad; vry <= vRad; vry++) for (var vrx = -vRad; vrx <= vRad; vrx++) {
        var vdist = Math.sqrt(vrx * vrx + vry * vry);
        if (vdist > vRad) continue;
        var vnx0 = vcx + vrx, vny0 = vcy + vry;
        if (vnx0 < 0 || vny0 < 0 || vnx0 >= w || vny0 >= h) continue;
        var vri = vny0 * w + vnx0;
        if (grid.water[vri]) continue;
        var vt = vdist / vRad;                       // 0 centre .. 1 base
        e[vri] = Math.max(e[vri], rimE - Math.pow(vt, 0.8) * coneDrop);
        grid.biome[vri] = B.volcanic;
        if (vdist <= craterRad) {
          // crater floor sits ~1.5 voxel steps below the rim — lava pooled in
          // the summit, not capping it
          e[vri] = Math.min(e[vri], rimE - lvUnit * 1.6);
          grid.water[vri] = 0; grid.lava[vri] = 1; grid.biome[vri] = B.lava;
        }
      }
      var flowCur = vci, flowLen = 6 + (volcanoRnd() * 8 | 0), flowPrev = vci;
      for (var vf = 0; vf < flowLen; vf++) {
        var vfx = flowCur % w, vfy = (flowCur / w) | 0;
        if (!grid.water[flowCur]) { grid.lava[flowCur] = 1; grid.biome[flowCur] = B.lava; }
        // widen the channel one tile to the side, so the flow reads as a stream
        var pdx = vfx - (flowPrev % w), pdy = vfy - ((flowPrev / w) | 0);
        var sideX = vfx - pdy, sideY = vfy + pdx;
        if (sideX >= 0 && sideY >= 0 && sideX < w && sideY < h) {
          var sideI = sideY * w + sideX;
          if (!grid.water[sideI]) { grid.lava[sideI] = 1; grid.biome[sideI] = B.lava; }
        }
        var vfbest = -1, vfbe = e[flowCur];
        for (var vfdy = -1; vfdy <= 1; vfdy++) for (var vfdx = -1; vfdx <= 1; vfdx++) {
          if (!vfdx && !vfdy) continue;
          var vfnx = vfx + vfdx, vfny = vfy + vfdy;
          if (vfnx < 0 || vfny < 0 || vfnx >= w || vfny >= h) continue;
          var vfni = vfny * w + vfnx;
          if (!grid.water[vfni] && e[vfni] < vfbe) { vfbe = e[vfni]; vfbest = vfni; }
        }
        if (vfbest < 0) break;
        flowPrev = flowCur; flowCur = vfbest;
      }
    }

    // --- 7: hydrology (also carves river valleys into `e`) ---
    hydrology(grid, e, seaThresh, cfg, B);

    // --- 7a: volcanic drainage guard — lava remains land even if a river crosses it ---
    for (i = 0; i < n; i++) {
      if (!grid.lava[i]) continue;
      grid.water[i] = 0; grid.biome[i] = B.lava;
      if (grid.flow) grid.flow[i] = 0;
      if (grid.flowStep) grid.flowStep[i] = 0;
    }

    // --- 7b: river mouths — seeded deltas or widening estuaries, never both ---
    shapeRiverMouths(grid, e, seaThresh, cfg, B, ocean);
    for (i = 0; i < n; i++) grid.elevation[i] = e[i];

    // --- 7c: declutter inland water — land shouldn't be speckled with pools.
    // Keep the ocean, river-connected water, and genuinely big endorheic basins;
    // fill everything else back to land. ---
    var BIG_LAKE = 60;
    var seen = new Uint8Array(n);
    for (i = 0; i < n; i++) {
      if (seen[i] || !grid.water[i] || ocean[i] || grid.biome[i] === B.river) continue;
      var body = [], bh = 0, touchesRiver = false;
      seen[i] = 1; body.push(i);
      while (bh < body.length) {
        var bi2 = body[bh++];
        var bx = bi2 % w, by = (bi2 / w) | 0;
        var nb4 = [
          bx > 0 ? bi2 - 1 : -1, bx < w - 1 ? bi2 + 1 : -1,
          by > 0 ? bi2 - w : -1, by < h - 1 ? bi2 + w : -1
        ];
        for (var jj = 0; jj < 4; jj++) {
          var ni3 = nb4[jj];
          if (ni3 < 0) continue;
          if (grid.biome[ni3] === B.river) touchesRiver = true;
          if (grid.water[ni3] && !ocean[ni3] && grid.biome[ni3] !== B.river && !seen[ni3]) {
            seen[ni3] = 1; body.push(ni3);
          }
        }
      }
      // a landlocked body survives only as a real lake — river-fed, or big
      // enough to be a genuine basin. Everything else fills back to land.
      if (!touchesRiver) {
        for (var bk = 0; bk < body.length; bk++) {
          var fi = body[bk];
          grid.water[fi] = 0;
          e[fi] = Math.max(e[fi], seaThresh + 0.012);
          var lfF = clamp01((e[fi] - seaThresh) / landSpan);
          grid.biome[fi] = e[fi] < beachThresh ? B.beach
            : SM.classifyBiome(lfF, grid.moisture[fi], grid.temperature[fi]);
        }
        continue;
      }

      // --- lake overflow: the lake spills over its lowest shore point and
      // runs off downhill as a river. ---
      {
        var outI = -1, outE = 1e9;
        for (var lk = 0; lk < body.length; lk++) {
          var li = body[lk], lx = li % w, ly = (li / w) | 0;
          var lnb = [
            lx > 0 ? li - 1 : -1, lx < w - 1 ? li + 1 : -1,
            ly > 0 ? li - w : -1, ly < h - 1 ? li + w : -1
          ];
          for (var lj = 0; lj < 4; lj++) {
            var lni = lnb[lj];
            if (lni < 0 || grid.water[lni]) continue;
            if (e[lni] < outE) { outE = e[lni]; outI = lni; }
          }
        }
        if (outI >= 0) {
          var oc = outI, ostep = 0;
          while (ostep++ < w + h) {
            if (grid.water[oc]) break;
            grid.water[oc] = 1;
            grid.biome[oc] = B.river;
            var ox2 = oc % w, oy2 = (oc / w) | 0;
            if (ox2 === 0 || oy2 === 0 || ox2 === w - 1 || oy2 === h - 1) break;
            var ob = -1, obE = e[oc];
            for (var ody = -1; ody <= 1; ody++) {
              for (var odx = -1; odx <= 1; odx++) {
                if (!odx && !ody) continue;
                var onx = ox2 + odx, ony = oy2 + ody;
                if (onx < 0 || ony < 0 || onx >= w || ony >= h) continue;
                var oni = ony * w + onx;
                if (e[oni] < obE) { obE = e[oni]; ob = oni; }
              }
            }
            if (ob < 0) break;
            oc = ob;
          }
        }
      }
    }

    // --- 7d: riparian vegetation — reclassify a two-tile land buffer with added moisture ---
    var ripDist = new Int8Array(n), ripQ = [], ripH = 0;
    for (i = 0; i < n; i++) {
      ripDist[i] = -1;
      if (grid.biome[i] === B.river || grid.biome[i] === B.lake) { ripDist[i] = 0; ripQ.push(i); }
    }
    while (ripH < ripQ.length) {
      var rip = ripQ[ripH++], rd = ripDist[rip];
      if (rd >= 2) continue;
      var rix = rip % w, riy = (rip / w) | 0;
      var rnb = [rix > 0 ? rip - 1 : -1, rix < w - 1 ? rip + 1 : -1,
        riy > 0 ? rip - w : -1, riy < h - 1 ? rip + w : -1];
      for (var rj = 0; rj < 4; rj++) {
        var rni = rnb[rj];
        if (rni >= 0 && ripDist[rni] < 0) { ripDist[rni] = rd + 1; ripQ.push(rni); }
      }
    }
    for (i = 0; i < n; i++) {
      if (grid.water[i] || ripDist[i] < 1 || ripDist[i] > 2 || grid.lava[i]) continue;
      if (grid.biome[i] === B.cliff || grid.biome[i] === B.beach) continue;
      grid.moisture[i] = clamp01(grid.moisture[i] + (ripDist[i] === 1 ? 0.22 : 0.11));
      var ripLf = clamp01((e[i] - seaThresh) / landSpan);
      grid.biome[i] = SM.classifyBiome(ripLf, grid.moisture[i], grid.temperature[i]);
    }

    // --- 7e: landmass invariant — clean up fragments left by water-carving ---
    // Rivers, fjords, deltas and crater lakes run after 6d and can shave slivers
    // off a kept island or split a thin isthmus. Re-count and sink only bodies
    // that now fall below the same size bar 6d used — never by a hard count, so
    // this can't re-open the land% cliff.
    var finalSeen = new Uint8Array(n), finalBodies = [];
    for (i = 0; i < n; i++) {
      if (grid.water[i] || finalSeen[i]) continue;
      var finalBody = [i], finalHead = 0; finalSeen[i] = 1;
      while (finalHead < finalBody.length) {
        var fc = finalBody[finalHead++], fcx2 = fc % w, fcy2 = (fc / w) | 0;
        var fnb = [fcx2 > 0 ? fc - 1 : -1, fcx2 < w - 1 ? fc + 1 : -1,
          fcy2 > 0 ? fc - w : -1, fcy2 < h - 1 ? fc + w : -1];
        for (var fn = 0; fn < 4; fn++) {
          var fni2 = fnb[fn];
          if (fni2 >= 0 && !grid.water[fni2] && !finalSeen[fni2]) {
            finalSeen[fni2] = 1; finalBody.push(fni2);
          }
        }
      }
      finalBodies.push(finalBody);
    }
    finalBodies.sort(function (a, b) { return b.length - a.length; });
    for (var fb = 1; fb < finalBodies.length; fb++) {
      if (finalBodies[fb].length >= minKeep) continue;
      for (var fbc = 0; fbc < finalBodies[fb].length; fbc++) {
        var fSink = finalBodies[fb][fbc];
        grid.water[fSink] = 1; grid.lava[fSink] = 0;
        e[fSink] = Math.min(e[fSink], seaThresh - 0.02);
        grid.elevation[fSink] = e[fSink];
        // this pass runs after hydrology, so the shelf classifier won't see it —
        // match the surrounding sea: deep unless a real shore is right next to it.
        var fsx = fSink % w, fsy = (fSink / w) | 0, fDeep = true;
        if ((fsx > 0 && grid.biome[fSink - 1] === B.shallow_water) ||
            (fsx < w - 1 && grid.biome[fSink + 1] === B.shallow_water) ||
            (fsy > 0 && grid.biome[fSink - w] === B.shallow_water) ||
            (fsy < h - 1 && grid.biome[fSink + w] === B.shallow_water)) fDeep = false;
        grid.biome[fSink] = fDeep ? B.deep_water : B.shallow_water;
      }
    }

    // --- 7f: waterfalls — quantized riverbed drops while flow data is fresh ---
    markWaterfalls(grid, e, seaThresh, landSpan, cfg, B);

    // --- 7g: settlements — flat, temperate sites near fresh water or coasts ---
    placeSettlements(grid, e, seaThresh, landSpan, cfg, B);

    // --- 7h: roads — bounded terrain-aware paths over a sparse town graph ---
    buildRoads(grid, e, seaThresh, landSpan, cfg, B);

    // --- 7z: fluid settle — bounded sideways spread and local pooling ---
    settleFluids(grid, e, cfg, B);

    // --- 8: voxelize — signed discrete levels, clamp remaining towers ---
    var wd = cfg.waterDepth;
    var shelf = grid._shelf || 9;
    for (i = 0; i < n; i++) {
      if (grid.water[i]) {
        // flush with the sea plane over the shelf, then sinks past the shelf break
        var df = grid._shoreDist ? grid._shoreDist[i] : shelf + 12;
        grid.level[i] = df <= shelf ? 0 : -Math.min(wd, Math.ceil((df - shelf) / 4));
      } else {
        var lf = clamp01((e[i] - seaThresh) / landSpan);
        var lv = Math.round(Math.pow(lf, 0.82) * cfg.levels) + 1;
        grid.level[i] = lv > 120 ? 120 : lv;
      }
    }
    // no land tile more than one step above its tallest orthogonal neighbour
    var lvTmp = new Int8Array(n);
    for (pass = 0; pass < 5; pass++) {
      for (y = 0; y < h; y++) {
        for (x = 0; x < w; x++) {
          i = y * w + x;
          var cur = grid.level[i];
          if (grid.water[i] || cur <= 1) { lvTmp[i] = cur; continue; }
          var mN = Math.max(
            lvget(grid, x - 1, y), lvget(grid, x + 1, y),
            lvget(grid, x, y - 1), lvget(grid, x, y + 1)
          );
          lvTmp[i] = cur > mN + 1 ? mN + 1 : cur;
        }
      }
      grid.level.set(lvTmp);
    }

    // --- 8a: fantasy labels — final land/water components and voxel heights ---
    makeFantasyLabels(grid, cfg, B);
    delete grid._shoreDist;
    delete grid._shelf;

    grid.config = cfg;
    grid.seaThresh = seaThresh;
    grid.landSpan = landSpan;
    return grid;
  }

  /* Real-world altitude in metres for a cell — sea level is 0, land climbs to
   * roughly +4200 m, ocean floor to about -5500 m. */
  function elevationMeters(grid, i) {
    var e = grid.elevation[i];
    var st = grid.seaThresh != null ? grid.seaThresh : 0.44;
    if (e >= st) return Math.round((e - st) / (1 - st || 1) * 4200);
    return Math.round(-((st - e) / (st || 1)) * 5500);
  }

  function lvget(grid, x, y) {
    if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return -9;
    return grid.level[y * grid.width + x];
  }

  function quantLandLevel(ev, seaThresh, landSpan, levels) {
    var lf = clamp01((ev - seaThresh) / landSpan);
    return Math.round(Math.pow(lf, 0.82) * levels) + 1;
  }

  /* Bounded plus-stencil relaxation for inland water and lava. Fluid surfaces
   * may rise locally to a nearby rim, but terrain is only ever lowered when
   * the result is applied. Ocean, border, cliffs, beaches and towns are fixed. */
  function settleFluids(grid, e, cfg, B) {
    var w = grid.width, h = grid.height, n = w * h;
    var EPS = 0.006, POOL_STEP = 0.004, POOL_CAP = 0.05;
    var WATER_ITERS = 6, LAVA_ITERS = 3;
    var riverScale = Math.max(0, Math.min(2, cfg.rivers || 0));
    var waterScale = 0.4 + riverScale * 0.6;
    var WATER_REACH = Math.max(1, Math.round(10 * waterScale));
    var LAVA_REACH = 7;
    var waterBudget = riverScale > 0 ? Math.round(n * 0.20 * waterScale) : 0;
    var lavaBudget = Math.round(n * 0.02);
    var totalBudget = waterBudget + lavaBudget;
    var spreadCount = 0, waterSpread = 0, lavaSpread = 0, pooled = 0;
    var fluid = new Int8Array(n);       // 0 none, 1 water, 2 lava
    var surf = new Float32Array(n);
    var startSurf = new Float32Array(n);
    var reach = new Int16Array(n);
    var newWater = new Uint8Array(n);
    var i;

    for (i = 0; i < n; i++) reach[i] = -1;
    for (i = 0; i < n; i++) {
      if (grid.lava[i]) {
        fluid[i] = 2; surf[i] = e[i]; startSurf[i] = e[i]; reach[i] = 0;
      } else if (grid.water[i] && (grid.biome[i] === B.river || grid.biome[i] === B.lake)) {
        fluid[i] = 1; surf[i] = e[i]; startSurf[i] = e[i]; reach[i] = 0;
      }
    }

    function fixedCell(ni) {
      var nx = ni % w, ny = (ni / w) | 0;
      return nx === 0 || ny === 0 || nx === w - 1 || ny === h - 1 ||
        (grid.water[ni] && (grid.biome[ni] === B.deep_water || grid.biome[ni] === B.shallow_water)) ||
        grid.biome[ni] === B.beach || grid.biome[ni] === B.cliff ||
        grid.biome[ni] === B.town || (grid.builtup && grid.builtup[ni]);
    }

    // Removing a one-tile neck can turn harmless bank expansion into a spray
    // of tiny islands. Keep the orthogonal land neighbours connected through
    // the surrounding 3x3 ring before allowing water to claim the centre.
    function splitsLocalLand(ci) {
      var ring = [ci - w - 1, ci - w, ci - w + 1, ci + 1,
        ci + w + 1, ci + w, ci + w - 1, ci - 1];
      var land = new Uint8Array(8), needed = 0, first = -1;
      for (var r = 0; r < 8; r++) {
        var ri = ring[r];
        if (!grid.water[ri] && fluid[ri] !== 1) land[r] = 1;
      }
      var orth = [1, 3, 5, 7];
      for (r = 0; r < 4; r++) if (land[orth[r]]) {
        needed++; if (first < 0) first = orth[r];
      }
      if (needed < 2) return false;
      var seenRing = new Uint8Array(8), rq = [first], rh = 0; seenRing[first] = 1;
      while (rh < rq.length) {
        var rp = rq[rh++], prev = (rp + 7) % 8, next = (rp + 1) % 8;
        if (land[prev] && !seenRing[prev]) { seenRing[prev] = 1; rq.push(prev); }
        if (land[next] && !seenRing[next]) { seenRing[next] = 1; rq.push(next); }
      }
      for (r = 0; r < 4; r++) if (land[orth[r]] && !seenRing[orth[r]]) return true;
      return false;
    }

    function settleType(type, maxIters, maxReach, flowDrop, budget) {
      if (budget <= 0 || spreadCount >= totalBudget) return;
      for (var iter = 0; iter < maxIters && spreadCount < totalBudget; iter++) {
        var changed = false;
        var add = [], addSurf = [], addReach = [];
        for (var ci = 0; ci < n && spreadCount + add.length < totalBudget; ci++) {
          if (fluid[ci] !== type) continue;
          var cx = ci % w, cy = (ci / w) | 0;
          if (cx === 0 || cy === 0 || cx === w - 1 || cy === h - 1) continue;
          var S = surf[ci];
          var nb = [ci - 1, ci + 1, ci - w, ci + w];
          var closed = 0, rim = Infinity;
          for (var j = 0; j < 4; j++) {
            var ni = nb[j], gt;
            if (fixedCell(ni) || (fluid[ni] && fluid[ni] !== type)) {
              gt = e[ni];
              closed++;
              if (gt < rim) rim = gt;
              continue;
            }
            gt = fluid[ni] === type ? surf[ni] : e[ni];
            if (gt > S + EPS) {
              closed++;
              if (gt < rim) rim = gt;
              continue;
            }
            if (!fluid[ni] && !grid.water[ni] && !grid.lava[ni] && reach[ci] < maxReach) {
              var ns = Math.max(e[ni], S - flowDrop);
              add.push(ni); addSurf.push(ns); addReach.push(reach[ci] + 1);
            } else if (fluid[ni] === type && reach[ci] + 1 < reach[ni]) {
              reach[ni] = reach[ci] + 1;
            }
          }
          if (closed === 4 && rim < Infinity) {
            var raised = Math.min(S + POOL_STEP, rim, startSurf[ci] + POOL_CAP);
            if (raised > S + 0.000001) {
              surf[ci] = raised; pooled++; changed = true;
            }
          }
        }

        for (var ai = 0; ai < add.length && spreadCount < totalBudget && (type === 1 ? waterSpread : lavaSpread) < budget; ai++) {
          var dst = add[ai];
          if (fluid[dst] || grid.water[dst] || grid.lava[dst] || fixedCell(dst)) continue;
          if (type === 1 && splitsLocalLand(dst)) continue;
          fluid[dst] = type;
          surf[dst] = addSurf[ai]; startSurf[dst] = addSurf[ai]; reach[dst] = addReach[ai];
          spreadCount++;
          if (type === 1) { waterSpread++; newWater[dst] = 1; }
          else lavaSpread++;
          changed = true;
        }
        if (!changed) break;
      }
    }

    // Lava claims contested low ground first; existing water/lava cells always
    // block the other type, so neither fluid overwrites the other.
    settleType(2, LAVA_ITERS, LAVA_REACH, 0.012, lavaBudget);
    if (riverScale > 0) settleType(1, WATER_ITERS, WATER_REACH, 0.02, waterBudget);

    for (i = 0; i < n; i++) {
      if (fluid[i] === 1 && newWater[i]) {
        grid.water[i] = 1; grid.lava[i] = 0; grid.biome[i] = B.river;
        if (grid._shoreDist) grid._shoreDist[i] = 2;
      } else if (fluid[i] === 2 && !grid.lava[i]) {
        grid.water[i] = 0; grid.lava[i] = 1; grid.biome[i] = B.lava;
      }
      if (fluid[i]) {
        e[i] = Math.min(e[i], surf[i]);
        grid.elevation[i] = e[i];
      }
    }

    // Broad contiguous additions read as pools; narrow additions remain rivers.
    var relabelSeen = new Uint8Array(n);
    for (i = 0; i < n; i++) {
      if (!newWater[i] || relabelSeen[i]) continue;
      var body = [i], head = 0; relabelSeen[i] = 1;
      while (head < body.length) {
        var c = body[head++], x = c % w, y = (c / w) | 0;
        var n4 = [x > 0 ? c - 1 : -1, x < w - 1 ? c + 1 : -1,
          y > 0 ? c - w : -1, y < h - 1 ? c + w : -1];
        for (var k = 0; k < 4; k++) {
          var nn = n4[k];
          if (nn >= 0 && newWater[nn] && !relabelSeen[nn]) {
            relabelSeen[nn] = 1; body.push(nn);
          }
        }
      }
      if (body.length >= 8) {
        for (var bi = 0; bi < body.length; bi++) grid.biome[body[bi]] = B.lake;
      }
    }
    grid.fluidSpread = { water: waterSpread, lava: lavaSpread, pooled: pooled };
  }

  function markWaterfalls(grid, e, seaThresh, landSpan, cfg, B) {
    var w = grid.width, h = grid.height, n = w * h;
    var falls = new Uint8Array(n), drops = new Int8Array(n);
    var dx = [0, 1, 1, 0, -1, -1, -1, 0, 1];
    var dy = [0, 0, 1, 1, 1, 0, -1, -1, -1];
    grid.waterfalls = falls;
    grid.waterfallDrop = drops;
    if (!grid.flow) return;

    for (var i = 0; i < n; i++) {
      var dir = grid.flow[i];
      if (!dir || grid.biome[i] !== B.river) continue;
      var x = i % w, y = (i / w) | 0;
      var nx = x + dx[dir], ny = y + dy[dir];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      var ni = ny * w + nx;
      var fromL = quantLandLevel(e[i], seaThresh, landSpan, cfg.levels);
      var toL = (grid.water[ni] && grid.biome[ni] !== B.river)
        ? 0 : quantLandLevel(e[ni], seaThresh, landSpan, cfg.levels);
      var drop = fromL - toL;
      if (drop < 2) continue;
      falls[i] = 1; drops[i] = Math.min(127, drop);
      var plunge = ni;
      for (var p = 0; p < 2; p++) {
        if (plunge < 0 || plunge >= n) break;
        falls[plunge] = 1;
        var px = plunge % w, py = (plunge / w) | 0;
        var pd = grid.flow[plunge] || dir;
        var pnx = px + dx[pd], pny = py + dy[pd];
        if (pnx < 0 || pny < 0 || pnx >= w || pny >= h) break;
        plunge = pny * w + pnx;
      }
    }
  }

  function placeSettlements(grid, e, seaThresh, landSpan, cfg, B) {
    var w = grid.width, h = grid.height, n = w * h, i, x, y;
    var rnd = SM.mulberry32((cfg.seed ^ 0x71e4ac93) >>> 0);
    var fresh = new Int8Array(n), coast = new Int8Array(n);
    var fq = [], cq = [], fh = 0, ch = 0;
    for (i = 0; i < n; i++) {
      fresh[i] = -1; coast[i] = -1;
      if (grid.biome[i] === B.river || grid.biome[i] === B.lake) {
        fresh[i] = 0; fq.push(i);
      }
      if (grid.water[i] && grid.biome[i] !== B.river && grid.biome[i] !== B.lake) {
        coast[i] = 0; cq.push(i);
      }
    }
    function spread(q, head, dist, limit) {
      while (head < q.length) {
        var c = q[head++], d = dist[c];
        if (d >= limit) continue;
        var cx = c % w, cy = (c / w) | 0;
        var nb = [cx > 0 ? c - 1 : -1, cx < w - 1 ? c + 1 : -1,
          cy > 0 ? c - w : -1, cy < h - 1 ? c + w : -1];
        for (var j = 0; j < 4; j++) {
          var ni = nb[j];
          if (ni >= 0 && dist[ni] < 0) { dist[ni] = d + 1; q.push(ni); }
        }
      }
    }
    spread(fq, fh, fresh, 3);
    spread(cq, ch, coast, 2);

    var bad = {};
    bad[B.cliff] = bad[B.beach] = bad[B.marsh] = bad[B.lava] = bad[B.volcanic] = 1;
    bad[B.snow] = bad[B.tundra] = 1;
    var candidates = [], landCells = 0;
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
      i = y * w + x;
      if (grid.water[i]) continue;
      landCells++;
      if (bad[grid.biome[i]]) continue;
      var ql = quantLandLevel(e[i], seaThresh, landSpan, cfg.levels);
      if (ql > 6 || grid.temperature[i] < 0.32 || grid.temperature[i] > 0.72) continue;
      var slope = (Math.abs(e[i] - e[i - 1]) + Math.abs(e[i] - e[i + 1]) +
        Math.abs(e[i] - e[i - w]) + Math.abs(e[i] - e[i + w])) / (landSpan * 0.36);
      var flat = 1 - clamp01(slope);
      if (flat < 0.22) continue;
      var temp = 1 - clamp01(Math.abs(grid.temperature[i] - 0.52) / 0.20);
      var freshBonus = fresh[i] >= 0 ? 1.35 - fresh[i] * 0.20 : 0;
      var coastBonus = coast[i] >= 0 ? 0.52 - coast[i] * 0.12 : 0;
      if (!freshBonus && !coastBonus) continue;
      var low = 1 - clamp01((ql - 1) / 6);
      var score = flat * 1.15 + temp * 0.62 + low * 0.25 + freshBonus + coastBonus + rnd() * 0.018;
      candidates.push({ x: x, y: y, i: i, score: score, flat: flat, fresh: fresh[i] });
    }
    candidates.sort(function (a, b) { return b.score - a.score || a.i - b.i; });
    var want = Math.max(1, Math.min(12, Math.round(Math.sqrt(landCells) / 26)));
    var settlements = [], minD2 = 14 * 14;
    for (var ci = 0; ci < candidates.length && settlements.length < want; ci++) {
      var c = candidates[ci], clear = true;
      for (var si = 0; si < settlements.length; si++) {
        var sx = c.x - settlements[si].x, sy = c.y - settlements[si].y;
        if (sx * sx + sy * sy < minD2) { clear = false; break; }
      }
      if (!clear) continue;
      var size = c.score > 2.72 && c.flat > 0.78 && c.fresh >= 0 && c.fresh <= 2 ? 3
        : (c.score > 2.05 ? 2 : 1);
      settlements.push({ x: c.x, y: c.y, size: size });
    }

    grid.settlements = settlements;
    grid.builtup = new Uint8Array(n);
    for (si = 0; si < settlements.length; si++) {
      var st = settlements[si], centre = e[st.y * w + st.x], rad = st.size;
      for (var oy = -rad; oy <= rad; oy++) for (var ox = -rad; ox <= rad; ox++) {
        var tx = st.x + ox, ty = st.y + oy;
        if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
        var ti = ty * w + tx;
        if (grid.water[ti] || grid.lava[ti] || bad[grid.biome[ti]]) continue;
        if (ox * ox + oy * oy > rad * rad + (rnd() < 0.22 ? -1 : 1)) continue;
        grid.builtup[ti] = 1;
        grid.biome[ti] = B.town;
        e[ti] += (centre - e[ti]) * 0.18;
        grid.elevation[ti] = e[ti];
      }
    }
  }

  function buildRoads(grid, e, seaThresh, landSpan, cfg, B) {
    var w = grid.width, h = grid.height, n = w * h;
    var towns = grid.settlements || [], roads = new Uint8Array(n);
    var rnd = SM.mulberry32((cfg.seed ^ 0x4b1d5a77) >>> 0);
    grid.roads = roads;
    if (towns.length < 2) return;

    var edges = [], edgeSet = {};
    function addEdge(a, b) {
      if (a === b) return false;
      if (a > b) { var t = a; a = b; b = t; }
      var key = a + ':' + b;
      if (edgeSet[key]) return false;
      edgeSet[key] = 1; edges.push([a, b]); return true;
    }
    function townDist(a, b) {
      var dx = towns[a].x - towns[b].x, dy = towns[a].y - towns[b].y;
      return dx * dx + dy * dy;
    }

    // Prim MST first, then a few nearest-neighbour links for useful loops.
    var inTree = new Uint8Array(towns.length); inTree[0] = 1;
    for (var joined = 1; joined < towns.length; joined++) {
      var ba = -1, bb = -1, bd = 1e30;
      for (var a = 0; a < towns.length; a++) if (inTree[a]) {
        for (var b = 0; b < towns.length; b++) if (!inTree[b]) {
          var dd = townDist(a, b);
          if (dd < bd) { bd = dd; ba = a; bb = b; }
        }
      }
      if (bb < 0) break;
      addEdge(ba, bb); inTree[bb] = 1;
    }
    var edgeCap = Math.max(towns.length - 1, Math.ceil(towns.length * 1.5));
    for (a = 0; a < towns.length && edges.length < edgeCap; a++) {
      var near = [];
      for (b = 0; b < towns.length; b++) if (a !== b) near.push({ b: b, d: townDist(a, b) });
      near.sort(function (aa, bb2) { return aa.d - bb2.d || aa.b - bb2.b; });
      for (var nk = 0; nk < Math.min(2, near.length) && edges.length < edgeCap; nk++) addEdge(a, near[nk].b);
    }

    var qlevel = new Int8Array(n);
    for (var qi = 0; qi < n; qi++) qlevel[qi] = quantLandLevel(e[qi], seaThresh, landSpan, cfg.levels);
    function trace(edge) {
      var start = towns[edge[0]].y * w + towns[edge[0]].x;
      var goal = towns[edge[1]].y * w + towns[edge[1]].x;
      var dist = new Float64Array(n), prev = new Int32Array(n), closed = new Uint8Array(n);
      for (var di = 0; di < n; di++) { dist[di] = Infinity; prev[di] = -1; }
      var heapN = [], heapC = [];
      var goalX = goal % w, goalY = (goal / w) | 0;
      function heuristic(node) {
        var hx = node % w, hy = (node / w) | 0;
        return Math.abs(hx - goalX) + Math.abs(hy - goalY);
      }
      function push(node, cost) {
        var k = heapN.length; heapN.push(node); heapC.push(cost);
        while (k > 0) {
          var p = (k - 1) >> 1;
          if (heapC[p] <= cost) break;
          heapN[k] = heapN[p]; heapC[k] = heapC[p]; k = p;
        }
        heapN[k] = node; heapC[k] = cost;
      }
      function pop() {
        var node = heapN[0], cost = heapC[0], lastN = heapN.pop(), lastC = heapC.pop();
        if (heapN.length) {
          var k = 0;
          while (true) {
            var l = k * 2 + 1, r = l + 1;
            if (l >= heapN.length) break;
            var c = r < heapN.length && heapC[r] < heapC[l] ? r : l;
            if (heapC[c] >= lastC) break;
            heapN[k] = heapN[c]; heapC[k] = heapC[c]; k = c;
          }
          heapN[k] = lastN; heapC[k] = lastC;
        }
        return [node, cost];
      }
      dist[start] = 0; push(start, heuristic(start));
      var expanded = 0, found = false;
      while (heapN.length && expanded < 4000) {
        var item = pop(), cur = item[0];
        if (closed[cur]) continue;
        closed[cur] = 1; expanded++;
        if (cur === goal) { found = true; break; }
        var cx = cur % w, cy = (cur / w) | 0;
        var nb = [cx > 0 ? cur - 1 : -1, cx < w - 1 ? cur + 1 : -1,
          cy > 0 ? cur - w : -1, cy < h - 1 ? cur + w : -1];
        for (var j = 0; j < 4; j++) {
          var ni = nb[j]; if (ni < 0 || closed[ni] || grid.lava[ni]) continue;
          var bridge = grid.biome[ni] === B.river || grid.biome[ni] === B.lake;
          if (grid.water[ni] && !bridge) continue;
          var step = 1 + Math.abs(qlevel[cur] - qlevel[ni]) * 4 + (bridge ? 13 : 0) + rnd() * 0.001;
          var nd = dist[cur] + step;
          if (nd < dist[ni]) { dist[ni] = nd; prev[ni] = cur; push(ni, nd + heuristic(ni)); }
        }
      }
      if (!found) return;
      var path = goal, guard = 0;
      while (path >= 0 && guard++ < n) {
        roads[path] = (grid.biome[path] === B.river || grid.biome[path] === B.lake) ? 2 : 1;
        if (path === start) break;
        path = prev[path];
      }
    }
    for (var ei = 0; ei < edges.length; ei++) trace(edges[ei]);
  }

  function makeFantasyLabels(grid, cfg, B) {
    var w = grid.width, h = grid.height, n = w * h;
    var rnd = SM.mulberry32((cfg.seed ^ 0xa5c31f29) >>> 0);
    var candidates = [];
    function components(kind, accept, minArea, sameBiome) {
      var seen = new Uint8Array(n);
      for (var i = 0; i < n; i++) {
        if (seen[i] || !accept(i)) continue;
        var biome = grid.biome[i], q = [i], head = 0, sx = 0, sy = 0;
        seen[i] = 1;
        while (head < q.length) {
          var c = q[head++], x = c % w, y = (c / w) | 0;
          sx += x; sy += y;
          var nb = [x > 0 ? c - 1 : -1, x < w - 1 ? c + 1 : -1,
            y > 0 ? c - w : -1, y < h - 1 ? c + w : -1];
          for (var j = 0; j < 4; j++) {
            var ni = nb[j];
            if (ni >= 0 && !seen[ni] && accept(ni) && (!sameBiome || grid.biome[ni] === biome)) {
              seen[ni] = 1; q.push(ni);
            }
          }
        }
        if (q.length >= minArea) {
          var mx = sx / q.length, my = sy / q.length, anchor = q[0], anchorD = 1e30;
          for (var qk = 0; qk < q.length; qk++) {
            var qx = q[qk] % w, qy = (q[qk] / w) | 0;
            var qad = (qx - mx) * (qx - mx) + (qy - my) * (qy - my);
            if (qad < anchorD) { anchorD = qad; anchor = q[qk]; }
          }
          candidates.push({ x: anchor % w, y: (anchor / w) | 0, kind: kind, area: q.length });
        }
      }
    }
    components('mountain', function (i) { return !grid.water[i] && grid.level[i] >= 7; }, 25, false);
    components('sea', function (i) { return grid.biome[i] === B.deep_water; }, 200, false);
    components('land', function (i) {
      return !grid.water[i] && grid.biome[i] !== B.town;
    }, 400, true);
    candidates.sort(function (a, b) { return b.area - a.area || (a.kind < b.kind ? -1 : (a.kind > b.kind ? 1 : 0)); });

    var starts = ['al', 'bel', 'cor', 'dor', 'el', 'fal', 'gal', 'hal', 'jor', 'kel', 'lor', 'mor', 'nor', 'pel', 'quil', 'ran', 'sel', 'tor', 'val', 'wyr', 'zel'];
    var mids = ['a', 'ae', 'en', 'ia', 'in', 'or', 'os', 'u', 'un', 'yr'];
    var ends = ['dor', 'fell', 'gard', 'ion', 'mere', 'mon', 'ras', 'reth', 'ria', 'tor', 'wyn'];
    var suffix = {
      mountain: [' Range', ' Peaks', ' Heights'],
      sea: [' Sea', ' Reach', ' Expanse'],
      land: [' Vale', ' March', ' Wilds']
    };
    var used = {};
    function nameFor(kind) {
      var text, tries = 0;
      do {
        var syllables = 2 + (rnd() * 3 | 0);
        text = starts[(rnd() * starts.length) | 0];
        for (var s = 2; s < syllables; s++) text += mids[(rnd() * mids.length) | 0];
        text += ends[(rnd() * ends.length) | 0];
        text = text.charAt(0).toUpperCase() + text.slice(1) + suffix[kind][(rnd() * suffix[kind].length) | 0];
      } while (used[text] && tries++ < 8);
      used[text] = 1; return text;
    }
    var labels = [];
    for (var ci = 0; ci < candidates.length && labels.length < 10; ci++) {
      var c = candidates[ci], clear = true;
      for (var li = 0; li < labels.length; li++) {
        var dx = c.x - labels[li].x, dy = c.y - labels[li].y;
        if (dx * dx + dy * dy < 20 * 20) { clear = false; break; }
      }
      if (!clear) continue;
      labels.push({ x: c.x, y: c.y, text: nameFor(c.kind), kind: c.kind,
        size: Math.max(10, Math.min(22, Math.round(8 + Math.sqrt(c.area) * 0.32))) });
    }
    grid.labels = labels;
  }

  function shapeRiverMouths(grid, e, seaThresh, cfg, B, ocean) {
    var w = grid.width, h = grid.height, n = w * h;
    var rnd = SM.mulberry32((cfg.seed ^ 0x94d049bb) >>> 0);
    var mouths = [], i, x, y;
    for (y = 1; y < h - 1; y++) {
      for (x = 1; x < w - 1; x++) {
        i = y * w + x;
        if (grid.biome[i] !== B.river) continue;
        if (ocean[i - 1] || ocean[i + 1] || ocean[i - w] || ocean[i + w]) mouths.push(i);
      }
    }
    mouths.sort(function (a, b) { return a - b; });
    var chosen = [];
    for (var mi = 0; mi < mouths.length; mi++) {
      var mx = mouths[mi] % w, my = (mouths[mi] / w) | 0, separate = true;
      for (var ci = 0; ci < chosen.length; ci++) {
        var cdx = mx - chosen[ci][0], cdy = my - chosen[ci][1];
        if (cdx * cdx + cdy * cdy < 64) { separate = false; break; }
      }
      if (!separate) continue;
      chosen.push([mx, my]);

      // Walk from the mouth toward successively higher river cells. This picks
      // a stable approximation of the trunk even where the channel is wide.
      var chain = [mouths[mi]], used = {};
      used[mouths[mi]] = 1;
      while (chain.length < 10) {
        var cur = chain[chain.length - 1], cx = cur % w, cy = (cur / w) | 0;
        var best = -1, bestScore = -1e9;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          var nnx = cx + dx, nny = cy + dy;
          if (nnx < 0 || nny < 0 || nnx >= w || nny >= h) continue;
          var ni = nny * w + nnx;
          if (used[ni] || grid.biome[ni] !== B.river) continue;
          var score = e[ni] + (grid.flow && grid.flow[ni] ? 0.01 : 0);
          if (score > bestScore) { bestScore = score; best = ni; }
        }
        if (best < 0) break;
        used[best] = 1; chain.push(best);
      }
      if (chain.length < 3) continue;

      if (rnd() < 0.5) {
        // Estuary: a single shallow-water funnel, widest at the ocean.
        var estLen = Math.min(chain.length, 4 + (rnd() * 5 | 0));
        for (var es = 0; es < estLen; es++) {
          var ec = chain[es], ex = ec % w, ey = (ec / w) | 0;
          var er = es < 2 ? 3 : (es < 5 ? 2 : 1);
          for (var eoy = -er; eoy <= er; eoy++) for (var eox = -er; eox <= er; eox++) {
            if (eox * eox + eoy * eoy > er * er) continue;
            var enx = ex + eox, eny = ey + eoy;
            if (enx < 1 || eny < 1 || enx >= w - 1 || eny >= h - 1) continue;
            var ei = eny * w + enx;
            if (grid.lava && grid.lava[ei]) continue;
            grid.water[ei] = 1; grid.biome[ei] = B.shallow_water;
            e[ei] = Math.min(e[ei], seaThresh - 0.004);
            if (grid._shoreDist) grid._shoreDist[ei] = 1;
          }
        }
      } else {
        // Delta: branch from the inland end of the mouth reach, fanning seaward.
        var split = chain[Math.min(chain.length - 1, 6 + (rnd() * 4 | 0))];
        var sx = split % w, sy = (split / w) | 0;
        var bvx = mx - sx, bvy = my - sy, bl = Math.sqrt(bvx * bvx + bvy * bvy) || 1;
        bvx /= bl; bvy /= bl;
        var branchCount = 2 + (rnd() < 0.35 ? 1 : 0);
        for (var br = 0; br < branchCount; br++) {
          var ba = branchCount === 2 ? (br ? 0.52 : -0.52) : (br - 1) * 0.52;
          var bcos = Math.cos(ba), bsin = Math.sin(ba);
          var bdx = bvx * bcos - bvy * bsin, bdy = bvx * bsin + bvy * bcos;
          var bx = sx, by = sy, branchLen = 6 + (rnd() * 5 | 0);
          for (var bs = 0; bs < branchLen; bs++) {
            bx += bdx; by += bdy;
            var bix = Math.round(bx), biy = Math.round(by);
            if (bix < 1 || biy < 1 || bix >= w - 1 || biy >= h - 1) break;
            var bidx = biy * w + bix;
            if (grid.lava && grid.lava[bidx]) break;
            if (ocean[bidx]) { grid.biome[bidx] = B.shallow_water; break; }
            grid.water[bidx] = 1; grid.biome[bidx] = B.river;
            e[bidx] = Math.min(e[bidx], seaThresh + 0.002);
            if (grid._shoreDist) grid._shoreDist[bidx] = 2;
          }
        }
        // Low triangular sediment apron around the mouth.
        for (var ay = -3; ay <= 3; ay++) for (var ax = -3; ax <= 3; ax++) {
          var anx = mx + ax, any = my + ay;
          if (ax * ax + ay * ay > 10 || anx < 0 || any < 0 || anx >= w || any >= h) continue;
          var ai = any * w + anx;
          if (grid.water[ai]) {
            if (grid.biome[ai] !== B.river) grid.biome[ai] = B.shallow_water;
          } else if (grid.biome[ai] !== B.cliff && !(grid.lava && grid.lava[ai])) {
            grid.biome[ai] = rnd() < 0.55 ? B.marsh : B.beach;
          }
        }
      }
    }
  }

  /* Distance-from-shore water depth + downhill rivers. */
  function hydrology(grid, e, seaThresh, cfg, B) {
    var w = grid.width, h = grid.height, n = w * h, i, x, y;

    // multi-source BFS: distance (in tiles) from the nearest coast
    var dist = new Int16Array(n);
    for (i = 0; i < n; i++) dist[i] = grid.water[i] ? 0 : -2; // -2 = land
    var q = [], qh = 0;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x;
        if (!grid.water[i]) continue;
        // seed the BFS only from water that actually touches land — the map
        // border is open ocean, not a shore, so deep water can reach the edge
        // instead of leaving a rectangular shelf outline.
        var coast =
          (x > 0 && !grid.water[i - 1]) || (x < w - 1 && !grid.water[i + 1]) ||
          (y > 0 && !grid.water[i - w]) || (y < h - 1 && !grid.water[i + w]);
        if (coast) { dist[i] = 1; q.push(i); }
      }
    }
    while (qh < q.length) {
      var ci = q[qh++]; var cd = dist[ci];
      var cxx = ci % w, cyy = (ci / w) | 0;
      var nb = [
        cxx > 0 ? ci - 1 : -1, cxx < w - 1 ? ci + 1 : -1,
        cyy > 0 ? ci - w : -1, cyy < h - 1 ? ci + w : -1
      ];
      for (var j = 0; j < 4; j++) {
        var ni = nb[j];
        if (ni < 0) continue;
        if (grid.water[ni] && dist[ni] === 0) { dist[ni] = cd + 1; q.push(ni); }
      }
    }
    // enclosed water never reached by the coast -> treat as deep
    for (i = 0; i < n; i++) if (grid.water[i] && dist[i] === 0) dist[i] = cfg.waterDepth * 4;
    grid._shoreDist = dist;
    // continental shelf: water stays shallow over a broad shelf near land, then
    // drops off past the shelf break into deep ocean. Deep is the exception,
    // not the rule (shelf seas between landmasses read as shallow).
    var SHELF = 9;
    for (i = 0; i < n; i++) {
      if (grid.water[i] && grid.biome[i] !== B.river && grid.biome[i] !== B.lake) {
        grid.biome[i] = dist[i] > SHELF + 5 ? B.deep_water : B.shallow_water;
      }
    }
    grid._shelf = SHELF;

    if (cfg.rivers <= 0) return;

    // river sources: local elevation maxima on land, above a height
    var maxima = [];
    for (y = 2; y < h - 2; y += 2) {
      for (x = 2; x < w - 2; x += 2) {
        i = y * w + x;
        if (grid.water[i]) continue;
        var ev = e[i];
        if (ev - seaThresh < 0.14) continue;
        if (ev >= e[i - 1] && ev >= e[i + 1] && ev >= e[i - w] && ev >= e[i + w] &&
            ev >= e[i - w - 1] && ev >= e[i - w + 1] && ev >= e[i + w - 1] && ev >= e[i + w + 1]) {
          maxima.push({ i: i, e: ev });
        }
      }
    }
    maxima.sort(function (a, b) { return b.e - a.e; });
    var landCells = 0;
    for (i = 0; i < n; i++) if (!grid.water[i]) landCells++;
    var want = Math.round(Math.sqrt(landCells) / 24 * cfg.rivers);
    want = Math.max(1, Math.min(want, maxima.length, 40));

    var river = new Uint8Array(n);
    var flow = new Int8Array(n);       // 1..8 flow direction, 0 = none
    var fstep = new Int16Array(n);     // steps from source (animation phase)
    var accum = new Uint16Array(n);    // upstream source paths through this tile (dendritic)
    for (var s = 0; s < want; s++) {
      var cur = maxima[s].i;
      var steps = 0, maxSteps = w + h;
      while (steps < maxSteps) {
        river[cur] = 1;
        fstep[cur] = steps;
        accum[cur]++;
        var cxx2 = cur % w, cyy2 = (cur / w) | 0;
        if (grid.water[cur] || cxx2 === 0 || cyy2 === 0 || cxx2 === w - 1 || cyy2 === h - 1) break;
        // steepest descent over 8 neighbours — naturally follows any channel it
        // has already merged into, so tributaries build one big trunk
        var best = -1, bestE = e[cur];
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            var nix = cxx2 + dx, niy = cyy2 + dy;
            if (nix < 0 || niy < 0 || nix >= w || niy >= h) continue;
            var ni2 = niy * w + nix;
            if (e[ni2] < bestE) { bestE = e[ni2]; best = ni2; }
          }
        }
        if (best < 0) {
          // the river runs into a closed basin — it pools into a lake
          var pv = e[cur], lq = [cur], lhh = 0;
          while (lhh < lq.length && lq.length < 60) {
            var pi2 = lq[lhh++];
            grid.water[pi2] = 1;
            grid.biome[pi2] = B.lake;
            var px2 = pi2 % w, py2 = (pi2 / w) | 0;
            var pnb = [
              px2 > 0 ? pi2 - 1 : -1, px2 < w - 1 ? pi2 + 1 : -1,
              py2 > 0 ? pi2 - w : -1, py2 < h - 1 ? pi2 + w : -1
            ];
            for (var pj = 0; pj < 4; pj++) {
              var pni = pnb[pj];
              if (pni >= 0 && !grid.water[pni] && e[pni] <= pv + 0.02 && lq.indexOf(pni) < 0) {
                lq.push(pni);
              }
            }
          }
          break;
        }
        var bxx = best % w, byy = (best / w) | 0;
        flow[cur] = DIR[(byy - cyy2 + 1) * 3 + (bxx - cxx2 + 1)];
        cur = best;
        steps++;
      }
    }
    // carve a V-valley — the river and its banks sit in a channel cut into the
    // terrain, so water flows through valleys instead of sitting on the surface.
    for (i = 0; i < n; i++) {
      if (!river[i]) continue;
      var vx = i % w, vy = (i / w) | 0, ve = e[i];
      for (var voy = -2; voy <= 2; voy++) {
        var vny = vy + voy; if (vny < 0 || vny >= h) continue;
        for (var vox = -2; vox <= 2; vox++) {
          var vnx = vx + vox; if (vnx < 0 || vnx >= w) continue;
          var vd = Math.sqrt(vox * vox + voy * voy);
          if (vd > 2.2) continue;
          var vi = vny * w + vnx;
          var tgt = ve + 0.012 + vd * 0.024;
          if (e[vi] > tgt) e[vi] = e[vi] * 0.35 + tgt * 0.65;
        }
      }
    }

    // widen the channel by how much flow it carries — headwaters are a single
    // tile, the trunk near the mouth spreads several tiles wide.
    var wide = new Uint8Array(n);
    for (i = 0; i < n; i++) {
      if (!river[i]) continue;
      var rx = i % w, ry = (i / w) | 0;
      var a = accum[i];
      var span = a >= 6 ? 3 : (a >= 3 ? 2 : (fstep[i] > 30 ? 2 : 1));
      for (var oy = -span; oy <= span; oy++) {
        var wy2 = ry + oy; if (wy2 < 0 || wy2 >= h) continue;
        for (var ox = -span; ox <= span; ox++) {
          var wx2 = rx + ox; if (wx2 < 0 || wx2 >= w) continue;
          if (ox * ox + oy * oy > span * span) continue;
          var wi = wy2 * w + wx2;
          if (!grid.water[wi] && e[wi] <= e[i] + 0.035) wide[wi] = 1;
        }
      }
    }
    grid.flow = new Int8Array(n);
    grid.flowStep = new Int16Array(n);
    for (i = 0; i < n; i++) {
      if ((river[i] || wide[i]) && !grid.water[i]) {
        grid.water[i] = 1;
        grid.biome[i] = B.river;
        grid._shoreDist[i] = 2;
      }
      if (river[i]) { grid.flow[i] = flow[i]; grid.flowStep[i] = fstep[i]; }
    }
  }

  // dir codes indexed by (dy+1)*3 + (dx+1): E=1 SE=2 S=3 SW=4 W=5 NW=6 N=7 NE=8
  var DIR = [6, 7, 8, 5, 0, 1, 4, 3, 2];

  function summarize(grid) {
    var counts = {}, landCount = 0;
    for (var i = 0; i < grid.biome.length; i++) {
      var id = SM.BIOME_LIST[grid.biome[i]].id;
      counts[id] = (counts[id] || 0) + 1;
      if (!grid.water[i]) landCount++;
    }
    return {
      counts: counts,
      total: grid.biome.length,
      landPct: Math.round((landCount / grid.biome.length) * 100)
    };
  }

  SM.generate = generate;
  SM.summarize = summarize;
  SM.elevationMeters = elevationMeters;
  SM.GEN_DEFAULTS = DEFAULTS;
})(window.SM = window.SM || {});
