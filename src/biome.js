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
    { id: 'snow',          label: 'Snow',          color: '#e9edf0' },
    { id: 'lava',          label: 'Lava',          color: '#e2521d' },
    { id: 'volcanic',      label: 'Volcanic rock', color: '#3a2b28' },
    { id: 'town',          label: 'Settlement',    color: '#8a7d6b' }
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

  // --- sea colour: depth is shown by COLOUR, not geometry (2026-09-22) ---
  //
  // The sea is a flat surface at voxel level 0; how deep it is lives in the
  // continuous elevation below `seaThresh` and is drawn as progressively
  // darker water. Uğur's call: a stepped-down basin read as holes in the map,
  // a darkening ramp reads as depth. Every view (top-down bake, voxel mesh,
  // the editor's live repaint) calls THIS, so they cannot drift apart --
  // the shoreline tint used to be copied three times and the editor's copy
  // had already lost it.
  //
  // SEA_DEPTH_REF is absolute, not a per-map percentile: the same depth gets
  // the same tone on every seed and size (P2), and a low sea level really
  // does leave pale, shallow seas. 0.32 ≈ p95 of depth on the default map.
  var SEA_DEPTH_REF = 0.32;
  var SEA_BANDS = 6;
  var SEA_RAMP = [[58, 124, 168], [34, 82, 126], [14, 36, 62]]; // shallow → mid → abyss

  function isSea(grid, i) {
    if (!grid.water[i]) return false;
    var b = grid.biome[i];
    return b !== IDX.river && b !== IDX.lake;
  }

  // 0 (at the surface) .. 1 (abyss), quantised into SEA_BANDS flat bands so
  // the voxel view gets clean contour-like steps instead of per-tile noise.
  function seaDepthT(grid, i) {
    var st = grid.seaThresh != null ? grid.seaThresh : 0.44;
    var t = (st - grid.elevation[i]) / SEA_DEPTH_REF;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.min(SEA_BANDS - 1, Math.floor(t * SEA_BANDS)) / (SEA_BANDS - 1);
  }

  // How much a sea tile touches land (0..0.55): drives the pale shoreline tint
  // and, in the voxel view, the surf foam.
  function seaShoreWeight(grid, i) {
    var w = grid.width, h = grid.height, x = i % w, y = (i / w) | 0;
    var n = 0, d = 0;
    if (x > 0 && !grid.water[i - 1]) n++;
    if (x < w - 1 && !grid.water[i + 1]) n++;
    if (y > 0 && !grid.water[i - w]) n++;
    if (y < h - 1 && !grid.water[i + w]) n++;
    if (x > 0 && y > 0 && !grid.water[i - w - 1]) d++;
    if (x < w - 1 && y > 0 && !grid.water[i - w + 1]) d++;
    if (x > 0 && y < h - 1 && !grid.water[i + w - 1]) d++;
    if (x < w - 1 && y < h - 1 && !grid.water[i + w + 1]) d++;
    return Math.min(1, n * 0.5 + d * 0.125) * 0.55;
  }

  // Unshaded sea colour for tile i: depth ramp, then the shoreline tint.
  function seaColor(grid, i) {
    var t = seaDepthT(grid, i) * (SEA_RAMP.length - 1);
    var k = Math.min(SEA_RAMP.length - 2, Math.floor(t)), f = t - k;
    var a = SEA_RAMP[k], b = SEA_RAMP[k + 1];
    var c = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    var wt = seaShoreWeight(grid, i);
    if (wt > 0) {
      c[0] += (122 - c[0]) * wt; c[1] += (196 - c[1]) * wt; c[2] += (201 - c[2]) * wt;
    }
    return c;
  }

  SM.SEA_DEPTH_REF = SEA_DEPTH_REF;
  SM.isSea = isSea;
  SM.seaDepthT = seaDepthT;
  SM.seaShoreWeight = seaShoreWeight;
  SM.seaColor = seaColor;
  SM.BIOME_LIST = BIOME_LIST;
  SM.BIOME_IDX = IDX;
  SM.classifyBiome = classify;
  SM.biomeShade = biomeShade;
})(window.SM = window.SM || {});
