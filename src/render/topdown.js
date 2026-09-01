/* Top-down renderer: the grid's top faces, flat, with a cheap slope hillshade. */
(function (SM) {
  'use strict';

  function renderTopDown(canvas, grid, opts) {
    var o = Object.assign({ tile: 8, grid: false, shade: true }, opts || {});
    var w = grid.width, h = grid.height, ts = o.tile;

    canvas.width = w * ts;
    canvas.height = h * ts;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        ctx.fillStyle = SM.BIOME_LIST[grid.biome[i]].color;
        ctx.fillRect(x * ts, y * ts, ts, ts);

        if (o.shade && !grid.water[i]) {
          var eHere = grid.elevation[i];
          var eL = x > 0 ? grid.elevation[i - 1] : eHere;
          var eU = y > 0 ? grid.elevation[i - w] : eHere;
          var slope = (eHere - eL) + (eHere - eU);
          var a = slope * 4;
          if (a > 0.35) a = 0.35;
          if (a < -0.35) a = -0.35;
          ctx.fillStyle = a > 0
            ? 'rgba(255,255,255,' + a + ')'
            : 'rgba(0,0,0,' + (-a) + ')';
          ctx.fillRect(x * ts, y * ts, ts, ts);
        }
      }
    }

    if (o.grid) {
      ctx.strokeStyle = 'rgba(0,0,0,0.10)';
      ctx.beginPath();
      for (var gx = 0; gx <= w; gx++) {
        ctx.moveTo(gx * ts, 0);
        ctx.lineTo(gx * ts, h * ts);
      }
      for (var gy = 0; gy <= h; gy++) {
        ctx.moveTo(0, gy * ts);
        ctx.lineTo(w * ts, gy * ts);
      }
      ctx.stroke();
    }
  }

  SM.renderTopDown = renderTopDown;
})(window.SM = window.SM || {});
