/* Generation pipeline. Each step is independently inspectable:
 *   noise (+ ridged noise) -> combine -> percentile sea level -> moisture/
 *   temperature -> biome -> discrete level */
(function (SM) {
  'use strict';

  var DEFAULTS = {
    width: 96,
    height: 96,
    seed: 1337,
    seaLevel: 0.40,        // TARGET FRACTION of the map that becomes water (percentile-based)
    elevationScale: 2.5,   // noise frequency — smaller = larger landmasses
    octaves: 5,            // fBm detail layers, 2..7
    ruggedness: 0.35,      // 0 = smooth rolling hills, 1 = sharp ridged mountains
    moistureScale: 3.0,
    temperatureBias: 0.0,  // -0.3..0.3, shifts the whole map warmer/colder
    moistureBias: 0.0,     // -0.3..0.3, shifts the whole map wetter/drier
    islandFalloff: 0.0,    // 0 = off, 1 = strong radial falloff toward edges
    levels: 8               // discrete elevation steps above sea level, for the voxel view
  };

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  function generate(opts) {
    var cfg = Object.assign({}, DEFAULTS, opts || {});
    var w = cfg.width, h = cfg.height, n = w * h;
    var grid = SM.createGrid(w, h);

    var baseNoise = SM.makeNoise2D(cfg.seed);
    var ridgeNoise = SM.makeNoise2D((cfg.seed ^ 0x2545f491) >>> 0);
    var moistNoise = SM.makeNoise2D((cfg.seed ^ 0x9e3779b9) >>> 0);

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

    // Pass 3: derive moisture / temperature / water / biome / discrete level.
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
        // Normalized against the map's ACTUAL peak (not a theoretical 1) —
        // blending in ridged noise pulls the achievable max below 1, and
        // without this the mountain/snow line would quietly recede as
        // ruggedness increases instead of becoming more visible.
        var landFrac = isWater ? 0 : clamp01((e - seaThresh) / ((peakElev - seaThresh) || 1));

        // Temperature: warm band across the map's middle latitude, cooled
        // proportionally by relative elevation (so it scales with any sea level).
        var lat = 1 - Math.abs(ny - 0.5) * 2;
        var t = clamp01(lat - landFrac * 0.6 + cfg.temperatureBias);
        grid.temperature[i] = t;

        grid.water[i] = isWater ? 1 : 0;
        if (e < deepThresh) grid.biome[i] = SM.BIOME_IDX.deep_water;
        else if (isWater) grid.biome[i] = SM.BIOME_IDX.shallow_water;
        else if (e < beachThresh) grid.biome[i] = SM.BIOME_IDX.beach;
        else grid.biome[i] = SM.classifyBiome(landFrac, m, t);

        grid.level[i] = isWater ? 0 : Math.min(cfg.levels - 1, Math.floor(landFrac * cfg.levels));
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
