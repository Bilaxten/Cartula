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
    size: { label: 'sizeVal', fmt: function (v) { return v; } },
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
    isoexag: { label: 'isoexagVal', fmt: function (v) { return (+v).toFixed(1); } }
  };

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

  // River flow runs on a SEPARATE overlay canvas (#riverfx) so the big terrain
  // canvas is never touched after the bake — the compositor keeps it cached and
  // pan/zoom stay free. Each river tile is a little water cube; a wave travels
  // downhill (phase driven by elevation) raising and lowering the cubes. Only
  // the per-tile dirty rects are cleared each frame. Capped ~30 fps.
  function startRiverAnim() {
    stopAnim();
    var r = content.rivers || [];
    var lv = content.lavas || [];
    if ((r.length + lv.length) === 0 || (r.length + lv.length) > 1400 ||
        map.width * map.height > 16e6) return;
    var fx = $('riverfx');
    fx.width = map.width;
    fx.height = map.height;
    fx.style.transform = map.style.transform;
    anim = {
      raf: 0, mode: view, rivers: r, lavas: lv,
      rgb: content.riverRgb, lavaRgb: content.lavaRgb || [226, 82, 29],
      d: content.diamond, tile: content.tile,
      lh: content.lh || 20, t0: performance.now(), last: 0
    };
    tick();
  }

  function shade(rgb, f) {
    return 'rgb(' + Math.round(rgb[0] * f) + ',' + Math.round(rgb[1] * f) + ',' + Math.round(rgb[2] * f) + ')';
  }

  function tick() {
    if (!anim) return;
    anim.raf = requestAnimationFrame(tick);
    var now = performance.now();
    if (now - anim.last < 32) return;
    anim.last = now;
    var ctx = $('riverfx').getContext('2d');
    if (anim.mode === 'iso') tickIso(now, ctx);
    else tickTop(now, ctx);
  }

  // top-down: a moving sheen slides downstream over the baked river tiles; lava
  // tiles pulse orange. The overlay only tints — the terrain canvas is untouched.
  function tickTop(now, ctx) {
    var ts = anim.tile;
    var rivers = anim.rivers, lavas = anim.lavas || [];
    var t = (now - anim.t0) / 1000;
    for (var k = 0; k < rivers.length; k++) {
      var r = rivers[k];
      ctx.clearRect(r.x, r.y, ts, ts);
      var s = 0.5 + 0.5 * Math.sin(t * 3.0 - r.phase * 0.55);
      ctx.fillStyle = 'rgba(206,232,255,' + (0.06 + 0.20 * s).toFixed(3) + ')';
      ctx.fillRect(r.x, r.y, ts, ts);
    }
    for (var li = 0; li < lavas.length; li++) {
      var lv = lavas[li];
      ctx.clearRect(lv.x, lv.y, ts, ts);
      var g = 0.5 + 0.5 * Math.sin(t * 1.6 - lv.phase);
      ctx.fillStyle = 'rgba(255,150,40,' + (0.12 + 0.42 * g).toFixed(3) + ')';
      ctx.fillRect(lv.x, lv.y, ts, ts);
    }
  }

  function tickIso(now, ctx) {
    var d = anim.d, w2 = d.w2, h2 = d.h2;
    var rivers = anim.rivers, rgb = anim.rgb;
    var slab = anim.lh * 0.42;                 // visible water body under the surface
    var AMP = Math.min(4.5, anim.lh * 0.26);   // wave height
    var K = 90, SPEED = 3.4;                   // downhill wave: crest moves to lower elevation
    var t = (now - anim.t0) / 1000 * SPEED;
    var padTop = AMP + h2 + 1, padBot = slab + h2 + 1;

    for (var k = 0; k < rivers.length; k++) {
      var r = rivers[k];
      ctx.clearRect(r.cx - w2 - 1, r.cy - padTop, w2 * 2 + 2, padTop + padBot);
      var wave = Math.sin(t - r.elev * K);
      var lift = wave * AMP;
      var cy = r.cy - lift;
      var botL = r.cy + slab;                   // cube bottom holds still
      var sh = 0.86 + 0.26 * (0.5 + 0.5 * wave);

      // left face
      ctx.fillStyle = shade(rgb, 0.68);
      ctx.beginPath();
      ctx.moveTo(r.cx - w2, cy); ctx.lineTo(r.cx, cy + h2);
      ctx.lineTo(r.cx, botL + h2); ctx.lineTo(r.cx - w2, botL);
      ctx.closePath(); ctx.fill();
      // right face
      ctx.fillStyle = shade(rgb, 0.5);
      ctx.beginPath();
      ctx.moveTo(r.cx, cy + h2); ctx.lineTo(r.cx + w2, cy);
      ctx.lineTo(r.cx + w2, botL); ctx.lineTo(r.cx, botL + h2);
      ctx.closePath(); ctx.fill();
      // top
      ctx.fillStyle = shade(rgb, sh);
      ctx.beginPath();
      ctx.moveTo(r.cx, cy - h2); ctx.lineTo(r.cx + w2, cy);
      ctx.lineTo(r.cx, cy + h2); ctx.lineTo(r.cx - w2, cy);
      ctx.closePath(); ctx.fill();
    }

    // --- lava: slow glowing swell, cooler crust dark, molten crest near-white ---
    var lavas = anim.lavas || [];
    var lrgb = anim.lavaRgb;
    var LAMP = Math.min(3, anim.lh * 0.16);
    var LK = 55, LSPEED = 1.4;
    var lt = (now - anim.t0) / 1000 * LSPEED;
    for (var li = 0; li < lavas.length; li++) {
      var lv = lavas[li];
      ctx.clearRect(lv.cx - w2 - 1, lv.cy - LAMP - h2 - 1, w2 * 2 + 2, LAMP + slab + h2 * 2 + 3);
      var lwave = Math.sin(lt - lv.elev * LK);
      var glow = 0.5 + 0.5 * lwave;                 // 0..1
      var lcy = lv.cy - lwave * LAMP;
      var lbot = lv.cy + slab;
      // crust sides — dark, barely lit
      ctx.fillStyle = shade(lrgb, 0.30);
      ctx.beginPath();
      ctx.moveTo(lv.cx - w2, lcy); ctx.lineTo(lv.cx, lcy + h2);
      ctx.lineTo(lv.cx, lbot + h2); ctx.lineTo(lv.cx - w2, lbot);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade(lrgb, 0.22);
      ctx.beginPath();
      ctx.moveTo(lv.cx, lcy + h2); ctx.lineTo(lv.cx + w2, lcy);
      ctx.lineTo(lv.cx + w2, lbot); ctx.lineTo(lv.cx, lbot + h2);
      ctx.closePath(); ctx.fill();
      // molten top — lerp lava -> bright yellow with the glow
      var tr = Math.round(lrgb[0] + (255 - lrgb[0]) * glow);
      var tg = Math.round(lrgb[1] + (230 - lrgb[1]) * glow * 0.9);
      var tb = Math.round(lrgb[2] + (90 - lrgb[2]) * glow * 0.5);
      ctx.fillStyle = 'rgb(' + tr + ',' + tg + ',' + tb + ')';
      ctx.beginPath();
      ctx.moveTo(lv.cx, lcy - h2); ctx.lineTo(lv.cx + w2, lcy);
      ctx.lineTo(lv.cx, lcy + h2); ctx.lineTo(lv.cx - w2, lcy);
      ctx.closePath(); ctx.fill();
    }
  }

  function drawContent() {
    stopAnim();
    if (view === 'iso') {
      content = SM.renderIso(map, grid, {
        tile: ISO_TILE,
        levelHeight: ISO_BASE_LH * isoExag()
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
    refresh(false);

    var s = SM.summarize(grid);
    $('stats').textContent =
      cfg.width + '×' + cfg.height + ' · ' +
      dt.toFixed(1) + ' ms · land ' + s.landPct + '%';
  }

  function setView(mode) {
    if (mode === view) return;
    view = mode;
    stopAnim();
    $('viewTop').classList.toggle('active', mode === 'top');
    $('viewIso').classList.toggle('active', mode === 'iso');
    document.body.classList.toggle('iso', mode === 'iso');
    hoverEl.hidden = true;
    refresh(true);
  }

  function buildLegend() {
    var el = $('legend');
    el.innerHTML = '<h2>Biomes</h2>';
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

  function onHover(ev) {
    if (view !== 'top' || !grid || drag || !content || !content.tile) return;
    var rect = stage.getBoundingClientRect();
    var mx = ev.clientX - rect.left;
    var my = ev.clientY - rect.top;
    var px = (mx - cam.x) / cam.scale;
    var py = (my - cam.y) / cam.scale;
    var tx = Math.floor(px / content.tile);
    var ty = Math.floor(py / content.tile);
    if (!(tx >= 0 && ty >= 0 && tx < grid.width && ty < grid.height)) {
      hoverEl.hidden = true;
      return;
    }
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
    drag = { x: ev.clientX, y: ev.clientY };
    stage.classList.add('dragging');
    hoverEl.hidden = true;
  }
  function onMove(ev) {
    if (!drag) return;
    cam.x += ev.clientX - drag.x;
    cam.y += ev.clientY - drag.y;
    drag.x = ev.clientX;
    drag.y = ev.clientY;
    applyCam();
  }
  function onUp() {
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
  }

  // --- wiring ---
  Object.keys(SLIDERS).forEach(function (id) {
    var cfg = SLIDERS[id];
    var input = $(id);
    var out = $(cfg.label);
    input.addEventListener('input', function () { out.textContent = cfg.fmt(input.value); });
  });
  ['size', 'sea', 'rugged', 'warp', 'escale', 'octaves', 'island', 'mscale', 'tbias', 'mbias', 'rivers']
    .forEach(function (id) { $(id).addEventListener('change', regenerate); });
  $('isoexag').addEventListener('change', function () { refresh(true); });

  $('regen').addEventListener('click', regenerate);
  $('seed').addEventListener('change', regenerate);
  $('randomSeed').addEventListener('click', function () {
    $('seed').value = Math.floor(Math.random() * 1e6);
    regenerate();
  });
  $('showGrid').addEventListener('change', function () { refresh(false); });
  $('showShade').addEventListener('change', function () { refresh(false); });
  $('viewTop').addEventListener('click', function () { setView('top'); });
  $('viewIso').addEventListener('click', function () { setView('iso'); });
  window.addEventListener('resize', function () { if (grid) applyCam(); });

  map.addEventListener('mousemove', onHover);
  stage.addEventListener('mouseleave', function () { if (view === 'top') hoverEl.hidden = true; });
  map.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  stage.addEventListener('wheel', onWheel, { passive: false });

  hoverEl.hidden = true;
  buildLegend();
  regenerate();
})(window.SM = window.SM || {});
