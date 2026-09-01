/* Wiring: read the panel, generate, render (top-down or isometric),
 * hover readout, iso pan/zoom. */
(function (SM) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('map');
  var stage = $('stage');
  var hoverEl = $('hover');
  var grid = null;
  var lastTile = 8;

  var view = 'top';            // 'top' | 'iso'
  var iso = null;              // baked { canvas, width, height }
  var isoScale = 1;
  var isoPan = { x: 0, y: 0 };
  var isoFitted = false;       // has the view been auto-centered for this bake
  var drag = null;

  var ISO_BAKE_TILE = 64;
  var ISO_LEVEL_H = 12;

  function signed(v) {
    var n = +v;
    return (n >= 0 ? '+' : '') + n.toFixed(2);
  }

  var SLIDERS = {
    size: { label: 'sizeVal', fmt: function (v) { return v; } },
    sea: { label: 'seaVal', fmt: function (v) { return Math.round((1 - v) * 100) + '%'; } },
    rugged: { label: 'ruggedVal', fmt: function (v) { return (+v).toFixed(2); } },
    escale: { label: 'escaleVal', fmt: function (v) { return (+v).toFixed(1); } },
    octaves: { label: 'octavesVal', fmt: function (v) { return v; } },
    island: { label: 'islandVal', fmt: function (v) { return (+v).toFixed(2); } },
    mscale: { label: 'mscaleVal', fmt: function (v) { return (+v).toFixed(1); } },
    tbias: { label: 'tbiasVal', fmt: signed },
    mbias: { label: 'mbiasVal', fmt: signed }
  };

  function readConfig() {
    var size = parseInt($('size').value, 10);
    return {
      width: size,
      height: size,
      seed: parseInt($('seed').value, 10) || 0,
      seaLevel: parseFloat($('sea').value),
      ruggedness: parseFloat($('rugged').value),
      elevationScale: parseFloat($('escale').value),
      octaves: parseInt($('octaves').value, 10),
      islandFalloff: parseFloat($('island').value),
      moistureScale: parseFloat($('mscale').value),
      temperatureBias: parseFloat($('tbias').value),
      moistureBias: parseFloat($('mbias').value)
    };
  }

  function tileSize(mapWidth) {
    var avail = Math.min(window.innerWidth - 340, window.innerHeight - 44);
    return Math.max(2, Math.floor(avail / mapWidth));
  }

  function renderTop() {
    lastTile = tileSize(grid.width);
    SM.renderTopDown(canvas, grid, {
      tile: lastTile,
      grid: $('showGrid').checked,
      shade: $('showShade').checked
    });
  }

  function renderIso() {
    if (!iso) {
      iso = SM.bakeIso(grid, { tile: ISO_BAKE_TILE, levelHeight: ISO_LEVEL_H });
      isoFitted = false;
    }
    var vw = stage.clientWidth, vh = stage.clientHeight;
    canvas.width = vw;
    canvas.height = vh;

    if (!isoFitted) {
      isoScale = Math.min(vw / iso.width, vh / iso.height) * 0.92;
      isoPan.x = (vw - iso.width * isoScale) / 2;
      isoPan.y = (vh - iso.height * isoScale) / 2;
      isoFitted = true;
    }

    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, vw, vh);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      iso.canvas, 0, 0, iso.width, iso.height,
      isoPan.x, isoPan.y, iso.width * isoScale, iso.height * isoScale
    );
  }

  function render() {
    if (!grid) return;
    if (view === 'iso') renderIso();
    else renderTop();
  }

  function regenerate() {
    var cfg = readConfig();
    var t0 = performance.now();
    grid = SM.generate(cfg);
    var dt = performance.now() - t0;
    iso = null; // invalidate the bake
    render();

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
    render();
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
    if (view !== 'top' || !grid || drag) return;
    var rect = canvas.getBoundingClientRect();
    var scaleX = canvas.width / rect.width;
    var scaleY = canvas.height / rect.height;
    var px = (ev.clientX - rect.left) * scaleX;
    var py = (ev.clientY - rect.top) * scaleY;
    var tx = Math.floor(px / lastTile);
    var ty = Math.floor(py / lastTile);
    if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) {
      hoverEl.hidden = true;
      return;
    }
    var i = grid.index(tx, ty);
    var b = SM.BIOME_LIST[grid.biome[i]];
    hoverEl.hidden = false;
    hoverEl.innerHTML =
      '<span class="sw" style="background:' + b.color + '"></span>' +
      b.label + ' · (' + tx + ', ' + ty + ')' +
      ' · yük ' + grid.elevation[i].toFixed(2) +
      ' · nem ' + grid.moisture[i].toFixed(2) +
      ' · sıc ' + grid.temperature[i].toFixed(2);
  }

  // --- iso pan / zoom ---
  function onDown(ev) {
    if (view !== 'iso') return;
    drag = { x: ev.clientX, y: ev.clientY };
    stage.classList.add('dragging');
  }
  function onMove(ev) {
    if (!drag) return;
    isoPan.x += ev.clientX - drag.x;
    isoPan.y += ev.clientY - drag.y;
    drag.x = ev.clientX;
    drag.y = ev.clientY;
    render();
  }
  function onUp() {
    drag = null;
    stage.classList.remove('dragging');
  }
  function onWheel(ev) {
    if (view !== 'iso' || !iso) return;
    ev.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var mx = ev.clientX - rect.left;
    var my = ev.clientY - rect.top;
    var factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
    var next = Math.max(0.15, Math.min(2.5, isoScale * factor));
    var k = next / isoScale;
    isoPan.x = mx - (mx - isoPan.x) * k;
    isoPan.y = my - (my - isoPan.y) * k;
    isoScale = next;
    render();
  }

  // --- wiring ---
  Object.keys(SLIDERS).forEach(function (id) {
    var cfg = SLIDERS[id];
    var input = $(id);
    var out = $(cfg.label);
    input.addEventListener('input', function () { out.textContent = cfg.fmt(input.value); });
    input.addEventListener('change', regenerate);
  });

  $('regen').addEventListener('click', regenerate);
  $('seed').addEventListener('change', regenerate);
  $('randomSeed').addEventListener('click', function () {
    $('seed').value = Math.floor(Math.random() * 1e6);
    regenerate();
  });
  $('showGrid').addEventListener('change', render);
  $('showShade').addEventListener('change', render);
  $('viewTop').addEventListener('click', function () { setView('top'); });
  $('viewIso').addEventListener('click', function () { setView('iso'); });
  window.addEventListener('resize', render);

  canvas.addEventListener('mousemove', onHover);
  canvas.addEventListener('mouseleave', function () { if (view === 'top') hoverEl.hidden = true; });
  canvas.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  hoverEl.hidden = true;
  buildLegend();
  regenerate();
})(window.SM = window.SM || {});
