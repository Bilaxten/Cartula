/* Biome table. Index into BIOME_LIST is what the grid stores. */
(function (SM) {
  'use strict';

  var BIOME_LIST = [
    { id: 'deep_water',    label: 'Derin deniz',   color: '#1b3a5c' },
    { id: 'shallow_water', label: 'Sığ deniz',     color: '#2f6690' },
    { id: 'river',         label: 'Nehir',         color: '#3f7fa6' },
    { id: 'lake',          label: 'Göl',           color: '#356b8f' },
    { id: 'beach',         label: 'Kumsal',        color: '#d9c48f' },
    { id: 'cliff',         label: 'Yalıyar',       color: '#6d6656' },
    { id: 'marsh',         label: 'Bataklık',      color: '#5c6b43' },
    { id: 'grassland',     label: 'Çayır',         color: '#9cbd63' },
    { id: 'plains',        label: 'Ova',           color: '#8fb563' },
    { id: 'shrubland',     label: 'Çalılık',       color: '#a6a862' },
    { id: 'forest',        label: 'Orman',         color: '#4f7f42' },
    { id: 'taiga',         label: 'Tayga',         color: '#3f5f4c' },
    { id: 'jungle',        label: 'Yağmur ormanı', color: '#3a6b31' },
    { id: 'savanna',       label: 'Savan',         color: '#b7ad5f' },
    { id: 'desert',        label: 'Çöl',           color: '#dcbd6f' },
    { id: 'mesa',          label: 'Kızıl kaya',    color: '#b06c46' },
    { id: 'tundra',        label: 'Tundra',        color: '#9db3a6' },
    { id: 'bare',          label: 'Çıplak',        color: '#8a7f6c' },
    { id: 'rock',          label: 'Kaya',          color: '#7c7468' },
    { id: 'snow',          label: 'Kar',           color: '#e9edf0' }
  ];

  var IDX = {};
  BIOME_LIST.forEach(function (b, i) { IDX[b.id] = i; });

  /* Classify a LAND cell. landFrac is elevation above sea level, normalized
   * 0..1 against the map's own peak. moist/temp are each 0..1. Water/beach/
   * cliff are decided by the caller before this runs. */
  function classify(landFrac, moist, temp) {
    // --- high mountains ---
    if (landFrac > 0.82) return temp < 0.55 ? IDX.snow : IDX.rock;
    if (landFrac > 0.64) {
      if (temp < 0.34) return IDX.snow;
      return temp < 0.62 ? IDX.rock : IDX.bare;
    }
    // --- subalpine band ---
    if (landFrac > 0.48 && temp < 0.42) {
      return moist > 0.45 ? IDX.taiga : IDX.bare;
    }

    // --- cold lowlands ---
    if (temp < 0.28) return moist > 0.5 ? IDX.taiga : IDX.tundra;

    // --- hot ---
    if (temp > 0.7) {
      if (moist < 0.20) return IDX.desert;
      if (moist < 0.38) return landFrac > 0.32 ? IDX.mesa : IDX.shrubland;
      if (moist < 0.58) return IDX.savanna;
      if (moist > 0.82 && landFrac < 0.14) return IDX.marsh;
      return IDX.jungle;
    }

    // --- temperate ---
    if (moist < 0.26) return IDX.shrubland;
    if (moist < 0.44) return IDX.grassland;
    if (moist < 0.62) return IDX.plains;
    if (moist > 0.84 && landFrac < 0.12) return IDX.marsh;
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
