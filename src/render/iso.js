/* Isometric voxel renderer. Each tile is a prism column (top diamond + two
 * visible side faces), drawn back-to-front (painter's algorithm). The whole
 * terrain is baked once to an offscreen canvas; the display just blits that
 * baked image with a pan/zoom transform, so panning stays cheap. */
(function (SM) {
  'use strict';

  var BIOME_RGB = null;

  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function shade(rgb, f) {
    return 'rgb(' +
      Math.round(rgb[0] * f) + ',' +
      Math.round(rgb[1] * f) + ',' +
      Math.round(rgb[2] * f) + ')';
  }

  function biomeRgb() {
    if (!BIOME_RGB) {
      BIOME_RGB = SM.BIOME_LIST.map(function (b) { return hexToRgb(b.color); });
    }
    return BIOME_RGB;
  }

  /* Bake the full isometric terrain to an offscreen canvas.
   * Returns { canvas, width, height }. */
  function bakeIso(grid, opts) {
    var o = Object.assign({ tile: 64, levelHeight: 12 }, opts || {});
    var TW = o.tile, TH = TW / 2, LH = o.levelHeight;
    var TW2 = TW / 2, TH2 = TH / 2;
    var W = grid.width, H = grid.height;
    var levels = (grid.config && grid.config.levels) || 8;
    var maxLevel = levels + 1; // land sits one step above water

    // x - y ranges [-(H-1), W-1]; shift so the leftmost tile clears the edge.
    var originX = (H - 1) * TW2 + TW2 + 2;
    var originY = TH2 + maxLevel * LH + 2;

    var cnv = document.createElement('canvas');
    cnv.width = Math.ceil((W + H) * TW2 + TW + 4);
    cnv.height = Math.ceil((W + H) * TH2 + maxLevel * LH + TH * 2 + 4);
    var ctx = cnv.getContext('2d');

    var rgb = biomeRgb();

    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var i = y * W + x;
        var water = grid.water[i];
        var level = water ? 0 : grid.level[i] + 1;
        var cx = originX + (x - y) * TW2;
        var cy = originY + (x + y) * TH2 - level * LH;
        var c = rgb[grid.biome[i]];
        var ph = level * LH;

        if (ph > 0) {
          // left face (W edge of the top diamond, extruded down)
          ctx.fillStyle = ctx.strokeStyle = shade(c, 0.70);
          ctx.beginPath();
          ctx.moveTo(cx - TW2, cy);
          ctx.lineTo(cx, cy + TH2);
          ctx.lineTo(cx, cy + TH2 + ph);
          ctx.lineTo(cx - TW2, cy + ph);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // right face (E edge)
          ctx.fillStyle = ctx.strokeStyle = shade(c, 0.52);
          ctx.beginPath();
          ctx.moveTo(cx, cy + TH2);
          ctx.lineTo(cx + TW2, cy);
          ctx.lineTo(cx + TW2, cy + ph);
          ctx.lineTo(cx, cy + TH2 + ph);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }

        // top diamond — slight lift with elevation so height reads at a glance
        var topF = water ? 1.0 : (0.92 + 0.12 * (level / maxLevel));
        ctx.fillStyle = ctx.strokeStyle = shade(c, topF); // stroke closes AA seams
        ctx.beginPath();
        ctx.moveTo(cx, cy - TH2);
        ctx.lineTo(cx + TW2, cy);
        ctx.lineTo(cx, cy + TH2);
        ctx.lineTo(cx - TW2, cy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    return { canvas: cnv, width: cnv.width, height: cnv.height };
  }

  SM.bakeIso = bakeIso;
})(window.SM = window.SM || {});
