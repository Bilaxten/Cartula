/* Generation pipeline. Each step is independently inspectable:
 *   noise (+ ridged noise) -> combine -> percentile sea level -> moisture/
 *   temperature -> biome -> discrete level */
(function (SM) {
  'use strict';

  var DEFAULTS = {
    width: 160,
    height: 160,
    seed: 1337,
    seaLevel: 0.40,        // TARGET FRACTION of the map that becomes water (percentile-based)
    elevationScale: 2.5,   // noise frequency — smaller = larger landmasses
    octaves: 5,            // fBm detail layers, 2..7
    ruggedness: 0.35,      // 0 = smooth rolling hills, 1 = sharp ridged mountains
    moistureScale: 3.0,
    temperatureBias: 0.0,  // -0.3..0.3, shifts the whole map warmer/colder
    moistureBias: 0.0,     // -0.3..0.3, shifts the whole map wetter/drier
    islandFalloff: 0.0,    // 0 = off, 1 = strong radial falloff toward edges
    levels: 10,            // discrete elevation steps above sea level (voxel view)
    waterDepth: 3          // discrete steps water sinks below the coast (voxel view)
  };

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  function generate(opts) {
    var cfg = Object.assign({}, DEFAULTS, opts || {});
    var w = cfg.width, h = cfg.height, n = w * h;
    var grid = SM.createGrid(w, h);

    var baseNoise = SM.makeNoise2D(cfg.seed);
    var ridgeNoise = SM.makeNoise2D((cfg.seed ^ 0x2545f491) >>> 0);
    var moistNoise = SM.makeNoise2D((cfg.seed ^ 0x9e3779b9) >>> 0);
    var tempNoise = SM.makeNoise2D((cfg.seed ^ 0x85ebca6b) >>> 0);

    var raw = new Float32Array(n);       // smooth fBm, not yet normalized
    var combined = new Float32Array(n);  // raw normalized + ridged mix + island falloff
    var minE = Infinity, maxE = -Infinity;
    var x, y, i, nx, ny;

    // Pass 1: smooth heightmap, track range for normalization.
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        nx = x / w;
        ny = y / h;
        var e = SM.fbm(baseNoise, nx * cfg.elevationScale, ny * cfg.elevationScale, cfg.octaves, 2, 0.5);
        e = (e + 1) / 2;
        i = y * w + x;
        raw[i] = e;
        if (e < minE) minE = e;
        if (e > maxE) maxE = e;
      }
    }

    // Pass 2: normalize, blend in ridged mountains, apply island falloff.
    var span = (maxE - minE) || 1;
    var ridgeMix = cfg.ruggedness * 0.65;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x;
        nx = x / w;
        ny = y / h;

        var base = (raw[i] - minE) / span;
        var ridge = SM.fbmRidged(ridgeNoise, nx * cfg.elevationScale * 1.7, ny * cfg.elevationScale * 1.7, Math.min(cfg.octaves, 5), 2, 0.5);
        var e = base * (1 - ridgeMix) + ridge * ridgeMix;

        if (cfg.islandFalloff > 0) {
          var dx = (nx - 0.5) * 2, dy = (ny - 0.5) * 2;
          var d = Math.sqrt(dx * dx + dy * dy);
          var fall = Math.max(0, 1 - d * d);
          e = e * (1 - cfg.islandFalloff) + e * fall * cfg.islandFalloff;
        }

        combined[i] = e;
      }
    }

    // Sea level is a PERCENTILE threshold, not a raw height: the slider
    // directly controls what fraction of the map is water, independent of
    // how ruggedness/octaves reshaped the elevation curve.
    var sorted = combined.slice().sort();
    var seaThresh = sorted[Math.min(n - 1, Math.max(0, Math.floor(cfg.seaLevel * (n - 1))))];
    var peakElev = sorted[n - 1];
    var deepThresh = seaThresh - 0.05;
    var beachThresh = seaThresh + 0.015;
    var deepSpan = (seaThresh - sorted[0]) || 1;
    var landSpan = (peakElev - seaThresh) || 1;
    var B = SM.BIOME_IDX;

    function elevAt(cx, cy) {
      if (cx < 0) cx = 0; else if (cx >= w) cx = w - 1;
      if (cy < 0) cy = 0; else if (cy >= h) cy = h - 1;
      return combined[cy * w + cx];
    }

    // Pass 3: derive moisture / temperature / water / biome / signed level.
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x;
        nx = x / w;
        ny = y / h;
        var e = combined[i];
        grid.elevation[i] = e;

        var m = SM.fbm(moistNoise, nx * cfg.moistureScale, ny * cfg.moistureScale, 4, 2, 0.5);
        m = clamp01((m + 1) / 2 + cfg.moistureBias);
        grid.moisture[i] = m;

        var isWater = e < seaThresh;
        // Relative elevation above sea, normalized against the map's ACTUAL
        // peak (not a theoretical 1) so the mountain/snow line stays
        // proportioned as ruggedness reshapes the curve.
        var landFrac = isWater ? 0 : clamp01((e - seaThresh) / landSpan);

        // latitude band (warm mid-map, cool poles) + noise wobble so biome
        // boundaries aren't perfectly horizontal, minus altitude cooling.
        var latBand = 1 - Math.abs(ny - 0.5) * 1.7;
        var tn = SM.fbm(tempNoise, nx * 2.2, ny * 2.2, 3, 2, 0.5) * 0.13;
        var t = clamp01(0.12 + 0.82 * latBand + tn - landFrac * 0.5 + cfg.temperatureBias);
        grid.temperature[i] = t;

        // local steepness (used for coastal cliffs and steep rock faces)
        var slope = 0.5 * (
          Math.abs(e - elevAt(x - 1, y)) + Math.abs(e - elevAt(x + 1, y)) +
          Math.abs(e - elevAt(x, y - 1)) + Math.abs(e - elevAt(x, y + 1))
        );

        grid.water[i] = isWater ? 1 : 0;

        if (isWater) {
          grid.biome[i] = e < deepThresh ? B.deep_water : B.shallow_water;
          var depthFrac = clamp01((seaThresh - e) / deepSpan);
          grid.level[i] = -Math.max(1, Math.ceil(depthFrac * cfg.waterDepth));
        } else {
          var b;
          if (e < beachThresh) {
            b = slope > 0.050 ? B.cliff : B.beach;
          } else if (slope > 0.085) {
            b = B.cliff;
          } else {
            b = SM.classifyBiome(landFrac, m, t);
          }
          grid.biome[i] = b;
          var lv = Math.round(Math.pow(landFrac, 0.85) * cfg.levels) + 1;
          grid.level[i] = lv > 120 ? 120 : lv;
        }
      }
    }

    grid.config = cfg;
    grid.seaThresh = seaThresh;
    return grid;
  }

  /* Summary counts for the UI. */
  function summarize(grid) {
    var counts = {};
    var landCount = 0;
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
