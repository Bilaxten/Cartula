/* Wiring: read the panel, generate, render top-down. */
(function (SM) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('map');
  var grid = null;

  var SLIDERS = {
    size: { label: 'sizeVal', fmt: function (v) { return v; } },
    sea: { label: 'seaVal', fmt: function (v) { return (+v).toFixed(2); } },
    escale: { label: 'escaleVal', fmt: function (v) { return (+v).toFixed(1); } },
    mtn: { label: 'mtnVal', fmt: function (v) { return (+v).toFixed(1); } },
    mscale: { label: 'mscaleVal', fmt: function (v) { return (+v).toFixed(1); } },
    island: { label: 'islandVal', fmt: function (v) { return (+v).toFixed(2); } }
  };

  function readConfig() {
    var size = parseInt($('size').value, 10);
    return {
      width: size,
      height: size,
      seed: parseInt($('seed').value, 10) || 0,
      seaLevel: parseFloat($('sea').value),
      elevationScale: parseFloat($('escale').value),
      mountainy: parseFloat($('mtn').value),
      moistureScale: parseFloat($('mscale').value),
      islandFalloff: parseFloat($('island').value)
    };
  }

  function tileSize(mapWidth) {
    var avail = Math.min(window.innerWidth - 340, window.innerHeight - 44);
    return Math.max(2, Math.floor(avail / mapWidth));
  }

  function render() {
    if (!grid) return;
    SM.renderTopDown(canvas, grid, {
      tile: tileSize(grid.width),
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

  buildLegend();
  regenerate();
})(window.SM = window.SM || {});
