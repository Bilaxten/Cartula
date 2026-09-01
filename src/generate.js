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

  var DEFAULTS = {
    width: 160,
    height: 160,
    seed: 1337,
    seaLevel: 0.42,        // ~fraction of the reference area that is water
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
  function heightAt(baseN, ridgeN, warpN, wx, wy, cfg) {
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
    var mix = cfg.ruggedness * 0.55;
    var e = base * (1 - mix) + ridge * mix;

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

    // --- 1+2: sample world-space height into the grid ---
    var e = new Float32Array(n);
    var x, y, i;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        e[y * w + x] = heightAt(baseN, ridgeN, warpN, wxOf(x), wyOf(y), cfg);
      }
    }

    // --- 3: repair — clamp single-tile spikes/pits, then a gentle smooth ---
    // SPIKE is kept below one discrete level so no tile can tower over its
    // neighbourhood after voxelization.
    var SPIKE = 0.028;
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
    // gentle smoothing toward the 3x3 average (keeps ridgelines, softens noise)
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x;
        var avg = (
          at(e, x - 1, y - 1) + at(e, x, y - 1) + at(e, x + 1, y - 1) +
          at(e, x - 1, y) + e[i] + at(e, x + 1, y) +
          at(e, x - 1, y + 1) + at(e, x, y + 1) + at(e, x + 1, y + 1)
        ) / 9;
        tmp[i] = e[i] * 0.72 + avg * 0.28;
      }
    }
    e.set(tmp);
    for (i = 0; i < n; i++) grid.elevation[i] = e[i];

    // --- 4: sea level — absolute threshold from a fixed reference sample.
    // The reference is sampled WITHOUT island falloff so the threshold reflects
    // the natural land/water split; falloff then sinks the map's edges cleanly. ---
    var refCfg = Object.assign({}, cfg, { islandFalloff: 0 });
    var RS = 96, ref = new Float32Array(RS * RS), k = 0;
    for (y = 0; y < RS; y++) {
      for (x = 0; x < RS; x++) {
        var rwx = (x - RS / 2) / (RS / (2 * 0.9));
        var rwy = (y - RS / 2) / (RS / (2 * 0.9));
        ref[k++] = heightAt(baseN, ridgeN, warpN, rwx, rwy, refCfg);
      }
    }
    ref.sort();
    var seaThresh = ref[Math.min(ref.length - 1, Math.floor(cfg.seaLevel * (ref.length - 1)))];
    var refPeak = ref[ref.length - 1];
    var deepThresh = seaThresh - 0.05;
    var beachThresh = seaThresh + 0.02;

    var mapMax = 0;
    for (i = 0; i < n; i++) if (e[i] > mapMax) mapMax = e[i];
    var landSpan = Math.max(0.32, Math.max(mapMax, refPeak) - seaThresh);

    // --- 5+6: climate + biome ---
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x;
        var ev = e[i];
        var nx = x / w, ny = y / h;

        var mo = SM.fbm(moistN, wxOf(x) * cfg.moistureScale, wyOf(y) * cfg.moistureScale, 4, 2, 0.5);
        mo = clamp01((mo + 1) / 2 + cfg.moistureBias);
        grid.moisture[i] = mo;

        var isWater = ev < seaThresh;
        var landFrac = isWater ? 0 : clamp01((ev - seaThresh) / landSpan);

        var latBand = 1 - Math.abs(ny - 0.5) * 1.7;
        var tn = SM.fbm(tempN, wxOf(x) * 2.2, wyOf(y) * 2.2, 3, 2, 0.5) * 0.13;
        var t = clamp01(0.12 + 0.82 * latBand + tn - landFrac * 0.5 + cfg.temperatureBias);
        grid.temperature[i] = t;

        var slope = 0.5 * (
          Math.abs(ev - at(e, x - 1, y)) + Math.abs(ev - at(e, x + 1, y)) +
          Math.abs(ev - at(e, x, y - 1)) + Math.abs(ev - at(e, x, y + 1))
        );

        grid.water[i] = isWater ? 1 : 0;
        if (isWater) {
          grid.biome[i] = ev < deepThresh ? B.deep_water : B.shallow_water;
        } else if (ev < beachThresh) {
          grid.biome[i] = slope > 0.05 ? B.cliff : B.beach;
        } else if (slope > 0.085) {
          grid.biome[i] = B.cliff;
        } else {
          grid.biome[i] = SM.classifyBiome(landFrac, mo, t);
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
        if (!grid.water[i] && lc <= 1 && e[i] < seaThresh + 0.03) {
          wbuf[i] = 1;
        } else if (grid.water[i] && wc === 0 && e[i] > seaThresh - 0.03) {
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

    // --- 7: hydrology ---
    hydrology(grid, e, seaThresh, cfg, B);

    // --- 8: voxelize — signed discrete levels, clamp remaining towers ---
    var wd = cfg.waterDepth;
    for (i = 0; i < n; i++) {
      if (grid.water[i]) {
        // water surface sits at the sea plane (0) right at the coast and sinks
        // outward — so a coastal land tile (level 1) is just one step up.
        var df = grid._shoreDist ? grid._shoreDist[i] : 8;
        grid.level[i] = -Math.max(0, Math.min(wd, Math.ceil((df - 2) / 4)));
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

    grid.config = cfg;
    grid.seaThresh = seaThresh;
    return grid;
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
    // re-tag deep vs shallow from smoothed distance so the seabed isn't jagged
    for (i = 0; i < n; i++) {
      if (grid.water[i] && grid.biome[i] !== B.river && grid.biome[i] !== B.lake) {
        grid.biome[i] = dist[i] >= 6 ? B.deep_water : B.shallow_water;
      }
    }

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
    for (var s = 0; s < want; s++) {
      var cur = maxima[s].i;
      var steps = 0, maxSteps = w + h;
      while (steps++ < maxSteps) {
        river[cur] = 1;
        var cxx2 = cur % w, cyy2 = (cur / w) | 0;
        if (grid.water[cur] || cxx2 === 0 || cyy2 === 0 || cxx2 === w - 1 || cyy2 === h - 1) break;
        // steepest descent over 8 neighbours
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
        if (best < 0) break;                 // local pit — stop (a small lake)
        if (river[best] && grid.biome[best] === B.river) break; // merged into another river
        cur = best;
      }
    }
    for (i = 0; i < n; i++) {
      if (river[i] && !grid.water[i]) {
        grid.water[i] = 1;
        grid.biome[i] = B.river;
        grid._shoreDist[i] = 2;
      }
    }
  }

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
  SM.GEN_DEFAULTS = DEFAULTS;
})(window.SM = window.SM || {});
