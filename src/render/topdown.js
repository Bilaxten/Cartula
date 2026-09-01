/* Top-down renderer: draws the whole map onto `canvas` at a fixed tile size.
 * The camera (pan/zoom) is a CSS transform applied to the canvas element by
 * main.js — this just paints content, 1:1. */
(function (SM) {
  'use strict';

  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function shade(rgb, f) {
    return 'rgb(' + Math.round(rgb[0] * f) + ',' + Math.round(rgb[1] * f) + ',' + Math.round(rgb[2] * f) + ')';
  }

  var RGB = null;
  function biomeRgb() {
    if (!RGB) RGB = SM.BIOME_LIST.map(function (b) { return hexToRgb(b.color); });
    return RGB;
  }

  function renderTopDown(canvas, grid, opts) {
    var o = Object.assign({ tile: 10, grid: false, shade: true }, opts || {});
    var w = grid.width, h = grid.height, ts = o.tile;

    canvas.width = w * ts;
    canvas.height = h * ts;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    var rgb = biomeRgb();

    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        var c = rgb[grid.biome[i]];
        ctx.fillStyle = shade(c, SM.biomeShade(grid, i));
        ctx.fillRect(x * ts, y * ts, ts, ts);

        if (o.shade && !grid.water[i]) {
          var eHere = grid.elevation[i];
          var eL = x > 0 ? grid.elevation[i - 1] : eHere;
          var eU = y > 0 ? grid.elevation[i - w] : eHere;
          var s = (eHere - eL) + (eHere - eU);
          var a = s * 5;
          if (a > 0.4) a = 0.4;
          if (a < -0.4) a = -0.4;
          ctx.fillStyle = a > 0 ? 'rgba(255,255,255,' + a + ')' : 'rgba(0,0,0,' + (-a) + ')';
          ctx.fillRect(x * ts, y * ts, ts, ts);
        }
      }
    }

    if (o.grid) {
      ctx.strokeStyle = 'rgba(0,0,0,0.10)';
      ctx.beginPath();
      for (var gx = 0; gx <= w; gx++) { ctx.moveTo(gx * ts, 0); ctx.lineTo(gx * ts, h * ts); }
      for (var gy = 0; gy <= h; gy++) { ctx.moveTo(0, gy * ts); ctx.lineTo(w * ts, gy * ts); }
      ctx.stroke();
    }

    return { tile: ts };
  }

  SM.renderTopDown = renderTopDown;
})(window.SM = window.SM || {});
