/* Biome table. Index into BIOME_LIST is what the grid stores. */
(function (SM) {
  'use strict';

  var BIOME_LIST = [
    { id: 'deep_water',    label: 'Deep sea',      color: '#1f6fd0' },
    { id: 'shallow_water', label: 'Shallow sea',   color: '#35c4e8' },
    { id: 'river',         label: 'River',         color: '#5cd0ef' },
    { id: 'lake',          label: 'Lake',          color: '#33b2dd' },
    { id: 'beach',         label: 'Beach',         color: '#ffe0a3' },
    { id: 'cliff',         label: 'Cliff',         color: '#e07a4a' },
    { id: 'marsh',         label: 'Marsh',         color: '#7ba85a' },
    { id: 'grassland',     label: 'Grassland',     color: '#93d95f' },
    { id: 'plains',        label: 'Plains',        color: '#7ecb58' },
    { id: 'shrubland',     label: 'Shrubland',     color: '#cdcb6a' },
    { id: 'forest',        label: 'Forest',        color: '#46994a' },
    { id: 'taiga',         label: 'Taiga',         color: '#3d8271' },
    { id: 'jungle',        label: 'Rainforest',    color: '#37ab4c' },
    { id: 'savanna',       label: 'Savanna',       color: '#e0bd5c' },
    { id: 'desert',        label: 'Desert',        color: '#ffd98a' },
    { id: 'mesa',          label: 'Mesa',          color: '#d9673d' },
    { id: 'tundra',        label: 'Tundra',        color: '#bfcbb6' },
    { id: 'bare',          label: 'Bare',          color: '#b6a98d' },
    { id: 'rock',          label: 'Rock',          color: '#9c94ac' },
    { id: 'snow',          label: 'Snow',          color: '#ffffff' },
    { id: 'lava',          label: 'Lava',          color: '#ff6b2b' },
    { id: 'volcanic',      label: 'Volcanic rock', color: '#382a38' },
    { id: 'town',          label: 'Settlement',    color: '#cf9b76' }
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

  /* A whisper of deterministic per-tile variation keeps broad flat colour
   * blocks alive without turning the toy palette into terrain texture. */
  function biomeShade(grid, i) {
    var x = i % grid.width;
    var y = (i / grid.width) | 0;
    var h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    h = h - Math.floor(h); // 0..1
    return 0.97 + 0.06 * h; // 0.97 .. 1.03
  }

  SM.BIOME_LIST = BIOME_LIST;
  SM.BIOME_IDX = IDX;
  SM.classifyBiome = classify;
  SM.biomeShade = biomeShade;
})(window.SM = window.SM || {});
