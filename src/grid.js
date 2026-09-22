/* The grid is the single source of truth. Both views (top-down, isometric)
 * are projections of this same data — never a second map. */
(function (SM) {
  'use strict';

  function createGrid(width, height) {
    var size = width * height;
    return {
      width: width,
      height: height,
      elevation: new Float32Array(size),   // 0..1 continuous
      moisture: new Float32Array(size),    // 0..1
      temperature: new Float32Array(size), // 0..1
      water: new Uint8Array(size),         // 1 if below sea level
      biome: new Uint8Array(size),         // index into SM.BIOME_LIST
      level: new Int8Array(size),          // signed voxel level: land > 0, water < 0 (depth)
      config: null,
      index: function (x, y) { return y * this.width + x; },
      inBounds: function (x, y) {
        return x >= 0 && y >= 0 && x < this.width && y < this.height;
      }
    };
  }

  // --- river channel planning (pure) ---
  //
  // Lives here rather than in main.js because it is a GRID operation with no DOM
  // in it, and that makes it verifiable under Node (`tools/headless.js --river`).
  // main.js keeps the application half: undo capture, biome/water flags, repaint.

  // Channel half-width in tiles. Brush size drives it, but a river stays a river:
  // 1 tile at the smallest brush, 7 at the largest. The weighted disc used by the
  // other brushes is deliberately NOT used — at brush size 12 it would paint a
  // 25-tile-wide body of water, which is a lake, and `water` already does that.
  //
  // ⚠️ The divisor is `(radius - 1) / 3`, not `radius / 3`. The latter mapped
  // brush sizes 1..4 all to a single tile and then jumped straight to five, so
  // the first third of the slider did nothing and the 3-tile width was
  // unreachable (caught by `--river`, which prints the width curve).
  function riverHalfWidth(radius) {
    return Math.max(0, Math.min(3, Math.floor((radius - 1) / 3)));
  }

  // Bed depth below the surrounding banks, in elevation units. Strength scales it
  // so a light stroke marks a creek and a heavy one cuts a gorge.
  function riverBedDrop(strength) {
    return 0.012 + strength * 0.028;
  }

  // Returns { indices, elevation } for one river brush stamp.
  //
  // The bank reference is the highest land AROUND the channel, not the tile
  // itself. Using the tile would let a repeated stroke walk itself downhill one
  // pass at a time and dig a bottomless trench.
  //
  // The bed is clamped to just above `seaThresh`: a river is fresh water ABOVE
  // sea level. Below the threshold the tile would be reclassified as coast and
  // lose its river identity.
  function planRiverChannel(grid, tx, ty, radius, strength) {
    var half = riverHalfWidth(radius);
    var drop = riverBedDrop(strength);
    var w = grid.width, h = grid.height;
    var minX = Math.max(0, tx - half), maxX = Math.min(w - 1, tx + half);
    var minY = Math.max(0, ty - half), maxY = Math.min(h - 1, ty + half);
    var x, y, i;

    var bank = -Infinity;
    for (y = Math.max(0, ty - half - 1); y <= Math.min(h - 1, ty + half + 1); y++) {
      for (x = Math.max(0, tx - half - 1); x <= Math.min(w - 1, tx + half + 1); x++) {
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) continue;
        i = y * w + x;
        if (grid.elevation[i] > bank) bank = grid.elevation[i];
      }
    }
    if (bank === -Infinity) bank = grid.elevation[ty * w + tx];

    var floor = grid.seaThresh + 0.004;
    var indices = [], elevation = [];
    for (y = minY; y <= maxY; y++) for (x = minX; x <= maxX; x++) {
      i = y * w + x;
      indices.push(i);
      elevation.push(Math.max(floor, Math.min(grid.elevation[i], bank - drop)));
    }
    return { indices: indices, elevation: elevation };
  }

  // --- voxel level + brush re-derivation (pure) ---
  //
  // ONE definition of "land-height → voxel level". The generator, the waterfall
  // pass and the editor all need it; the editor used to carry a private copy,
  // and a second copy is exactly how 09-15 finding 2 happened (two definitions
  // of the level for the same data).
  function quantLandLevel(ev, seaThresh, landSpan, levels) {
    var lf = (ev - seaThresh) / landSpan;
    lf = lf < 0 ? 0 : lf > 1 ? 1 : lf;
    var lv = Math.round(Math.pow(lf, 0.82) * levels) + 1;
    return lv > 120 ? 120 : lv;   // grid.level is an Int8Array
  }

  function isFreshWater(grid, i) {
    var b = grid.biome[i], B = SM.BIOME_IDX;
    return !!grid.water[i] && (b === B.river || b === B.lake);
  }

  // Re-derive water flag, biome and voxel level for one tile after a brush has
  // changed its elevation or set its flags directly.
  //
  // `prevElevation`: the height before this dab, when the brush moved terrain
  // (Raise/Lower/Smooth). Omit it when the tool set water/biome itself -- the
  // flags are then authoritative and only the level is re-derived.
  //
  // Sea <-> land follows the threshold only as a CROSSING in the direction the
  // brush moved: raised above `seaThresh` → land, lowered to/below it → sea.
  // The generator leaves hundreds of land tiles at or below the threshold
  // (beaches, deltas, spill fixes) and a few sea tiles above it (river mouths);
  // re-deriving from the raw threshold turned a light Raise on a beach into sea
  // and a Smooth near a mouth into land.
  //
  // Mirrors the generator's voxelize step (generate.js step 8):
  //   - fresh water (river/lake) sits at its OWN height, like land. It is never
  //     re-derived from `seaThresh`: a river is fresh water ABOVE sea level, so
  //     Raise/Lower/Smooth over it must not dry it out (tarama 2026-09-22 #1).
  //   - sea water keeps its shelf depth (<= 0). The editor has no shore-distance
  //     field, so a tile that just became sea is flush with the sea plane (0) and
  //     an already-deep tile keeps its depth instead of popping up to 0.
  function deriveEditedTile(grid, i, prevElevation) {
    var B = SM.BIOME_IDX;
    if (prevElevation != null && !isFreshWater(grid, i)) {
      var e = grid.elevation[i], wasWater = !!grid.water[i];
      if (wasWater && e > grid.seaThresh && e > prevElevation) grid.water[i] = 0;
      else if (!wasWater && e <= grid.seaThresh && e < prevElevation) grid.water[i] = 1;
      if (!!grid.water[i] !== wasWater) {
        if (grid.water[i]) grid.biome[i] = B.shallow_water;
        else {
          var lf = (grid.elevation[i] - grid.seaThresh) / grid.landSpan;
          lf = lf < 0 ? 0 : lf > 1 ? 1 : lf;
          grid.biome[i] = SM.classifyBiome(lf, grid.moisture[i], grid.temperature[i]);
        }
      }
    }
    var levels = (grid.config && grid.config.levels) || 10;
    if (!grid.water[i] || isFreshWater(grid, i)) {
      grid.level[i] = quantLandLevel(grid.elevation[i], grid.seaThresh, grid.landSpan, levels);
    } else {
      grid.level[i] = Math.min(0, grid.level[i]);
    }
  }

  SM.quantLandLevel = quantLandLevel;
  SM.isFreshWater = isFreshWater;
  SM.deriveEditedTile = deriveEditedTile;
  SM.riverHalfWidth = riverHalfWidth;
  SM.riverBedDrop = riverBedDrop;
  SM.planRiverChannel = planRiverChannel;
  SM.createGrid = createGrid;
})(window.SM = window.SM || {});
