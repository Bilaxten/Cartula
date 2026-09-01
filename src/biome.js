/* Biome table. Index into BIOME_LIST is what the grid stores. */
(function (SM) {
  'use strict';

  var BIOME_LIST = [
    { id: 'deep_water',    label: 'Deep sea',      color: '#1b3a5c' },
    { id: 'shallow_water', label: 'Shallow sea',   color: '#2f6690' },
    { id: 'river',         label: 'River',         color: '#3f7fa6' },
    { id: 'lake',          label: 'Lake',          color: '#356b8f' },
    { id: 'beach',         label: 'Beach',         color: '#d9c48f' },
    { id: 'cliff',         label: 'Cliff',         color: '#6d6656' },
    { id: 'marsh',         label: 'Marsh',         color: '#5c6b43' },
    { id: 'grassland',     label: 'Grassland',     color: '#9cbd63' },
    { id: 'plains',        label: 'Plains',        color: '#8fb563' },
    { id: 'shrubland',     label: 'Shrubland',     color: '#a6a862' },
    { id: 'forest',        label: 'Forest',        color: '#4f7f42' },
    { id: 'taiga',         label: 'Taiga',         color: '#3f5f4c' },
    { id: 'jungle',        label: 'Rainforest',    color: '#3a6b31' },
    { id: 'savanna',       label: 'Savanna',       color: '#b7ad5f' },
    { id: 'desert',        label: 'Desert',        color: '#dcbd6f' },
    { id: 'mesa',          label: 'Mesa',          color: '#b06c46' },
    { id: 'tundra',        label: 'Tundra',        color: '#9db3a6' },
    { id: 'bare',          label: 'Bare',          color: '#8a7f6c' },
    { id: 'rock',          label: 'Rock',          color: '#7c7468' },
    { id: 'snow',          label: 'Snow',          color: '#e9edf0' }
  ];

  var IDX = {};
  BIOME_LIST.forEach(function (b, i) { IDX[b.id] = i; });

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* Classify a LAND cell. landFrac is elevation above sea level (0..1 vs the
   * map's peak), moist/temp are 0..1. The snow and tree lines drop toward the
   * poles (cold) and rise toward the equator (warm). Water/beach/cliff are
   * decided by the caller. */
  function classify(landFrac, moist, temp) {
    var snowLine = clamp(0.74 - (0.5 - temp) * 0.5, 0.28, 0.95);
    var treeLine = snowLine - 0.15;

    if (landFrac >= snowLine) return IDX.snow;
    if (landFrac >= treeLine) return temp < 0.32 ? IDX.tundra : IDX.bare;

    // --- below the tree line: climate biomes ---
    if (temp < 0.26) return moist > 0.5 ? IDX.taiga : IDX.tundra;
    if (temp < 0.42 && landFrac > 0.32) return moist > 0.45 ? IDX.taiga : IDX.bare;

    if (temp > 0.72) {
      if (moist < 0.18) return IDX.desert;
      if (moist < 0.35) return landFrac > 0.30 ? IDX.mesa : IDX.shrubland;
      if (moist < 0.55) return IDX.savanna;
      if (moist > 0.82 && landFrac < 0.12) return IDX.marsh;
      return IDX.jungle;
    }

    // temperate
    if (moist < 0.24) return IDX.shrubland;
    if (moist < 0.42) return IDX.grassland;
    if (moist < 0.60) return IDX.plains;
    if (moist > 0.85 && landFrac < 0.10) return IDX.marsh;
    return IDX.forest;
  }

  /* Subtle within-biome shade variation so large biome regions don't read
   * as one flat color — driven by moisture, elevation and a cheap per-tile
   * hash. Returns a multiplier around 1.0. */
  function biomeShade(grid, i) {
    var m = grid.moisture[i];
    var e = grid.elevation[i];
    var x = i % grid.width;
    var y = (i / grid.width) | 0;
    var h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    h = h - Math.floor(h); // 0..1
    return 0.95 + 0.055 * m + 0.03 * (1 - e) + 0.04 * h; // ~0.95 .. 1.08
  }

  SM.BIOME_LIST = BIOME_LIST;
  SM.BIOME_IDX = IDX;
  SM.classifyBiome = classify;
  SM.biomeShade = biomeShade;
})(window.SM = window.SM || {});
