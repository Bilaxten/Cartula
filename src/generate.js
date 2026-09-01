/* Generation pipeline. Each step is independently inspectable:
 *   noise -> heightmap -> sea level -> moisture/temperature -> biome -> level */
(function (SM) {
  'use strict';

  var DEFAULTS = {
    width: 96,
    height: 96,
    seed: 1337,
    seaLevel: 0.40,
    elevationScale: 2.5,  // noise frequency for the heightmap
    mountainy: 1.0,       // exponent on normalized elevation (>1 = flatter lowlands, sharper peaks)
    moistureScale: 3.0,
    islandFalloff: 0.0,   // 0 = off, 1 = strong radial falloff toward edges
    levels: 8             // discrete elevation steps above sea level
  };

  function generate(opts) {
    var cfg = Object.assign({}, DEFAULTS, opts || {});
    var w = cfg.width, h = cfg.height;
    var grid = SM.createGrid(w, h);

    var elevNoise = SM.makeNoise2D(cfg.seed);
    var moistNoise = SM.makeNoise2D((cfg.seed ^ 0x9e3779b9) >>> 0);

    var raw = new Float32Array(w * h);
    var minE = Infinity, maxE = -Infinity;
    var x, y, i, nx, ny, e;

    // Pass 1: raw heightmap + optional island falloff, track range for normalization.
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        nx = x / w;
        ny = y / h;
        e = SM.fbm(elevNoise, nx * cfg.elevationScale, ny * cfg.elevationScale, 5, 2, 0.5);
        e = (e + 1) / 2;

        if (cfg.islandFalloff > 0) {
          var dx = (nx - 0.5) * 2;
          var dy = (ny - 0.5) * 2;
          var d = Math.sqrt(dx * dx + dy * dy);
          var fall = Math.max(0, 1 - d * d);
          e = e * (1 - cfg.islandFalloff) + e * fall * cfg.islandFalloff;
        }

        i = y * w + x;
        raw[i] = e;
        if (e < minE) minE = e;
        if (e > maxE) maxE = e;
      }
    }

    // Pass 2: normalize, shape, derive moisture / temperature / biome / level.
    var span = (maxE - minE) || 1;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x;
        nx = x / w;
        ny = y / h;

        e = (raw[i] - minE) / span;
        e = Math.pow(e, cfg.mountainy);
        grid.elevation[i] = e;

        var m = SM.fbm(moistNoise, nx * cfg.moistureScale, ny * cfg.moistureScale, 4, 2, 0.5);
        m = (m + 1) / 2;
        m = m < 0 ? 0 : (m > 1 ? 1 : m);
        grid.moisture[i] = m;

        // Temperature: warm band across the map's middle latitude, cooled by altitude.
        var lat = 1 - Math.abs(ny - 0.5) * 2;
        var t = lat - Math.max(0, e - cfg.seaLevel) * 0.7;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        grid.temperature[i] = t;

        var water = e < cfg.seaLevel ? 1 : 0;
        grid.water[i] = water;
        grid.biome[i] = SM.classifyBiome(e, m, t, cfg.seaLevel);

        var above = (e - cfg.seaLevel) / (1 - cfg.seaLevel);
        if (above < 0) above = 0;
        grid.level[i] = water ? 0 : Math.min(cfg.levels - 1, Math.floor(above * cfg.levels));
      }
    }

    grid.config = cfg;
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
