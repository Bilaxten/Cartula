/* Generation pipeline — a sequence of named passes rather than raw noise.
 *
 *   1. sample     world-space fBm + domain warp -> raw height
 *   2. shape      blend ridged mountains, radial island falloff
 *   3. repair     kill single-tile spikes / pits, light smoothing
 *   4. sea level  absolute threshold from a fixed reference (map size independent)
 *   5. climate    moisture + temperature (latitude band + noise + altitude)
 *   6. classify   biome per cell, slope-aware coasts
 *   7. hydrology  distance-from-shore water depth, downhill rivers
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

    // --- 5c + 6: temperature + biome classification ---
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x;
        var ev = e[i];
        var ny = y / h;
        var isWater = grid.water[i];
        var landFrac = isWater ? 0 : clamp01((ev - seaThresh) / landSpan);

        var latBand = 1 - Math.abs(ny - 0.5) * 1.7;
        var tn = SM.fbm(tempN, wxOf(x) * 2.2, wyOf(y) * 2.2, 3, 2, 0.5) * 0.13;
        var t = clamp01(0.16 + 0.78 * latBand + tn - landFrac * 0.30 + cfg.temperatureBias);
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

    // --- 7: hydrology (also carves river valleys into `e`) ---
    hydrology(grid, e, seaThresh, cfg, B);
    for (i = 0; i < n; i++) grid.elevation[i] = e[i];

    // --- 7b: declutter inland water — land shouldn't be speckled with pools.
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
        var coast =
          x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
          !grid.water[i - 1] || !grid.water[i + 1] ||
          !grid.water[i - w] || !grid.water[i + w];
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
