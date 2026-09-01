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

  // paint the accent-fill portion of a range track (webkit needs a gradient)
  function paintRange(input) {
    var min = parseFloat(input.min), max = parseFloat(input.max);
    var pct = (parseFloat(input.value) - min) / (max - min) * 100;
    input.style.setProperty('--fill', pct.toFixed(1) + '%');
  }

  var QS_KEYS = ['seed', 'size', 'sea', 'rugged', 'warp', 'escale', 'octaves',
    'island', 'mscale', 'tbias', 'mbias', 'rivers', 'isoexag'];

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
  $('exportPng').addEventListener('click', exportPng);
  $('shareLink').addEventListener('click', shareLink);
  window.addEventListener('resize', function () { if (grid) applyCam(); });

  map.addEventListener('mousemove', onHover);
  stage.addEventListener('mouseleave', function () { if (view === 'top') hoverEl.hidden = true; });
  map.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  stage.addEventListener('wheel', onWheel, { passive: false });

  hoverEl.hidden = true;
  applyQueryString();
  Object.keys(SLIDERS).forEach(function (id) {
    var input = $(id);
    if (input.type === 'range') { paintRange(input); $(SLIDERS[id].label).textContent = SLIDERS[id].fmt(input.value); }
  });
  buildLegend();
  regenerate();
})(window.SM = window.SM || {});
