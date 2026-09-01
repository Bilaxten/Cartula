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

  function isoExag() { return parseFloat($('isoexag').value); }

  function signed(v) {
    var n = +v;
    return (n >= 0 ? '+' : '') + n.toFixed(2);
  }

  var SLIDERS = {
    size: { label: 'sizeVal', fmt: function (v) { return v; } },
    sea: { label: 'seaVal', fmt: function (v) { return Math.round((1 - v) * 100) + '%'; } },
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
    map.style.transform =
      'translate(' + cam.x + 'px,' + cam.y + 'px) scale(' + cam.scale + ')';
  }

  function fitCam() {
    var sw = stage.clientWidth, sh = stage.clientHeight;
    cam.scale = Math.min(sw / content.width, sh / content.height) * 0.92;
    cam.x = (sw - content.width * cam.scale) / 2;
    cam.y = (sh - content.height * cam.scale) / 2;
  }

  function drawContent() {
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
      dt.toFixed(1) + ' ms · kara %' + s.landPct;
  }

  function setView(mode) {
    if (mode === view) return;
    view = mode;
    $('viewTop').classList.toggle('active', mode === 'top');
    $('viewIso').classList.toggle('active', mode === 'iso');
    document.body.classList.toggle('iso', mode === 'iso');
    hoverEl.hidden = true;
    refresh(true);
  }

  function buildLegend() {
    var el = $('legend');
    el.innerHTML = '<h2>Biyomlar</h2>';
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
    hoverEl.hidden = false;
    hoverEl.innerHTML =
      '<span class="sw" style="background:' + b.color + '"></span>' +
      b.label + ' · (' + tx + ', ' + ty + ')' +
      ' · yük ' + grid.elevation[i].toFixed(2) +
      ' · nem ' + grid.moisture[i].toFixed(2) +
      ' · sıc ' + grid.temperature[i].toFixed(2);
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
