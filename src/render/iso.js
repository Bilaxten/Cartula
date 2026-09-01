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
    var LAVA = SM.BIOME_IDX.lava != null ? SM.BIOME_IDX.lava : -1;
    var lavaFlag = grid.lava || null;
    var rivers = []; // {cx, cy, elev, i} of each river tile's top diamond, for animation
    var lavas = [];  // same, for lava tiles

    function lvl(x, y) {
      if (x < 0 || y < 0 || x >= W || y >= H) return floorLevel;
      return level[y * W + x];
    }

    // --- directional shadow pre-pass ---
    // Sun low in the grid-west / grid-south, so relief throws a shadow toward
    // the grid-north-east. For each tile, march toward the sun; if a taller
    // voxel breaks the light ray, the tile sits in shade. Soft edge by depth.
    var SUN_DX = -1, SUN_DY = 0;        // march toward the light — screen upper-left
    var SUN_RISE = 0.62;               // ray climbs this many levels per tile
    var SUN_STEPS = 10;
    var shadow = new Float32Array(W * H); // 0 = lit, up to 1 = fully shaded
    for (var sy = 0; sy < H; sy++) {
      for (var sx = 0; sx < W; sx++) {
        var si = sy * W + sx;
        if (level[si] <= floorLevel) continue;
        var base = level[si], sh = 0;
        for (var st = 1; st <= SUN_STEPS; st++) {
          var ol = lvl(sx + SUN_DX * st, sy + SUN_DY * st);
          var ray = base + SUN_RISE * st;
          var over = ol - ray;
          if (over > 0) {
            var contrib = Math.min(1, over / 2.2) * (1 - (st - 1) / SUN_STEPS);
            if (contrib > sh) sh = contrib;
          }
        }
        shadow[si] = sh;
      }
    }

    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var i = y * W + x;
        var L = level[i];
        var cx = originX + (x - y) * TW2;
        var cy = originY + (x + y) * TH2 - L * LH;
        var c = rgb[grid.biome[i]];
        var sv = SM.biomeShade(grid, i);
        var shf = 1 - 0.34 * shadow[i];      // top-face darkening from cast shadow
        var shSide = 1 - 0.18 * shadow[i];   // sides take a lighter hit

        // left face — down to the (x, y+1) neighbour (or the floor at the edge)
        var leftDrop = L - lvl(x, y + 1);
        if (leftDrop > 0) {
          var lhp = leftDrop * LH + 1;
          ctx.fillStyle = shade(c, 0.70 * sv * shSide);
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
          ctx.fillStyle = shade(c, 0.50 * sv * shSide);
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
        ctx.fillStyle = shade(c, topF * sv * shf);
        ctx.beginPath();
        ctx.moveTo(cx, cy - TH2 - E);
        ctx.lineTo(cx + TW2 + E, cy);
        ctx.lineTo(cx, cy + TH2 + E);
        ctx.lineTo(cx - TW2 - E, cy);
        ctx.closePath();
        ctx.fill();

        if (grid.biome[i] === RIVER) {
          rivers.push({ cx: cx, cy: cy, elev: grid.elevation[i], gx: x, gy: y });
        } else if ((LAVA >= 0 && grid.biome[i] === LAVA) || (lavaFlag && lavaFlag[i])) {
          lavas.push({ cx: cx, cy: cy, elev: grid.elevation[i], gx: x, gy: y });
        }
      }
    }

    // --- map border ---
    // A dark plinth under the two front edges (east + south) plus a thick dark
    // rim hugging the relief along all four outer edges, so the map reads as a
    // solid slab with a clean single-line boundary.
    var fY = originY - floorLevel * LH;
    function topV(x, y) {
      var L = lvl(x, y);
      return { cx: originX + (x - y) * TW2, cy: originY + (x + y) * TH2 - L * LH };
    }

    ctx.fillStyle = '#0c0f15';
    for (y = 0; y < H; y++) {                 // east edge — right faces to floor
      var pe = topV(W - 1, y);
      ctx.beginPath();
      ctx.moveTo(pe.cx, pe.cy + TH2);
      ctx.lineTo(pe.cx + TW2, pe.cy);
      ctx.lineTo(pe.cx + TW2, fY + ((W - 1) + y) * TH2);
      ctx.lineTo(pe.cx, fY + ((W - 1) + y) * TH2 + TH2);
      ctx.closePath();
      ctx.fill();
    }
    for (x = 0; x < W; x++) {                 // south edge — left faces to floor
      var ps = topV(x, H - 1);
      ctx.beginPath();
      ctx.moveTo(ps.cx - TW2, ps.cy);
      ctx.lineTo(ps.cx, ps.cy + TH2);
      ctx.lineTo(ps.cx, fY + (x + (H - 1)) * TH2 + TH2);
      ctx.lineTo(ps.cx - TW2, fY + (x + (H - 1)) * TH2);
      ctx.closePath();
      ctx.fill();
    }

    ctx.strokeStyle = '#0a0d12';
    ctx.lineWidth = Math.max(2, TW * 0.13);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    var wv = topV(0, 0);                      // west edge silhouette (top↔left)
    ctx.moveTo(wv.cx, wv.cy - TH2);
    for (y = 0; y < H; y++) { var w0 = topV(0, y); ctx.lineTo(w0.cx, w0.cy - TH2); ctx.lineTo(w0.cx - TW2, w0.cy); }
    var sw = topV(0, H - 1);                  // ...down the south-west corner to the floor
    ctx.lineTo(sw.cx - TW2, fY + (0 + (H - 1)) * TH2);
    ctx.stroke();
    ctx.beginPath();
    var nv = topV(0, 0);                      // north edge silhouette (top↔right)
    ctx.moveTo(nv.cx, nv.cy - TH2);
    for (x = 0; x < W; x++) { var n0 = topV(x, 0); ctx.lineTo(n0.cx, n0.cy - TH2); ctx.lineTo(n0.cx + TW2, n0.cy); }
    var ne = topV(W - 1, 0);                  // ...down the north-east corner to the floor
    ctx.lineTo(ne.cx + TW2, fY + ((W - 1) + 0) * TH2);
    ctx.stroke();

    // --- occlusion cull for the animated overlays ---
    // A tile's top face is hidden when a voxel in front of it (larger gx+gy, so
    // painted later) rises above the line of sight. Along the screen-forward
    // diagonal, the tile k steps ahead occludes when its level clears
    // L + (2k-1)*(TH2/LH). Keep only tiles that stay visible.
    var ratio = TH2 / LH;
    function visible(t) {
      var L = level[t.gy * W + t.gx];
      for (var k = 1; k <= 7; k++) {
        // a front voxel hides this top face once it clears the sightline:
        // L_front >= L + (TH2/LH)*(2k-1)
        var need = L + (2 * k - 1) * ratio;
        if (lvl(t.gx + k, t.gy + k) >= need ||
            lvl(t.gx + k, t.gy + k - 1) >= need ||
            lvl(t.gx + k - 1, t.gy + k) >= need) return false;
      }
      return true;
    }
    var visRivers = [], vk;
    for (vk = 0; vk < rivers.length; vk++) if (visible(rivers[vk])) visRivers.push(rivers[vk]);
    var visLavas = [];
    for (vk = 0; vk < lavas.length; vk++) if (visible(lavas[vk])) visLavas.push(lavas[vk]);

    return {
      width: canvas.width, height: canvas.height,
      rivers: visRivers,
      lavas: visLavas,
      riverRgb: rgb[RIVER],
      lavaRgb: LAVA >= 0 ? rgb[LAVA] : [226, 82, 29],
      lh: LH,
      diamond: { w2: TW2 + E, h2: TH2 + E }
    };
  }

  SM.renderIso = renderIso;
})(window.SM = window.SM || {});
