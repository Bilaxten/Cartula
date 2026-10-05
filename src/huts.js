/* Huts: one fixed, hand-designed voxel model, placed a few times per map.
 *
 * Why (owner, 2026-10-05): "biz ev koymuyoruz ki niye parlamalar var? sabit
 * bir hut şeklinde ev yapalım ... minecrafttaki witch hut gibi ... onun
 * penceresi parlasın. voxelleri kullan voxelleri bölme." The night lights
 * used to sit on `town` TILES, where there are no houses. Now there is one
 * small house: a 3x3-tile, 5-level hut on stilts, built from whole map
 * voxels (one tile = one voxel column, one level = one voxel; nothing is
 * subdivided). Only its two window voxels glow at night.
 *
 * The model (rows z = 0 front .. 2 back, columns x = 0..2; P post, F floor,
 * W wall, D door, G window, R roof):
 *
 *   level 0 (stilts)  P . P    level 1 (floor)  F F F    level 2 (walls)  W D W
 *                     . . .                     F F F                     G W G
 *                     P . P                     F F F                     W W W
 *   level 3 (roof)    R R R    level 4 (peak)   . R .
 *                     R R R                     R R R
 *                     R R R                     . R .
 *
 * Level 0 sits on the highest ground of the footprint (`base`); a corner
 * post whose own ground is one level lower gets one more post voxel below.
 * Each hut has a seeded quarter-turn rotation (where the door faces).
 *
 * Placement (pass 8c of src/generate.js, after the final voxel levels):
 *   - the 3x3 footprint is dry land of a habitable biome, no lava, its
 *     ground varies by at most one level, and the 5x5 around it by at
 *     most two (not on a cliff edge);
 *   - spots within NEAR_WATER tiles of fresh water or the sea are strongly
 *     preferred, spots near settlement tiles slightly;
 *   - about one hut per LAND_PER_HUT land tiles, MIN_HUTS..MAX_HUTS, at
 *     least MIN_SPACING tiles apart (fewer only when the map has no room);
 *   - seeded from the map seed: the same seed and settings give the same huts.
 *
 * Everything here is pure (no DOM, no GL): `--huts` in tools/headless.js.
 */
(function (SM) {
  'use strict';

  var SIZE = 3;
  var LEVELS = 5;
  var LAND_PER_HUT = 8000;
  var MIN_HUTS = 3;
  var MAX_HUTS = 12;
  var MIN_SPACING = 24;
  var NEAR_WATER = 6;
  var NEAR_TOWN = 8;
  var HABITABLE = ['grassland', 'plains', 'shrubland', 'forest', 'marsh', 'jungle', 'savanna', 'town'];

  // Layers bottom -> top; each string is the three rows z = 0, 1, 2.
  var MODEL = [
    ['P.P', '...', 'P.P'],
    ['FFF', 'FFF', 'FFF'],
    ['WDW', 'GWG', 'WWW'],
    ['RRR', 'RRR', 'RRR'],
    ['.R.', 'RRR', '.R.']
  ];

  /* Material colours, all from the biome palette (no new colour): posts and
   * door dark wood (mesa, darkened), planks mesa, roof volcanic rock, the
   * window glass by day the deep-sea blue. At night the glass takes the warm
   * window light (voxel3d.js windowLightColor). */
  function materials() {
    function rgb(id, f) {
      var hex = SM.BIOME_LIST.find(function (b) { return b.id === id; }).color;
      var n = parseInt(hex.slice(1), 16);
      return [(n >> 16 & 255) * f, (n >> 8 & 255) * f, (n & 255) * f];
    }
    return {
      P: rgb('mesa', 0.55),
      D: rgb('mesa', 0.55),
      F: rgb('mesa', 0.9),
      W: rgb('mesa', 0.9),
      G: rgb('deep_water', 1),
      R: rgb('volcanic', 1)
    };
  }

  // Footprint offset of model cell (mx, mz) after `rot` quarter turns.
  function rotate(mx, mz, rot) {
    switch (rot & 3) {
      case 1: return [SIZE - 1 - mz, mx];
      case 2: return [SIZE - 1 - mx, SIZE - 1 - mz];
      case 3: return [mz, SIZE - 1 - mx];
      default: return [mx, mz];
    }
  }

  function inBounds(grid, x, y) {
    return x >= 0 && y >= 0 && x < grid.width && y < grid.height;
  }

  /* Can a hut stand with its footprint's corner at (x, y) on this grid as it
   * is now? Returns the base level (highest ground) or -1. Also used after
   * brush edits: a hut whose ground was edited away is simply not drawn. */
  function fits(grid, x, y, habitable) {
    var hi = -Infinity;
    var lo = Infinity;
    var i;
    var dx;
    var dy;

    if (x < 1 || y < 1 || x + SIZE + 1 > grid.width || y + SIZE + 1 > grid.height) return -1;
    for (dy = 0; dy < SIZE; dy++) {
      for (dx = 0; dx < SIZE; dx++) {
        i = (y + dy) * grid.width + x + dx;
        if (grid.water[i] || (grid.lava && grid.lava[i])) return -1;
        if (habitable && !habitable[grid.biome[i]]) return -1;
        if (grid.level[i] > hi) hi = grid.level[i];
        if (grid.level[i] < lo) lo = grid.level[i];
      }
    }
    if (hi - lo > 1 || lo < 0) return -1;
    return hi;
  }

  function habitableSet() {
    var set = {};
    HABITABLE.forEach(function (id) { set[SM.BIOME_IDX[id]] = 1; });
    return set;
  }

  // Grid distance (4-neighbour steps, capped) from every cell to the nearest
  // cell that `isSource` accepts.
  function distanceTo(grid, isSource, cap) {
    var W = grid.width;
    var H = grid.height;
    var dist = new Int16Array(W * H).fill(cap + 1);
    var queue = new Int32Array(W * H);
    var head = 0;
    var tail = 0;
    var i;

    for (i = 0; i < W * H; i++) {
      if (isSource(i)) { dist[i] = 0; queue[tail++] = i; }
    }
    while (head < tail) {
      var c = queue[head++];
      var d = dist[c] + 1;
      if (d > cap) continue;
      var cx = c % W;
      var cy = (c / W) | 0;
      if (cx > 0 && dist[c - 1] > d) { dist[c - 1] = d; queue[tail++] = c - 1; }
      if (cx < W - 1 && dist[c + 1] > d) { dist[c + 1] = d; queue[tail++] = c + 1; }
      if (cy > 0 && dist[c - W] > d) { dist[c - W] = d; queue[tail++] = c - W; }
      if (cy < H - 1 && dist[c + W] > d) { dist[c + W] = d; queue[tail++] = c + W; }
    }
    return dist;
  }

  /* Pass 8c. Writes grid.huts = [{ x, y, rot, base }] (footprint corner,
   * quarter turns, level of the stilt voxels' bottom). */
  function place(grid, seed) {
    var W = grid.width;
    var H = grid.height;
    var rnd = SM.mulberry32(((seed | 0) ^ 0x48a7c3d1) >>> 0);
    var habitable = habitableSet();
    var TOWN = SM.BIOME_IDX.town;
    var land = 0;
    var i;
    var x;
    var y;

    for (i = 0; i < W * H; i++) if (!grid.water[i]) land++;
    var water = distanceTo(grid, function (c) { return !!grid.water[c]; }, NEAR_WATER);
    var town = distanceTo(grid, function (c) { return grid.biome[c] === TOWN && !grid.water[c]; }, NEAR_TOWN);
    var candidates = [];

    for (y = 1; y + SIZE + 1 <= H; y++) {
      for (x = 1; x + SIZE + 1 <= W; x++) {
        var base = fits(grid, x, y, habitable);
        if (base < 0) continue;
        // Not on a cliff edge: the ring around the footprint stays within
        // two levels of the base.
        var ok = true;
        for (var dy = -1; dy <= SIZE && ok; dy++) {
          for (var dx = -1; dx <= SIZE; dx++) {
            var L = grid.level[(y + dy) * W + x + dx];
            if (Math.abs(L - base) > 2) { ok = false; break; }
          }
        }
        if (!ok) continue;
        var c = (y + 1) * W + x + 1;
        var score = (water[c] <= NEAR_WATER ? 1 : 0) + (town[c] <= NEAR_TOWN ? 0.25 : 0) + rnd() * 0.9;
        candidates.push({ x: x, y: y, base: base, score: score, i: c });
      }
    }
    candidates.sort(function (a, b) { return b.score - a.score || a.i - b.i; });
    var want = Math.max(MIN_HUTS, Math.min(MAX_HUTS, Math.round(land / LAND_PER_HUT)));
    var huts = [];
    for (var k = 0; k < candidates.length && huts.length < want; k++) {
      var cand = candidates[k];
      var clear = huts.every(function (h) {
        var ex = h.x - cand.x;
        var ey = h.y - cand.y;
        return ex * ex + ey * ey >= MIN_SPACING * MIN_SPACING;
      });
      if (clear) huts.push({ x: cand.x, y: cand.y, rot: Math.floor(rnd() * 4), base: cand.base });
    }
    grid.huts = huts;
    return huts;
  }

  /* The voxels of one hut on this grid: [{ x, y, level, m }] in grid cells
   * (m = material letter), or [] if the hut no longer fits (a brush edit). */
  function voxels(grid, hut) {
    var out = [];
    var base;
    var l;
    var mz;
    var mx;

    if (fits(grid, hut.x, hut.y, null) !== hut.base) return out;
    base = hut.base;
    for (l = 0; l < LEVELS; l++) {
      for (mz = 0; mz < SIZE; mz++) {
        for (mx = 0; mx < SIZE; mx++) {
          var m = MODEL[l][mz].charAt(mx);
          if (m === '.') continue;
          var o = rotate(mx, mz, hut.rot);
          out.push({ x: hut.x + o[0], y: hut.y + o[1], level: base + l, m: m });
          if (l === 0) {
            // A post stands on its own ground, one level lower at most.
            var g = grid.level[(hut.y + o[1]) * grid.width + hut.x + o[0]];
            for (var f = g; f < base; f++) out.push({ x: hut.x + o[0], y: hut.y + o[1], level: f, m: m });
          }
        }
      }
    }
    return out;
  }

  /* The hut whose footprint covers cell (x, y), or null (top-down view). */
  function at(grid, x, y) {
    var list = grid.huts || [];
    for (var k = 0; k < list.length; k++) {
      var h = list[k];
      if (x >= h.x && y >= h.y && x < h.x + SIZE && y < h.y + SIZE &&
          fits(grid, h.x, h.y, null) === h.base) return h;
    }
    return null;
  }

  SM.Huts = {
    place: place,
    voxels: voxels,
    fits: fits,
    at: at,
    materials: materials,
    rotate: rotate,
    MODEL: MODEL,
    SIZE: SIZE,
    LEVELS: LEVELS,
    HABITABLE: HABITABLE,
    LAND_PER_HUT: LAND_PER_HUT,
    MIN_HUTS: MIN_HUTS,
    MAX_HUTS: MAX_HUTS,
    MIN_SPACING: MIN_SPACING,
    NEAR_WATER: NEAR_WATER
  };
})(window.SM = window.SM || {});
