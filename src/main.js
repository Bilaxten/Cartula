/* Wiring: read the panel, generate, render top-down, hover readout. */
(function (SM) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('map');
  var hoverEl = $('hover');
  var grid = null;
  var lastTile = 8;

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

  function render() {
    if (!grid) return;
    lastTile = tileSize(grid.width);
    SM.renderTopDown(canvas, grid, {
      tile: lastTile,
      grid: $('showGrid').checked,
      shade: $('showShade').checked
    });
  }

  function regenerate() {
    var cfg = readConfig();
    var t0 = performance.now();
    grid = SM.generate(cfg);
    var dt = performance.now() - t0;
    render();

    var s = SM.summarize(grid);
    $('stats').textContent =
      cfg.width + '×' + cfg.height + ' · ' +
      dt.toFixed(1) + ' ms · kara %' + s.landPct;
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
    if (!grid) return;
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
  window.addEventListener('resize', render);

  canvas.addEventListener('mousemove', onHover);
  canvas.addEventListener('mouseleave', function () { hoverEl.hidden = true; });

  hoverEl.hidden = true;
  buildLegend();
  regenerate();
})(window.SM = window.SM || {});
