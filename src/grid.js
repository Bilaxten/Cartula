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

  SM.riverHalfWidth = riverHalfWidth;
  SM.riverBedDrop = riverBedDrop;
  SM.planRiverChannel = planRiverChannel;
  SM.createGrid = createGrid;
})(window.SM = window.SM || {});
