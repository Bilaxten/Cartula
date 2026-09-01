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
    var sun = o.sun || { dx: -1, dy: 0, rise: 0.62, strength: 0.34 };
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

    var MB = 1;  // dark voxel border ring, in tiles, around the whole map

    var originX = (H - 1 + MB) * TW2 + TW2 + 2;
    var originY = TH2 * 2 + maxLevel * LH + 2 + MB * TH2;

    canvas.width = Math.ceil((W + H + 2 * MB) * TW2 + TW + 4);
    canvas.height = Math.ceil((W + H + 2 * MB) * TH2 + (maxLevel - floorLevel) * LH + TW + 4);
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
    var waterfalls = [];
    var foam = [];

    function lvl(x, y) {
      if (x < 0 || y < 0 || x >= W || y >= H) return floorLevel;
      return level[y * W + x];
    }

    // --- directional shadow pre-pass ---
    // March each tile toward the light; if a taller voxel breaks the ray, the
    // tile sits in shade. Direction / ray-climb / darkness come from the sun
    // (time-of-day slider) — low sun casts long, dark shadows.
    var SUN_DX = sun.dx, SUN_DY = sun.dy;
    var SUN_RISE = Math.max(0.12, sun.rise);
    var STR = sun.strength;
    var SUN_STEPS = 12;
    var shadow = new Float32Array(W * H); // 0 = lit, up to 1 = fully shaded
    for (var sy = 0; sy < H; sy++) {
      for (var sx = 0; sx < W; sx++) {
        var si = sy * W + sx;
        if (level[si] <= floorLevel) continue;
        var base = level[si], sh = 0;
        for (var st = 1; st <= SUN_STEPS; st++) {
          var ol = lvl(Math.round(sx + SUN_DX * st), Math.round(sy + SUN_DY * st));
          var over = ol - (base + SUN_RISE * st);
          if (over > 0) {
            var contrib = Math.min(1, over / 2.2) * (1 - (st - 1) / SUN_STEPS);
            if (contrib > sh) sh = contrib;
          }
        }
        shadow[si] = sh;
      }
    }

    // dark charcoal border voxel — its top matches the height of the map edge
    // it hugs (never rising above it), bottoming out at the sea plane so water
    // edges get a flush waterline kerb rather than a wall. Side faces drop to
    // the floor for the map's base. Drawn in painter's order with the terrain.
    var BORD = [32, 36, 44];
    function borderTop(bx, by) {
      var cxx = bx < 0 ? 0 : (bx >= W ? W - 1 : bx);
      var cyy = by < 0 ? 0 : (by >= H ? H - 1 : by);
      var bl = level[cyy * W + cxx];
      return bl < 0 ? 0 : bl;
    }

    for (var y = -MB; y < H + MB; y++) {
      for (var x = -MB; x < W + MB; x++) {
        var cx = originX + (x - y) * TW2;

        if (x < 0 || y < 0 || x >= W || y >= H) {
          var bL = borderTop(x, y);
          var bcy = originY + (x + y) * TH2 - bL * LH;
          var bDrop = (bL - floorLevel) * LH + 1;
          ctx.fillStyle = shade(BORD, 0.55);        // left face
          ctx.beginPath();
          ctx.moveTo(cx - TW2 - E, bcy); ctx.lineTo(cx, bcy + TH2);
          ctx.lineTo(cx, bcy + TH2 + bDrop); ctx.lineTo(cx - TW2 - E, bcy + bDrop);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = shade(BORD, 0.4);         // right face
          ctx.beginPath();
          ctx.moveTo(cx, bcy + TH2); ctx.lineTo(cx + TW2 + E, bcy);
          ctx.lineTo(cx + TW2 + E, bcy + bDrop); ctx.lineTo(cx, bcy + TH2 + bDrop);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = shade(BORD, 1.4);         // top — legible from above
          ctx.beginPath();
          ctx.moveTo(cx, bcy - TH2 - E); ctx.lineTo(cx + TW2 + E, bcy);
          ctx.lineTo(cx, bcy + TH2 + E); ctx.lineTo(cx - TW2 - E, bcy);
          ctx.closePath(); ctx.fill();
          continue;
        }

        var i = y * W + x;
        var L = level[i];
        var cy = originY + (x + y) * TH2 - L * LH;
        var c = rgb[grid.biome[i]];
        var sv = SM.biomeShade(grid, i);
        var shf = 1 - STR * shadow[i];         // top-face darkening from cast shadow
        var shSide = 1 - STR * 0.55 * shadow[i]; // sides take a lighter hit

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

        // Short centre-to-edge strips join with the matching strips on road
        // neighbours. Canvas strokes are square-ended quads at this scale.
        if (grid.roads && grid.roads[i]) {
          ctx.strokeStyle = grid.roads[i] === 2 ? '#806b50' : '#b7a07a';
          ctx.lineWidth = Math.max(2, TW * (grid.roads[i] === 2 ? 0.16 : 0.11));
          ctx.lineCap = 'butt';
          for (var rn = 0; rn < 4; rn++) {
            var rdx = rn === 0 ? -1 : (rn === 1 ? 1 : 0);
            var rdy = rn === 2 ? -1 : (rn === 3 ? 1 : 0);
            var rnx = x + rdx, rny = y + rdy;
            if (rnx < 0 || rny < 0 || rnx >= W || rny >= H) continue;
            var rni = rny * W + rnx;
            if (!grid.roads[rni]) continue;
            var ncx = originX + (rnx - rny) * TW2;
            var ncy = originY + (rnx + rny) * TH2 - level[rni] * LH;
            ctx.beginPath(); ctx.moveTo(cx, cy);
            ctx.lineTo((cx + ncx) * 0.5, (cy + ncy) * 0.5); ctx.stroke();
          }
          if (grid.roads[i] === 2) {
            ctx.strokeStyle = '#c4ad84'; ctx.lineWidth = 1;
            for (var plank = -1; plank <= 1; plank++) {
              ctx.beginPath();
              ctx.moveTo(cx - TW * 0.13, cy + plank * 2);
              ctx.lineTo(cx + TW * 0.13, cy + plank * 2); ctx.stroke();
            }
          }
        }

        // Tiny deterministic prisms give each built-up cell its own compact
        // roofline without consuming another random stream during rendering.
        if (grid.builtup && grid.builtup[i]) {
          var bhash = ((x * 73856093) ^ (y * 19349663) ^ (((grid.config && grid.config.seed) || 0) * 83492791)) >>> 0;
          var bcount = 1 + (bhash % 3);
          for (var bn = 0; bn < bcount; bn++) {
            var hb = (bhash >>> (bn * 5)) ^ (bn * 2654435761);
            var boxX = cx + (((hb & 15) / 15) - 0.5) * TW * 0.34;
            var boxY = cy + ((((hb >>> 4) & 15) / 15) - 0.5) * TH2 * 0.55;
            var bw = Math.max(2, TW * (0.09 + ((hb >>> 8) & 3) * 0.018));
            var bht = 3 + ((hb >>> 10) & 3);
            ctx.fillStyle = 'rgba(32,28,24,0.22)';
            ctx.fillRect(boxX + bw * 0.45, boxY + 1, bw * 1.4, Math.max(1, bht * 0.35));
            ctx.fillStyle = '#8a7b68';
            ctx.beginPath(); ctx.moveTo(boxX - bw, boxY); ctx.lineTo(boxX, boxY + bw * 0.45);
            ctx.lineTo(boxX, boxY + bw * 0.45 + bht); ctx.lineTo(boxX - bw, boxY + bht);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#9a8c78';
            ctx.beginPath(); ctx.moveTo(boxX, boxY + bw * 0.45); ctx.lineTo(boxX + bw, boxY);
            ctx.lineTo(boxX + bw, boxY + bht); ctx.lineTo(boxX, boxY + bw * 0.45 + bht);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#6f6250';
            ctx.beginPath(); ctx.moveTo(boxX, boxY - bw * 0.45); ctx.lineTo(boxX + bw, boxY);
            ctx.lineTo(boxX, boxY + bw * 0.45); ctx.lineTo(boxX - bw, boxY);
            ctx.closePath(); ctx.fill();
          }
        }

        if (grid.biome[i] === RIVER) {
          rivers.push({ cx: cx, cy: cy, elev: grid.elevation[i], gx: x, gy: y });
        } else if ((LAVA >= 0 && grid.biome[i] === LAVA) || (lavaFlag && lavaFlag[i])) {
          lavas.push({ cx: cx, cy: cy, elev: grid.elevation[i], gx: x, gy: y });
        }
        if (grid.waterfalls && grid.waterfalls[i]) waterfalls.push({
          cx: cx, cy: cy, elev: grid.elevation[i], gx: x, gy: y,
          drop: grid.waterfallDrop ? grid.waterfallDrop[i] : 0
        });
        if (grid.biome[i] === SM.BIOME_IDX.shallow_water) {
          var touchLand = (x > 0 && !grid.water[i - 1]) || (x < W - 1 && !grid.water[i + 1]) ||
            (y > 0 && !grid.water[i - W]) || (y < H - 1 && !grid.water[i + W]);
          if (touchLand) foam.push({ cx: cx, cy: cy, gx: x, gy: y });
        }
      }
    }

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
      waterfalls: waterfalls,
      foam: foam,
      riverRgb: rgb[RIVER],
      lavaRgb: LAVA >= 0 ? rgb[LAVA] : [226, 82, 29],
      lh: LH,
      diamond: { w2: TW2 + E, h2: TH2 + E }
    };
  }

  SM.renderIso = renderIso;
})(window.SM = window.SM || {});
