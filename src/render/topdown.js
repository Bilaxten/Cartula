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
    var RIVER = SM.BIOME_IDX.river;
    var LAVA = SM.BIOME_IDX.lava != null ? SM.BIOME_IDX.lava : -1;
    var lavaFlag = grid.lava || null;
    var rivers = [], lavas = [];

    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        var c = rgb[grid.biome[i]];
        ctx.fillStyle = shade(c, SM.biomeShade(grid, i));
        ctx.fillRect(x * ts, y * ts, ts, ts);

        if (grid.biome[i] === RIVER) {
          rivers.push({ x: x * ts, y: y * ts, phase: (grid.flowStep ? grid.flowStep[i] : (x + y)) });
        } else if ((LAVA >= 0 && grid.biome[i] === LAVA) || (lavaFlag && lavaFlag[i])) {
          lavas.push({ x: x * ts, y: y * ts, phase: grid.elevation[i] * 60 });
        }

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

    // Roads are drawn as centre-to-centre links so adjacent road cells read as
    // one route instead of a dotted overlay. Bridges get a darker plank strip.
    if (grid.roads) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#b7a07a';
      ctx.beginPath();
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        if (!grid.roads[i]) continue;
        var rcx = (x + 0.5) * ts, rcy = (y + 0.5) * ts;
        if (x < w - 1 && grid.roads[i + 1]) { ctx.moveTo(rcx, rcy); ctx.lineTo(rcx + ts, rcy); }
        if (y < h - 1 && grid.roads[i + w]) { ctx.moveTo(rcx, rcy); ctx.lineTo(rcx, rcy + ts); }
      }
      ctx.stroke();
      ctx.strokeStyle = '#806b50';
      ctx.lineWidth = Math.max(2, ts * 0.24);
      ctx.beginPath();
      for (i = 0; i < grid.roads.length; i++) if (grid.roads[i] === 2) {
        x = i % w; y = (i / w) | 0;
        ctx.moveTo((x + 0.28) * ts, (y + 0.5) * ts);
        ctx.lineTo((x + 0.72) * ts, (y + 0.5) * ts);
      }
      ctx.stroke();
    }

    // Compact house markers remain legible even when the town biome footprint
    // is only a few cells wide.
    var settlements = grid.settlements || [];
    for (var si = 0; si < settlements.length; si++) {
      var st = settlements[si];
      var sc = Math.max(3, Math.min(ts * 0.85, ts * (0.42 + st.size * 0.10)));
      var sx = (st.x + 0.5) * ts, sy = (st.y + 0.5) * ts;
      ctx.fillStyle = '#3b3b3b';
      ctx.fillRect(sx - sc * 0.36, sy - sc * 0.02, sc * 0.72, sc * 0.55);
      ctx.beginPath();
      ctx.moveTo(sx - sc * 0.48, sy); ctx.lineTo(sx, sy - sc * 0.48);
      ctx.lineTo(sx + sc * 0.48, sy); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#d8d2c4';
      ctx.fillRect(sx + sc * 0.08, sy + sc * 0.16, Math.max(1, sc * 0.12), Math.max(1, sc * 0.18));
    }

    var labels = grid.labels || [];
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (var li = 0; li < labels.length; li++) {
      var lab = labels[li];
      var italic = lab.kind === 'mountain' || lab.kind === 'sea';
      ctx.font = (italic ? 'italic ' : '') + lab.size + 'px Georgia, "Times New Roman", serif';
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0.7px';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(25,28,32,0.88)';
      ctx.fillStyle = '#ffffff';
      ctx.strokeText(lab.text, (lab.x + 0.5) * ts, (lab.y + 0.5) * ts);
      ctx.fillText(lab.text, (lab.x + 0.5) * ts, (lab.y + 0.5) * ts);
    }
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

    return {
      width: canvas.width, height: canvas.height, tile: ts,
      rivers: rivers, lavas: lavas,
      riverRgb: rgb[RIVER], lavaRgb: LAVA >= 0 ? rgb[LAVA] : [226, 82, 29]
    };
  }

  SM.renderTopDown = renderTopDown;
})(window.SM = window.SM || {});
