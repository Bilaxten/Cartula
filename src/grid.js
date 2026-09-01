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
      level: new Uint8Array(size),         // discrete elevation step (voxel view)
      config: null,
      index: function (x, y) { return y * this.width + x; },
      inBounds: function (x, y) {
        return x >= 0 && y >= 0 && x < this.width && y < this.height;
      }
    };
  }

  SM.createGrid = createGrid;
})(window.SM = window.SM || {});
