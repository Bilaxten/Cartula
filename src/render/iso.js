/* Isometric voxel renderer. Draws the whole map onto `canvas` (sized to the
 * full iso extent). The camera (pan/zoom) is a CSS transform on the canvas
 * element, handled by main.js — this only paints content.
 *
 * Each tile is a prism: a 2:1 top diamond plus its two front-facing side
 * faces. A side face is only drawn down to the level of the neighbour that
 * would occlude it, so interior tiles draw almost nothing. Levels are
 * signed — land rises above the sea plane, water sinks below it. */
(function (SM) {
  'use strict';

  var RGB = null;

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
    if (!RGB) RGB = SM.BIOME_LIST.map(function (b) { return hexToRgb(b.color); });
    return RGB;
  }

  // Chrome drops GPU acceleration for large canvases and falls back to very
  // slow software rendering. Keep the baked canvas comfortably under that.
  var MAX_CANVAS_PX = 8e6;

  function renderIso(canvas, grid, opts) {
    var o = Object.assign({ tile: 26, levelHeight: 20 }, opts || {});
    var W = grid.width, H = grid.height;
    var TW = o.tile, LH = o.levelHeight;

    // shrink the tile (and height) if this map would blow the canvas budget
    var estArea = (W + H) * (W + H) * TW * TW / 8;
    if (estArea > MAX_CANVAS_PX) {
      var k = Math.sqrt(MAX_CANVAS_PX / estArea);
      TW = Math.max(8, Math.floor(TW * k));
      LH = LH * k;
    }
    var TW2 = TW / 2, TH2 = TW / 4;

    var levels = (grid.config && grid.config.levels) || 10;
    var waterDepth = (grid.config && grid.config.waterDepth) || 3;
    var maxLevel = levels + 1;
    var floorLevel = -waterDepth - 1;

    var originX = (H - 1) * TW2 + TW2 + 2;
    var originY = TH2 * 2 + maxLevel * LH + 2;

    canvas.width = Math.ceil((W + H) * TW2 + TW + 4);
    canvas.height = Math.ceil((W + H) * TH2 + (maxLevel - floorLevel) * LH + TW + 4);
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    var rgb = biomeRgb();
    var level = grid.level;
    var E = 0.75; // geometry outset, px — fills anti-alias seams
    var RIVER = SM.BIOME_IDX.river;
    var rivers = []; // {cx, cy, phase} of each river tile's top diamond, for animation

    function lvl(x, y) {
      if (x < 0 || y < 0 || x >= W || y >= H) return floorLevel;
      return level[y * W + x];
    }

    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var i = y * W + x;
        var L = level[i];
        var cx = originX + (x - y) * TW2;
        var cy = originY + (x + y) * TH2 - L * LH;
        var c = rgb[grid.biome[i]];
        var sv = SM.biomeShade(grid, i);

        // left face — down to the (x, y+1) neighbour (or the floor at the edge)
        var leftDrop = L - lvl(x, y + 1);
        if (leftDrop > 0) {
          var lhp = leftDrop * LH + 1;
          ctx.fillStyle = shade(c, 0.70 * sv);
          ctx.beginPath();
          ctx.moveTo(cx - TW2 - E, cy);
          ctx.lineTo(cx, cy + TH2);
          ctx.lineTo(cx, cy + TH2 + lhp);
          ctx.lineTo(cx - TW2 - E, cy + lhp);
          ctx.closePath();
          ctx.fill();
        }

        // right face — down to the (x+1, y) neighbour
        var rightDrop = L - lvl(x + 1, y);
        if (rightDrop > 0) {
          var rhp = rightDrop * LH + 1;
          ctx.fillStyle = shade(c, 0.50 * sv);
          ctx.beginPath();
          ctx.moveTo(cx, cy + TH2);
          ctx.lineTo(cx + TW2 + E, cy);
          ctx.lineTo(cx + TW2 + E, cy + rhp);
          ctx.lineTo(cx, cy + TH2 + rhp);
          ctx.closePath();
          ctx.fill();
        }

        // top diamond (outset slightly to close AA seams between tiles) —
        // a touch lighter with height so relief reads at a glance
        var topF = grid.water[i] ? 1.0 : (0.90 + 0.15 * (L / maxLevel));
        ctx.fillStyle = shade(c, topF * sv);
        ctx.beginPath();
        ctx.moveTo(cx, cy - TH2 - E);
        ctx.lineTo(cx + TW2 + E, cy);
        ctx.lineTo(cx, cy + TH2 + E);
        ctx.lineTo(cx - TW2 - E, cy);
        ctx.closePath();
        ctx.fill();

        if (grid.biome[i] === RIVER) {
          rivers.push({ cx: cx, cy: cy, phase: (grid.flowStep ? grid.flowStep[i] : 0) });
        }
      }
    }

    return {
      width: canvas.width, height: canvas.height,
      rivers: rivers,
      riverRgb: rgb[RIVER],
      diamond: { w2: TW2 + E, h2: TH2 + E }
    };
  }

  SM.renderIso = renderIso;
})(window.SM = window.SM || {});
