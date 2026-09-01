/* Wiring: read the panel, generate, render (top-down or isometric), and drive
 * one shared camera. The map is drawn once onto #map at full resolution; the
 * camera is a CSS transform on that canvas, so pan and zoom never redraw. */
(function (SM) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var map = $('map');
  var stage = $('stage');
  var hoverEl = $('hover');

  var grid = null;
  var view = 'top';                 // 'top' | 'iso'
  var content = null;               // { width, height, tile } after a render
  var cam = { scale: 1, x: 0, y: 0 };
  var lastW = 0, lastH = 0;         // content dims of the previous render
  var drag = null;
  var editStroke = null;
  var undoStack = [], redoStack = [];
  var statsBase = '';

  var TOP_TILE = 9;
  var ISO_TILE = 24;
  var ISO_BASE_LH = 13;

  var anim = null; // river-flow animation state (iso only)

  function isoExag() { return parseFloat($('isoexag').value); }

  function signed(v) {
    var n = +v;
    return (n >= 0 ? '+' : '') + n.toFixed(2);
  }

  var SLIDERS = {
    size: { label: 'sizeVal', fmt: function (v) { return v + '²'; } },
    sea: { label: 'seaVal', fmt: function (v) { return Math.round((1 - v) * 100) + '% land'; } },
    rugged: { label: 'ruggedVal', fmt: function (v) { return (+v).toFixed(2); } },
    warp: { label: 'warpVal', fmt: function (v) { return (+v).toFixed(2); } },
    escale: { label: 'escaleVal', fmt: function (v) { return (+v).toFixed(1); } },
    octaves: { label: 'octavesVal', fmt: function (v) { return v; } },
    island: { label: 'islandVal', fmt: function (v) { return (+v).toFixed(2); } },
    mscale: { label: 'mscaleVal', fmt: function (v) { return (+v).toFixed(1); } },
    tbias: { label: 'tbiasVal', fmt: signed },
    mbias: { label: 'mbiasVal', fmt: signed },
    rivers: { label: 'riversVal', fmt: function (v) { return (+v).toFixed(2); } },
    brushSize: { label: 'brushSizeVal', fmt: function (v) { return v; } },
    brushStrength: { label: 'brushStrengthVal', fmt: function (v) { return (+v).toFixed(1); } },
    isoexag: { label: 'isoexagVal', fmt: function (v) { return (+v).toFixed(1); } },
    sun: { label: 'sunVal', fmt: function (v) {
      var h = Math.floor(v), m = Math.round((v - h) * 60);
      return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    } }
  };

  // Time of day -> shadow direction for the iso bake, plus a colour wash and a
  // canvas filter for the live look. Daylight is 6:00-18:00; outside that the
  // sun is below the horizon (night).
  function sunModel(hour) {
    var day = (hour - 6) / 12;                    // 0 sunrise .. 1 sunset
    var up = day > 0 && day < 1;
    var elev = up ? Math.sin(day * Math.PI) : 0;  // 0 horizon .. 1 noon
    var iso = {
      dx: up ? Math.cos(day * Math.PI) : -0.6,    // light swings east -> west
      dy: -0.35 - 0.45 * elev,                    // always a bit from the north
      rise: 0.22 + 1.15 * elev,                   // low sun -> long shadows
      strength: up ? (0.16 + 0.26 * elev) : 0.05
    };
    var overlay, filter;
    if (!up) {                                    // night — deep blue, dim
      var nd = Math.min(1, (hour < 6 ? (6 - hour) : (hour - 18)) / 3); // dusk->deep
      overlay = 'rgba(34,50,102,' + (0.4 + 0.24 * nd).toFixed(2) + ')';
      filter = 'brightness(' + (0.78 - 0.16 * nd).toFixed(2) + ') saturate(0.82)';
    } else if (elev < 0.55) {                      // golden hour — warm
      var w = 1 - elev / 0.55;                     // 1 at horizon, 0 mid-morning
      overlay = 'rgba(255,' + Math.round(178 - 40 * w) + ',' + Math.round(120 - 30 * w) + ',' + (0.05 + 0.26 * w).toFixed(2) + ')';
      filter = 'brightness(' + (0.98 - 0.14 * w).toFixed(2) + ') saturate(' + (1 + 0.14 * w).toFixed(2) + ')';
    } else {                                       // midday — clear
      overlay = 'rgba(255,250,235,0)';
      filter = 'brightness(1.02) saturate(1)';
    }
    return { iso: iso, overlay: overlay, filter: filter };
  }

  function applyDayNight() {
    var s = sunModel(parseFloat($('sun').value));
    $('daynight').style.background = s.overlay;
    map.style.filter = s.filter;
    $('riverfx').style.filter = s.filter;
  }

  function readConfig() {
    var size = parseInt($('size').value, 10);
    return {
      width: size,
      height: size,
      seed: parseInt($('seed').value, 10) || 0,
      seaLevel: parseFloat($('sea').value),
      ruggedness: parseFloat($('rugged').value),
      warp: parseFloat($('warp').value),
      elevationScale: parseFloat($('escale').value),
      octaves: parseInt($('octaves').value, 10),
      islandFalloff: parseFloat($('island').value),
      moistureScale: parseFloat($('mscale').value),
      temperatureBias: parseFloat($('tbias').value),
      moistureBias: parseFloat($('mbias').value),
      rivers: parseFloat($('rivers').value)
    };
  }

  function applyCam() {
    var t = 'translate(' + cam.x + 'px,' + cam.y + 'px) scale(' + cam.scale + ')';
    map.style.transform = t;
    $('riverfx').style.transform = t;
  }

  function fitCam() {
    var sw = stage.clientWidth, sh = stage.clientHeight;
    cam.scale = Math.min(sw / content.width, sh / content.height) * 0.92;
    cam.x = (sw - content.width * cam.scale) / 2;
    cam.y = (sh - content.height * cam.scale) / 2;
  }

  function stopAnim() {
    if (anim) { cancelAnimationFrame(anim.raf); anim = null; }
    var fx = $('riverfx');
    if (fx.width) fx.getContext('2d').clearRect(0, 0, fx.width, fx.height);
  }

  // Animation runs on a SEPARATE overlay canvas (#riverfx) so the big terrain
  // canvas is never touched after the bake. Each frame clears ONE bounding box
  // covering every animated tile, then repaints them all in painter order
  // (back-to-front) — so clustered tiles (a crater lava lake, a wide river
  // mouth) composite cleanly instead of clipping each other. Capped ~30 fps.
  function startRiverAnim() {
    stopAnim();
    var r = (content.rivers || []).slice();
    var lv = (content.lavas || []).slice();
    if ((r.length + lv.length) === 0 || (r.length + lv.length) > 1600 ||
        map.width * map.height > 16e6) return;

    var iso = view === 'iso';
    var d = content.diamond, ts = content.tile, lh = content.lh || 20;
    var pad = iso ? (Math.min(4.5, lh * 0.26) + lh * 0.5 + d.h2 + 3) : (ts + 2);
    if (iso) {
      var ord = function (a, b) { return (a.gx + a.gy) - (b.gx + b.gy); };
      r.sort(ord); lv.sort(ord);
    }
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, all = r.concat(lv), j;
    for (j = 0; j < all.length; j++) {
      var ax = iso ? all[j].cx : all[j].x, ay = iso ? all[j].cy : all[j].y;
      if (ax < minX) minX = ax; if (ax > maxX) maxX = ax;
      if (ay < minY) minY = ay; if (ay > maxY) maxY = ay;
    }
    var box = {
      x: Math.floor(minX - pad), y: Math.floor(minY - pad),
      w: Math.ceil(maxX - minX + pad * 2), h: Math.ceil(maxY - minY + pad * 2)
    };

    var fx = $('riverfx');
    fx.width = map.width;
    fx.height = map.height;
    fx.style.transform = map.style.transform;
    anim = {
      raf: 0, mode: view, rivers: r, lavas: lv, box: box,
      rgb: content.riverRgb, lavaRgb: content.lavaRgb || [226, 82, 29],
      d: d, tile: ts, lh: lh, t0: performance.now(), last: 0
    };
    tick();
  }

  function shade(rgb, f) {
    return 'rgb(' + Math.round(rgb[0] * f) + ',' + Math.round(rgb[1] * f) + ',' + Math.round(rgb[2] * f) + ')';
  }

  // one iso prism (top diamond + two front faces) at column cx, top at topY,
  // faces down to botY
  function prism(ctx, cx, topY, botY, w2, h2, topC, leftC, rightC) {
    ctx.fillStyle = leftC;
    ctx.beginPath();
    ctx.moveTo(cx - w2, topY); ctx.lineTo(cx, topY + h2);
    ctx.lineTo(cx, botY + h2); ctx.lineTo(cx - w2, botY);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = rightC;
    ctx.beginPath();
    ctx.moveTo(cx, topY + h2); ctx.lineTo(cx + w2, topY);
    ctx.lineTo(cx + w2, botY); ctx.lineTo(cx, botY + h2);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = topC;
    ctx.beginPath();
    ctx.moveTo(cx, topY - h2); ctx.lineTo(cx + w2, topY);
    ctx.lineTo(cx, topY + h2); ctx.lineTo(cx - w2, topY);
    ctx.closePath(); ctx.fill();
  }

  function tick() {
    if (!anim) return;
    anim.raf = requestAnimationFrame(tick);
    var now = performance.now();
    if (now - anim.last < 32) return;
    anim.last = now;
    var ctx = $('riverfx').getContext('2d');
    var b = anim.box;
    ctx.clearRect(b.x, b.y, b.w, b.h);
    if (anim.mode === 'iso') tickIso(now, ctx);
    else tickTop(now, ctx);
  }

  // top-down: a moving sheen slides downstream over the baked river tiles; lava
  // tiles pulse orange. The overlay only tints — the terrain canvas is untouched.
  function tickTop(now, ctx) {
    var ts = anim.tile, rivers = anim.rivers, lavas = anim.lavas;
    var t = (now - anim.t0) / 1000;
    for (var k = 0; k < rivers.length; k++) {
      var r = rivers[k];
      var s = 0.5 + 0.5 * Math.sin(t * 3.0 - r.phase * 0.55);
      ctx.fillStyle = 'rgba(206,232,255,' + (0.06 + 0.20 * s).toFixed(3) + ')';
      ctx.fillRect(r.x, r.y, ts, ts);
    }
    for (var li = 0; li < lavas.length; li++) {
      var lv = lavas[li];
      var g = 0.5 + 0.5 * Math.sin(t * 1.6 - lv.phase);
      ctx.fillStyle = 'rgba(255,150,40,' + (0.12 + 0.42 * g).toFixed(3) + ')';
      ctx.fillRect(lv.x, lv.y, ts, ts);
    }
  }

  function tickIso(now, ctx) {
    var d = anim.d, w2 = d.w2, h2 = d.h2;
    var rivers = anim.rivers, rgb = anim.rgb;
    var slab = anim.lh * 0.42;
    var AMP = Math.min(4.5, anim.lh * 0.26);
    var K = 90, SPEED = 3.4;                   // crest travels toward lower ground
    var t = (now - anim.t0) / 1000 * SPEED;

    for (var k = 0; k < rivers.length; k++) {
      var r = rivers[k];
      var wave = Math.sin(t - r.elev * K);
      var sh = 0.86 + 0.26 * (0.5 + 0.5 * wave);
      prism(ctx, r.cx, r.cy - wave * AMP, r.cy + slab, w2, h2,
        shade(rgb, sh), shade(rgb, 0.68), shade(rgb, 0.5));
    }

    // lava: cubes hold still, only the glow pulses (phase by elevation so heat
    // sweeps along a flow); crest lerps toward white-hot
    var lrgb = anim.lavaRgb, lavas = anim.lavas;
    var LK = 70, LSPEED = 2.0, lslab = anim.lh * 0.5;
    var lt = (now - anim.t0) / 1000 * LSPEED;
    for (var li = 0; li < lavas.length; li++) {
      var lv = lavas[li];
      var glow = 0.5 + 0.5 * Math.sin(lt - lv.elev * LK);
      var tr = Math.round(lrgb[0] + (255 - lrgb[0]) * glow);
      var tg = Math.round(lrgb[1] + (240 - lrgb[1]) * glow);
      var tb = Math.round(lrgb[2] + (150 - lrgb[2]) * glow * 0.7);
      prism(ctx, lv.cx, lv.cy, lv.cy + lslab, w2, h2,
        'rgb(' + tr + ',' + tg + ',' + tb + ')',
        shade(lrgb, 0.32 + 0.14 * glow), shade(lrgb, 0.22 + 0.1 * glow));
    }
  }

  function drawContent() {
    stopAnim();
    if (view === 'iso') {
      content = SM.renderIso(map, grid, {
        tile: ISO_TILE,
        levelHeight: ISO_BASE_LH * isoExag(),
        sun: sunModel(parseFloat($('sun').value)).iso
      });
    } else {
      // shrink the tile for very large maps so the canvas stays GPU-friendly
      var tt = Math.max(3, Math.min(TOP_TILE,
        Math.floor(Math.sqrt(9e6 / (grid.width * grid.height)))));
      content = SM.renderTopDown(map, grid, {
        tile: tt,
        grid: $('showGrid').checked,
        shade: $('showShade').checked
      });
    }
  }

  // refit = force re-centering; otherwise the camera is kept unless the
  // content changed size (e.g. map dimensions or iso exaggeration).
  function refresh(refit) {
    if (!grid) return;
    drawContent();
    if (refit || content.width !== lastW || content.height !== lastH) fitCam();
    lastW = content.width;
    lastH = content.height;
    applyCam();
    startRiverAnim();
  }

  function regenerate() {
    var cfg = readConfig();
    var t0 = performance.now();
    grid = SM.generate(cfg);
    var dt = performance.now() - t0;
    undoStack = [];
    redoStack = [];
    updateUndoButtons();
    refresh(false);

    var s = SM.summarize(grid);
    statsBase =
      cfg.width + '×' + cfg.height + ' · ' +
      dt.toFixed(1) + ' ms · land ' + s.landPct + '%';
    $('stats').textContent = statsBase;
  }

  function setView(mode) {
    if (mode === view) return;
    view = mode;
    stopAnim();
    $('viewTop').classList.toggle('active', mode === 'top');
    $('viewIso').classList.toggle('active', mode === 'iso');
    document.body.classList.toggle('iso', mode === 'iso');
    hoverEl.hidden = true;
    hideBrushCursor();
    updateStageCursor();
    refresh(true);
  }

  function buildLegend() {
    var el = $('legend');
    el.innerHTML = '';
    SM.BIOME_LIST.forEach(function (b) {
      var row = document.createElement('div');
      row.className = 'legend-row';
      var sw = document.createElement('span');
      sw.className = 'sw';
      sw.style.background = b.color;
      row.appendChild(sw);
      row.appendChild(document.createTextNode(b.label));
      el.appendChild(row);
    });
  }

  function buildBiomeSelect() {
    var select = $('editBiome');
    select.innerHTML = '';
    SM.BIOME_LIST.forEach(function (b, i) {
      var option = document.createElement('option');
      option.value = i;
      option.textContent = b.label;
      select.appendChild(option);
    });
    select.value = SM.BIOME_IDX.grassland;
  }

  function syncEditControls() {
    var tool = $('editTool').value;
    $('brushStrength').disabled = tool !== 'raise' && tool !== 'lower' && tool !== 'smooth';
    $('editBiome').disabled = tool !== 'biome';
    updateStageCursor();
    hideBrushCursor();
  }

  // --- top-down brush editing ---
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  function isWaterBiome(biome) {
    return biome === SM.BIOME_IDX.deep_water || biome === SM.BIOME_IDX.shallow_water ||
      biome === SM.BIOME_IDX.river || biome === SM.BIOME_IDX.lake;
  }

  function updateStageCursor() {
    stage.classList.toggle('editing', view === 'top' && $('editTool').value !== 'pan');
  }

  function updateUndoButtons() {
    $('editUndo').disabled = undoStack.length === 0;
    $('editRedo').disabled = redoStack.length === 0;
  }

  function updateEditedStats() {
    $('stats').textContent = statsBase + (undoStack.length ? ' · (edited)' : '');
  }

  function makeEditRecord() {
    return {
      indices: [], elevation: [], level: [], water: [], biome: [], seen: {},
      minX: grid.width, minY: grid.height, maxX: -1, maxY: -1
    };
  }

  function captureTile(record, i) {
    var key = String(i);
    if (record.seen[key] != null) return;
    record.seen[key] = record.indices.length;
    record.indices.push(i);
    record.elevation.push(grid.elevation[i]);
    record.level.push(grid.level[i]);
    record.water.push(grid.water[i]);
    record.biome.push(grid.biome[i]);
    var x = i % grid.width, y = (i / grid.width) | 0;
    if (x < record.minX) record.minX = x;
    if (x > record.maxX) record.maxX = x;
    if (y < record.minY) record.minY = y;
    if (y > record.maxY) record.maxY = y;
  }

  function snapshotCurrent(indices) {
    var record = makeEditRecord();
    for (var k = 0; k < indices.length; k++) captureTile(record, indices[k]);
    return record;
  }

  function restoreRecord(record) {
    var inverse = snapshotCurrent(record.indices);
    for (var k = 0; k < record.indices.length; k++) {
      var i = record.indices[k];
      grid.elevation[i] = record.elevation[k];
      grid.level[i] = record.level[k];
      grid.water[i] = record.water[k];
      grid.biome[i] = record.biome[k];
    }
    return inverse;
  }

  function deriveTile(i, waterFromElevation) {
    if (waterFromElevation) {
      var wasWater = !!grid.water[i];
      grid.water[i] = grid.elevation[i] <= grid.seaThresh ? 1 : 0;
      if (!!grid.water[i] !== wasWater) {
        if (grid.water[i]) grid.biome[i] = SM.BIOME_IDX.shallow_water;
        else {
          var crossedLf = clamp01((grid.elevation[i] - grid.seaThresh) / grid.landSpan);
          grid.biome[i] = SM.classifyBiome(crossedLf, grid.moisture[i], grid.temperature[i]);
        }
      }
    }
    if (grid.water[i]) grid.level[i] = 0;
    else {
      var levels = (grid.config && grid.config.levels) || 10;
      var lf = clamp01((grid.elevation[i] - grid.seaThresh) / grid.landSpan);
      grid.level[i] = Math.round(Math.pow(lf, 0.82) * levels) + 1;
    }
  }

  function brushWeight(distance, radius) {
    var t = clamp01(1 - distance / radius);
    return t * t * (3 - 2 * t);
  }

  function applyBrushAt(tx, ty) {
    if (!editStroke) return;
    var tool = $('editTool').value;
    var radius = parseInt($('brushSize').value, 10);
    var strength = parseFloat($('brushStrength').value);
    var targets = [], x, y, dx, dy, distance, weight, i;
    var minX = Math.max(0, tx - radius), maxX = Math.min(grid.width - 1, tx + radius);
    var minY = Math.max(0, ty - radius), maxY = Math.min(grid.height - 1, ty + radius);
    for (y = minY; y <= maxY; y++) for (x = minX; x <= maxX; x++) {
      dx = x - tx; dy = y - ty; distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > radius) continue;
      weight = brushWeight(distance, radius);
      if (weight <= 0) continue;
      targets.push({ i: y * grid.width + x, weight: weight });
    }

    var smoothValues = null;
    if (tool === 'smooth') {
      smoothValues = [];
      for (var sk = 0; sk < targets.length; sk++) {
        i = targets[sk].i;
        x = i % grid.width; y = (i / grid.width) | 0;
        var sum = 0, count = 0;
        for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          var nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
          sum += grid.elevation[ny * grid.width + nx]; count++;
        }
        smoothValues.push(count ? sum / count : grid.elevation[i]);
      }
    }

    for (var k = 0; k < targets.length; k++) {
      i = targets[k].i; weight = targets[k].weight;
      captureTile(editStroke.record, i);
      if (tool === 'raise' || tool === 'lower') {
        var sign = tool === 'raise' ? 1 : -1;
        grid.elevation[i] = clamp01(grid.elevation[i] + sign * strength * 0.04 * weight);
        deriveTile(i, true);
      } else if (tool === 'smooth') {
        grid.elevation[i] += (smoothValues[k] - grid.elevation[i]) * strength * weight;
        deriveTile(i, true);
      } else if (tool === 'water') {
        var oldBiome = grid.biome[i], oldWater = grid.water[i];
        grid.water[i] = 1;
        grid.elevation[i] = Math.min(grid.elevation[i], grid.seaThresh - 0.02);
        if (!oldWater || (oldBiome !== SM.BIOME_IDX.deep_water &&
            oldBiome !== SM.BIOME_IDX.shallow_water && oldBiome !== SM.BIOME_IDX.river)) {
          grid.biome[i] = SM.BIOME_IDX.shallow_water;
        }
        deriveTile(i, false);
      } else if (tool === 'land') {
        grid.water[i] = 0;
        grid.elevation[i] = Math.max(grid.elevation[i], grid.seaThresh + 0.02);
        var landLf = clamp01((grid.elevation[i] - grid.seaThresh) / grid.landSpan);
        grid.biome[i] = SM.classifyBiome(landLf, grid.moisture[i], grid.temperature[i]);
        deriveTile(i, false);
      } else if (tool === 'biome') {
        grid.biome[i] = parseInt($('editBiome').value, 10);
        grid.water[i] = isWaterBiome(grid.biome[i]) ? 1 : 0;
        deriveTile(i, false);
      }
    }
    editStroke.lastX = tx;
    editStroke.lastY = ty;
  }

  function clampEditedTowers(record) {
    if (!record.indices.length) return;
    var w = grid.width, h = grid.height;
    var minX = Math.max(0, record.minX - 1), maxX = Math.min(w - 1, record.maxX + 1);
    var minY = Math.max(0, record.minY - 1), maxY = Math.min(h - 1, record.maxY + 1);
    for (var pass = 0; pass < 5; pass++) {
      var changes = [];
      for (var y = minY; y <= maxY; y++) for (var x = minX; x <= maxX; x++) {
        var i = y * w + x, cur = grid.level[i];
        if (grid.water[i] || cur <= 1) continue;
        var left = x > 0 ? grid.level[i - 1] : -9;
        var right = x < w - 1 ? grid.level[i + 1] : -9;
        var up = y > 0 ? grid.level[i - w] : -9;
        var down = y < h - 1 ? grid.level[i + w] : -9;
        var tallest = Math.max(left, right, up, down);
        if (cur > tallest + 1) changes.push({ i: i, level: tallest + 1 });
      }
      if (!changes.length) break;
      for (var k = 0; k < changes.length; k++) {
        captureTile(record, changes[k].i);
        grid.level[changes[k].i] = changes[k].level;
      }
    }
  }

  function finishEditStroke() {
    if (!editStroke) return;
    var record = editStroke.record;
    editStroke = null;
    clampEditedTowers(record);
    if (record.indices.length) {
      delete record.seen;
      undoStack.push(record);
      if (undoStack.length > 40) undoStack.shift();
      redoStack = [];
      updateUndoButtons();
      updateEditedStats();
      refresh(false);
    }
  }

  function undoEdit() {
    if (!undoStack.length || !grid) return;
    var record = undoStack.pop();
    redoStack.push(restoreRecord(record));
    updateUndoButtons(); updateEditedStats(); refresh(false);
  }

  function redoEdit() {
    if (!redoStack.length || !grid) return;
    var record = redoStack.pop();
    undoStack.push(restoreRecord(record));
    updateUndoButtons(); updateEditedStats(); refresh(false);
  }

  function eventTile(ev) {
    if (!content || !content.tile) return null;
    var rect = stage.getBoundingClientRect();
    var px = (ev.clientX - rect.left - cam.x) / cam.scale;
    var py = (ev.clientY - rect.top - cam.y) / cam.scale;
    var tx = Math.floor(px / content.tile), ty = Math.floor(py / content.tile);
    if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) return null;
    return { x: tx, y: ty };
  }

  function hideBrushCursor() { $('brushCursor').hidden = true; }

  function showBrushCursor(tile) {
    if (!tile || view !== 'top' || $('editTool').value === 'pan') { hideBrushCursor(); return; }
    var radius = parseInt($('brushSize').value, 10), ts = content.tile * cam.scale;
    var cursor = $('brushCursor');
    cursor.style.left = (cam.x + (tile.x + 0.5 - radius) * ts) + 'px';
    cursor.style.top = (cam.y + (tile.y + 0.5 - radius) * ts) + 'px';
    cursor.style.width = (radius * 2 * ts) + 'px';
    cursor.style.height = (radius * 2 * ts) + 'px';
    cursor.hidden = false;
  }

  function onHover(ev) {
    if (view !== 'top' || !grid || drag || editStroke || !content || !content.tile) return;
    var tile = eventTile(ev);
    showBrushCursor(tile);
    if (!tile) {
      hoverEl.hidden = true;
      return;
    }
    var tx = tile.x, ty = tile.y;
    var i = grid.index(tx, ty);
    var b = SM.BIOME_LIST[grid.biome[i]];
    if (!b) { hoverEl.hidden = true; return; }
    var m = SM.elevationMeters(grid, i);
    hoverEl.hidden = false;
    hoverEl.innerHTML =
      '<span class="sw" style="background:' + b.color + '"></span>' +
      b.label + ' · (' + tx + ', ' + ty + ')' +
      ' · ' + (m >= 0 ? '+' : '') + m + ' m' +
      ' · moist ' + grid.moisture[i].toFixed(2) +
      ' · ' + Math.round(-8 + grid.temperature[i] * 42) + '°C';
  }

  // --- camera drag / wheel (both views) ---
  function onDown(ev) {
    if (ev.button === 0 && view === 'top' && grid && $('editTool').value !== 'pan') {
      var tile = eventTile(ev);
      if (!tile) return;
      ev.preventDefault();
      editStroke = { record: makeEditRecord(), lastX: tile.x, lastY: tile.y };
      applyBrushAt(tile.x, tile.y);
      hoverEl.hidden = true;
      showBrushCursor(tile);
      return;
    }
    drag = { x: ev.clientX, y: ev.clientY };
    stage.classList.add('dragging');
    hoverEl.hidden = true;
    hideBrushCursor();
  }
  function onMove(ev) {
    if (editStroke) {
      var tile = eventTile(ev);
      showBrushCursor(tile);
      if (!tile) return;
      var dx = tile.x - editStroke.lastX, dy = tile.y - editStroke.lastY;
      var distance = Math.sqrt(dx * dx + dy * dy);
      var step = Math.max(0.5, parseInt($('brushSize').value, 10) * 0.5);
      var samples = Math.max(1, Math.ceil(distance / step));
      var fromX = editStroke.lastX, fromY = editStroke.lastY;
      for (var s = 1; s <= samples; s++) {
        applyBrushAt(Math.round(fromX + dx * s / samples), Math.round(fromY + dy * s / samples));
      }
      return;
    }
    if (!drag) return;
    cam.x += ev.clientX - drag.x;
    cam.y += ev.clientY - drag.y;
    drag.x = ev.clientX;
    drag.y = ev.clientY;
    applyCam();
  }
  function onUp() {
    if (editStroke) finishEditStroke();
    drag = null;
    stage.classList.remove('dragging');
  }
  function onWheel(ev) {
    if (!content) return;
    ev.preventDefault();
    var rect = stage.getBoundingClientRect();
    var mx = ev.clientX - rect.left;
    var my = ev.clientY - rect.top;
    var factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
    var next = Math.max(0.1, Math.min(6, cam.scale * factor));
    var k = next / cam.scale;
    cam.x = mx - (mx - cam.x) * k;
    cam.y = my - (my - cam.y) * k;
    cam.scale = next;
    applyCam();
    hideBrushCursor();
  }

  // paint the accent-fill portion of a range track (webkit needs a gradient)
  function paintRange(input) {
    var min = parseFloat(input.min), max = parseFloat(input.max);
    var pct = (parseFloat(input.value) - min) / (max - min) * 100;
    input.style.setProperty('--fill', pct.toFixed(1) + '%');
  }

  var QS_KEYS = ['seed', 'size', 'sea', 'rugged', 'warp', 'escale', 'octaves',
    'island', 'mscale', 'tbias', 'mbias', 'rivers', 'isoexag', 'sun'];

  function applyQueryString() {
    if (!location.search) return;
    var q = new URLSearchParams(location.search);
    QS_KEYS.forEach(function (id) {
      if (q.has(id)) $(id).value = q.get(id);
    });
    if (q.get('view') === 'iso') {
      view = 'iso';
      $('viewTop').classList.remove('active');
      $('viewIso').classList.add('active');
      document.body.classList.add('iso');
    }
  }

  function shareLink() {
    var q = new URLSearchParams();
    QS_KEYS.forEach(function (id) { q.set(id, $(id).value); });
    q.set('view', view);
    var url = location.origin + location.pathname + '?' + q.toString();
    var btn = $('shareLink'), old = btn.textContent;
    function done(txt) { btn.textContent = txt; btn.classList.add('ok');
      setTimeout(function () { btn.textContent = old; btn.classList.remove('ok'); }, 1400); }
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { done('Copied'); }, function () { done('Copy failed'); });
    else done('—');
  }

  function exportPng() {
    var out = document.createElement('canvas');
    out.width = map.width; out.height = map.height;
    var octx = out.getContext('2d');
    octx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg') || '#0f1216';
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(map, 0, 0);
    var fx = $('riverfx');
    if (view === 'iso' && fx.width) octx.drawImage(fx, 0, 0);
    var a = document.createElement('a');
    a.download = 'stilizedmaps-' + view + '-' + $('seed').value + '.png';
    a.href = out.toDataURL('image/png');
    a.click();
  }

  // --- wiring ---
  Object.keys(SLIDERS).forEach(function (id) {
    var cfg = SLIDERS[id];
    var input = $(id);
    var out = $(cfg.label);
    if (input.type === 'range') paintRange(input);
    input.addEventListener('input', function () {
      out.textContent = cfg.fmt(input.value);
      if (input.type === 'range') paintRange(input);
    });
  });
  ['size', 'sea', 'rugged', 'warp', 'escale', 'octaves', 'island', 'mscale', 'tbias', 'mbias', 'rivers']
    .forEach(function (id) { $(id).addEventListener('change', regenerate); });
  $('isoexag').addEventListener('change', function () { refresh(true); });
  $('sun').addEventListener('input', applyDayNight);
  $('sun').addEventListener('change', function () {
    if (view === 'iso') refresh(false);   // re-bake the shadows
    applyDayNight();
  });

  $('regen').addEventListener('click', regenerate);
  $('seed').addEventListener('change', regenerate);
  $('randomSeed').addEventListener('click', function () {
    $('seed').value = Math.floor(Math.random() * 1e6);
    regenerate();
  });
  $('showGrid').addEventListener('change', function () { refresh(false); });
  $('showShade').addEventListener('change', function () { refresh(false); });
  $('editTool').addEventListener('change', syncEditControls);
  $('brushSize').addEventListener('input', hideBrushCursor);
  $('editUndo').addEventListener('click', undoEdit);
  $('editRedo').addEventListener('click', redoEdit);
  $('editReset').addEventListener('click', regenerate);
  $('viewTop').addEventListener('click', function () { setView('top'); });
  $('viewIso').addEventListener('click', function () { setView('iso'); });
  $('exportPng').addEventListener('click', exportPng);
  $('shareLink').addEventListener('click', shareLink);
  window.addEventListener('resize', function () { if (grid) applyCam(); });

  map.addEventListener('mousemove', onHover);
  stage.addEventListener('mouseleave', function () {
    if (view === 'top') hoverEl.hidden = true;
    hideBrushCursor();
  });
  map.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  window.addEventListener('keydown', function (ev) {
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
    var key = (ev.key || '').toLowerCase();
    if (key === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) redoEdit(); else undoEdit();
    } else if (key === 'y') {
      ev.preventDefault(); redoEdit();
    }
  });
  stage.addEventListener('wheel', onWheel, { passive: false });

  hoverEl.hidden = true;
  applyQueryString();
  Object.keys(SLIDERS).forEach(function (id) {
    var input = $(id);
    if (input.type === 'range') { paintRange(input); $(SLIDERS[id].label).textContent = SLIDERS[id].fmt(input.value); }
  });
  buildLegend();
  buildBiomeSelect();
  syncEditControls();
  updateUndoButtons();
  regenerate();
  applyDayNight();
})(window.SM = window.SM || {});
