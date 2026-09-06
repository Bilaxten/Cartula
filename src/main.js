/* Wiring: read the panel, generate, render (top-down or isometric), and drive
 * one shared camera. The map is drawn once onto #map at full resolution; the
 * camera is a CSS transform on that canvas, so pan and zoom never redraw. */
(function (SM) {
  'use strict';



  var $ = function (id) { return document.getElementById(id); };
  var map = $('map');
  var glCanvas = $('gl');
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
  var editedSinceRender = false;
  var editRenderTimer = 0;
  var statsBase = '';

  var TOP_TILE = 9;
  var ISO_TILE = 32;
  var ISO_BASE_LH = 13;

  var anim = null; // live overlay animation state

  var voxelRenderer = null;
  var voxelMesh = null;
  var voxelCamera = null;
  var voxelAnim = 0;
  var voxelDirty = false;
  var voxelTime = 0;
  var voxelTimeLast = 0;
  var voxelSnap = null;
  var voxelCameraQuery = null;
  var voxelBounds = null;
  var voxelNeedsFit = false;
  var voxelUnavailable = false;
  var voxelRotateLast = 0;          // auto-rotate's own frame timestamp, separate
                                     // from voxelTimeLast so toggling one doesn't
                                     // disturb the other's delta baseline
  var AUTOROTATE_DEG_PER_SEC = 5;   // one full turn every 72s -- "yavaş" per Uğur
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
    sun: { label: 'sunVal', fmt: SM.formatClock }
  };

  // Time of day -> shadow direction for the iso bake, plus a colour wash and a
  // canvas filter for the live look. Daylight is 6:00-18:00; outside that the
  // sun is below the horizon (night).
  function sunModel(hour) {
    hour = ((+hour % 24) + 24) % 24;
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
    glCanvas.style.filter = s.filter;
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

  // İzometrik görünüm ARTIK YALNIZCA WebGL voxel. Eski canvas iso yolu
  // (`?renderer=iso`, dört yönlü bake edilmiş 2D görüntü) 2026-09-06'da
  // tamamen kaldırıldı: voxel onu her açıdan ikame ediyordu, kendi bulut ve
  // animasyon katmanı da geldi, ve o yol hiçbir testle korunmuyordu.
  // 2D olarak yalnızca ÜSTTEN görünüm kaldı.
  function isVoxelMode() {
    return view === 'iso' && !voxelUnavailable;
  }

  function voxelAnimationEnabled() {
    return $('showAnim').checked;
  }

  var autoRotating = false;

  function autoRotateEnabled() {
    return autoRotating;
  }

  function setAutoRotate(on) {
    if (autoRotating === on) return;
    autoRotating = on;
    voxelRotateLast = 0;
    $('autoRotateBtn').setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) {
      voxelSnap = null; // don't fight an in-progress Q/E snap
      requestVoxelRender();
    } else if (voxelAnim && !voxelDirty && !voxelSnap && !voxelAnimationEnabled()) {
      cancelAnimationFrame(voxelAnim);
      voxelAnim = 0;
    }
  }

  function stopAutoRotate() {
    setAutoRotate(false);
  }

  function resizeVoxel() {
    if (!voxelRenderer) return;
    voxelRenderer.resize(stage.clientWidth, stage.clientHeight, window.devicePixelRatio || 1);
    requestVoxelRender();
  }

  function stopVoxel() {
    if (voxelAnim) { cancelAnimationFrame(voxelAnim); voxelAnim = 0; }
    voxelDirty = false;
    voxelTimeLast = 0;
    voxelSnap = null;
    glCanvas.hidden = true;
    map.hidden = false;
    $('riverfx').hidden = false;
    $('daynight').hidden = false;
    $('yawControl').hidden = true;
    $('cloudControl').hidden = false;
    $('showClouds').disabled = false;
    $('isohint').textContent = 'drag to pan \u00b7 scroll to zoom';
    updateRotationLabel();
  }

  function updateRotationLabel() {
    var yaw;

    if (isVoxelMode() && voxelCamera) {
      yaw = SM.VoxelCamera.wrapYaw(voxelCamera.yaw);
      $('rotSlider').value = String(Math.round(yaw));
      paintRange($('rotSlider'));
      $('rotVal').textContent = String(Math.round(yaw)).padStart(3, '0') + '°';
      return;
    }
    // Voxel yoksa izometrik de yok; gösterilecek bir açı kalmıyor.
    $('rotVal').textContent = '---';
  }

  function requestVoxelRender() {
    if (!voxelRenderer || !isVoxelMode()) return;
    voxelDirty = true;
    if (!voxelAnim) voxelAnim = requestAnimationFrame(renderVoxelFrame);
  }

  function renderVoxelFrame(now) {
    var elapsed;
    var eased;
    var delta;
    var frameSeconds;

    voxelAnim = 0;
    if (!voxelRenderer || !isVoxelMode()) return;
    if (voxelSnap) {
      elapsed = Math.min(1, (now - voxelSnap.started) / 220);
      eased = 1 - Math.pow(1 - elapsed, 3);
      delta = ((voxelSnap.target - voxelSnap.yaw + 540) % 360) - 180;
      voxelCamera.yaw = SM.VoxelCamera.wrapYaw(voxelSnap.yaw + delta * eased);
      voxelRenderer.setCamera(voxelCamera);
      updateRotationLabel();
      voxelDirty = true;
      if (elapsed === 1) voxelSnap = null;
    }
    if (voxelAnimationEnabled()) {
      if (!voxelTimeLast) voxelTimeLast = now;
      frameSeconds = Math.max(0, now - voxelTimeLast) / 1000;
      voxelTime += frameSeconds;
      voxelTimeLast = now;
      voxelRenderer.setTime(voxelTime);
      voxelDirty = true;
    } else {
      voxelTimeLast = 0;
    }
    if (autoRotateEnabled() && voxelCamera) {
      if (!voxelRotateLast) voxelRotateLast = now;
      frameSeconds = Math.max(0, now - voxelRotateLast) / 1000;
      voxelRotateLast = now;
      voxelCamera.yaw = SM.VoxelCamera.wrapYaw(
        voxelCamera.yaw + AUTOROTATE_DEG_PER_SEC * frameSeconds);
      voxelRenderer.setCamera(voxelCamera);
      updateRotationLabel();
      voxelDirty = true;
    } else {
      voxelRotateLast = 0;
    }
    if (!voxelDirty) return;
    voxelDirty = false;
    voxelRenderer.render();
    if (voxelSnap || voxelAnimationEnabled() || autoRotateEnabled()) {
      voxelAnim = requestAnimationFrame(renderVoxelFrame);
    }
  }

  function setVoxelCamera(next) {
    if (!voxelRenderer || !voxelCamera) return;
    voxelCamera.yaw = SM.VoxelCamera.wrapYaw(next.yaw);
    voxelCamera.pitch = SM.VoxelCamera.clampPitch(next.pitch);
    voxelCamera.zoom = Math.max(1, Math.min(1000, next.zoom));
    voxelCamera.tx = next.tx;
    voxelCamera.ty = next.ty;
    voxelCamera.tz = next.tz;
    voxelRenderer.setCamera(voxelCamera);
    updateRotationLabel();
    requestVoxelRender();
  }

  function snapVoxelCamera(dir) {
    var target;

    if (!isVoxelMode() || !voxelCamera) return;
    stopAutoRotate();
    target = SM.VoxelCamera.snapYaw(voxelCamera.yaw);
    target = SM.VoxelCamera.wrapYaw(target + dir * 90);
    voxelSnap = {
      yaw: voxelCamera.yaw,
      target: target,
      started: performance.now()
    };
    requestVoxelRender();
  }

  function startVoxel() {
    // ⚠️ ARTIK GERİ DÜŞÜLECEK BİR YOL YOK. Eski canvas iso renderer'ı silindi,
    // yani WebGL2 yoksa izometrik görünüm de yok. Sessizce üstten görünüme
    // düşmek yanlış olurdu (kullanıcı "izometrik" tuşuna basmışken üstten
    // görünüm görür ve nedenini bilmez), o yüzden durum AÇIKÇA söyleniyor.
    if (!SM.Voxel3D || !SM.Voxel3D.isSupported()) {
      if (!voxelUnavailable) console.warn('WebGL2 yok: izometrik gorunum kullanilamiyor.');
      voxelUnavailable = true;
      return false;
    }
    if (!voxelRenderer) {
      voxelRenderer = SM.Voxel3D.create(glCanvas);
      if (!voxelRenderer) {
        console.warn('WebGL2 baglami kurulamadi: izometrik gorunum kullanilamiyor.');
        voxelUnavailable = true;
        return false;
      }
      voxelRenderer.setClearColor(0.055, 0.075, 0.11, 1);
    }
    voxelRenderer.setTime(voxelTime);
    map.hidden = true;
    $('riverfx').hidden = true;
    $('daynight').hidden = false;
    $('yawControl').hidden = false;
    // M4: bulutlar artik voxel gorunumunde de var (gercek geometri + araziye
    // dusen golge), o yuzden kontrol burada gizlenmiyor. Anahtar bir GORUNURLUK
    // anahtari: hareketi `showAnim` yonetiyor, ikisi ayri sorular.
    $('cloudControl').hidden = false;
    $('showClouds').disabled = false;
    if (voxelRenderer.setSky) voxelRenderer.setSky($('showClouds').checked);
    glCanvas.hidden = false;
    $('isohint').textContent =
      'drag to orbit \u00b7 shift+drag to pan \u00b7 scroll to zoom \u00b7 Q/E snap';
    resizeVoxel();
    updateRotationLabel();
    return true;
  }

  function sameVoxelFootprint(a, b) {
    if (!a || !b) return false;
    return a.minX === b.minX && a.maxX === b.maxX &&
      a.minZ === b.minZ && a.maxZ === b.maxZ;
  }

  function rebuildVoxelMesh(forceFit) {
    var shouldFit;

    if (!voxelRenderer || !grid || !SM.buildVoxelMesh) return;
    voxelMesh = SM.buildVoxelMesh(grid);
    voxelRenderer.setVerticalScale(isoExag());
    updateVoxelSun();
    voxelRenderer.setMesh(voxelMesh);
    // Terrain edits can alter height, but only a new grid or XZ footprint
    // needs refitting.
    shouldFit = forceFit || voxelNeedsFit || !voxelCamera ||
      !sameVoxelFootprint(voxelBounds, voxelMesh.bounds);
    if (shouldFit) {
      voxelCamera = voxelRenderer.fitCamera(voxelMesh.bounds);
      if (voxelCameraQuery) {
        voxelCamera.yaw = voxelCameraQuery.yaw;
        voxelCamera.pitch = voxelCameraQuery.pitch;
        voxelCamera.zoom = voxelCameraQuery.zoom;
        voxelCameraQuery = null;
        voxelRenderer.setCamera(voxelCamera);
      }
    }
    voxelBounds = voxelMesh.bounds;
    voxelNeedsFit = false;
    updateRotationLabel();
    requestVoxelRender();
  }

  function updateVoxelSun() {
    var sun;

    if (!voxelRenderer || !grid || !SM.buildShadowMap) return;
    sun = sunModel(parseFloat($('sun').value)).iso;
    voxelRenderer.setSun(sun);
    voxelRenderer.setShadowMap(SM.buildShadowMap(grid, sun), grid.width, grid.height);
    requestVoxelRender();
  }


  function startRiverAnim() {
    stopAnim();
    var r = (content.rivers || []).slice();
    var lv = (content.lavas || []).slice();
    if ((r.length + lv.length) > 1600 || map.width * map.height > 16e6) return;

    var d = content.diamond, ts = content.tile, lh = content.lh || 20;
    var fx = $('riverfx');
    fx.width = map.width;
    fx.height = map.height;
    fx.style.transform = map.style.transform;
    anim = {
      raf: 0, mode: view, rivers: r, lavas: lv,
      rgb: content.riverRgb, lavaRgb: content.lavaRgb || [226, 82, 29],
      d: d, tile: ts, lh: lh, t0: performance.now(), last: 0,
      moveLast: 0
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
    var seconds = (now - anim.t0) / 1000;
    var sun = sunModel(parseFloat($('sun').value)).iso;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    // Bu overlay artık YALNIZCA üstten görünüme hizmet ediyor: izometrik
    // görünüm WebGL'de ve kendi animasyonunu (su dalgası, lav, foam, bulut,
    // kuş) shader'da yapıyor.
    tickTop(now, ctx);
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
  function drawContent() {
    if (editRenderTimer) { clearTimeout(editRenderTimer); editRenderTimer = 0; }
    stopAnim();
    // 2D artık YALNIZCA üstten görünüm. İzometrik canvas yolu (dört yönlü bake
    // edilmiş görüntü + rotasyon önbelleği) 2026-09-06'da kaldırıldı; izometrik
    // görünümü WebGL voxel çiziyor ve buraya hiç uğramıyor.
    //
    // shrink the tile for very large maps so the canvas stays GPU-friendly
    var tt = Math.max(3, Math.min(TOP_TILE,
      Math.floor(Math.sqrt(9e6 / (grid.width * grid.height)))));
    content = SM.renderTopDown(map, grid, {
      tile: tt,
      grid: $('showGrid').checked,
      shade: $('showShade').checked
    });
    editedSinceRender = false;
  }

  // refit = force re-centering; otherwise the camera is kept unless the
  // content changed size (e.g. map dimensions or iso exaggeration).

  function refresh(refit, fitVoxel) {
    if (!grid) return;
    if (isVoxelMode()) {
      if (startVoxel()) {
        rebuildVoxelMesh(fitVoxel);
        return;
      }
      // WebGL yok: izometrik çizilemez. Sessizce üstten görünüm çizmek yerine
      // görünümü de üstten görünüme ALIYORUZ, yoksa sekme "Isometric"te kalır
      // ama ekranda üstten harita durur -- kullanıcı için açıklanamaz bir hâl.
      view = 'top';
      $('viewTop').classList.add('active');
      $('viewIso').classList.remove('active');
      $('viewIso').disabled = true;
      $('viewIso').title = 'Bu tarayıcıda WebGL2 yok';
      document.body.classList.remove('iso');
    }
    stopVoxel();
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
    editedSinceRender = false;
    voxelNeedsFit = true;
    updateUndoButtons();
    refresh(true, true);

    var s = SM.summarize(grid);
    statsBase =
      cfg.width + '×' + cfg.height + ' · ' +
      dt.toFixed(1) + ' ms · land ' + s.landPct + '%';
    $('stats').textContent = statsBase;
  }

  function rotateView(dir) {
    // Q/E: yalnızca voxel kamerasını çeyrek tur döndürür. Eskiden burada
    // dört yönlü bake edilmiş 2D görüntüler arasında geçiş yapan bir önbellek
    // vardı; o yol kaldırıldı.
    if (view !== 'iso' || !grid || !isVoxelMode()) return;
    snapVoxelCamera(dir);
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
    // `river` de strength kullaniyor: yatagin banklarin ne kadar altina
    // oyulacagini o belirliyor (riverBedDrop).
    $('brushStrength').disabled = tool !== 'raise' && tool !== 'lower'
      && tool !== 'smooth' && tool !== 'river';
    $('editBiome').disabled = tool !== 'biome';
    updateStageCursor();
    hideBrushCursor();
  }

  // --- top-down brush editing ---
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function shade(rgb, f) {
    return 'rgb(' + Math.round(rgb[0] * f) + ',' +
      Math.round(rgb[1] * f) + ',' + Math.round(rgb[2] * f) + ')';
  }

  // Paint only changed top-down cells while a brush is live. The normal
  // renderer later cleans seams and re-adds global details in one idle pass.
  function paintEditedTiles(indices) {
    editedSinceRender = true;
    if (view !== 'top' || !content || !content.tile) return;
    var ctx = map.getContext('2d'), ts = content.tile;
    var hillshade = $('showShade').checked;
    for (var k = 0; k < indices.length; k++) {
      var i = indices[k];
      var x = i % grid.width, y = (i / grid.width) | 0;
      var c = hexToRgb(SM.BIOME_LIST[grid.biome[i]].color);
      ctx.fillStyle = shade(c, SM.biomeShade(grid, i));
      ctx.fillRect(x * ts, y * ts, ts, ts);
      if (hillshade && !grid.water[i]) {
        var eHere = grid.elevation[i];
        var eL = x > 0 ? grid.elevation[i - 1] : eHere;
        var eU = y > 0 ? grid.elevation[i - grid.width] : eHere;
        var a = ((eHere - eL) + (eHere - eU)) * 5;
        if (a > 0.18) a = 0.18;
        if (a < -0.18) a = -0.18;
        ctx.fillStyle = a > 0 ? 'rgba(255,255,255,' + a + ')' :
          'rgba(0,0,0,' + (-a) + ')';
        ctx.fillRect(x * ts, y * ts, ts, ts);
      }
    }
  }

  function scheduleEditedTopRender() {
    if (editRenderTimer) clearTimeout(editRenderTimer);
    editRenderTimer = setTimeout(function () {
      editRenderTimer = 0;
      if (!editedSinceRender || view !== 'top' || editStroke) return;
      content = SM.renderTopDown(map, grid, {
        tile: content.tile,
        grid: $('showGrid').checked,
        shade: $('showShade').checked
      });
      editedSinceRender = false;
      applyCam();
    }, 450);
  }

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
      // `lava` is captured too: the river tool clears it, so undo must be able
      // to bring it back. Without this the lava flag survived an undo and the
      // tile kept glowing under a restored volcano surface.
      indices: [], elevation: [], level: [], water: [], biome: [], lava: [], seen: {},
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
    record.lava.push(grid.lava ? grid.lava[i] : 0);
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
      if (grid.lava) grid.lava[i] = record.lava[k];
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

  // Pure half of the river tool lives in `grid.js` (`SM.planRiverChannel`) so it
  // can be verified under Node without a browser: `node tools/headless.js --river`.
  // What stays here is the part that needs the app -- undo capture, water/biome
  // flags, lava extinguishing and the repaint.
  function riverHalfWidth(radius) { return SM.riverHalfWidth(radius); }

  function carveRiverAt(tx, ty, radius, strength) {
    var plan = SM.planRiverChannel(grid, tx, ty, radius, strength);
    for (var k = 0; k < plan.indices.length; k++) {
      var i = plan.indices[k];
      captureTile(editStroke.record, i);
      grid.elevation[i] = plan.elevation[k];
      grid.water[i] = 1;
      grid.biome[i] = SM.BIOME_IDX.river;
      // Same rule the generator uses when a watercourse crosses a lava field
      // (`generate.js` step 7a): flowing water puts the lava out.
      if (grid.lava) grid.lava[i] = 0;
      // `deriveTile(i, false)`: water is already decided here, so the elevation
      // pass must not run -- it would re-derive `water` from the sea threshold
      // and turn this above-sea river back into dry land.
      deriveTile(i, false);
    }
    paintEditedTiles(plan.indices);
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

    // The river tool deliberately ignores the weighted disc above. A river is a
    // CHANNEL, not a pool: at brush size 12 a disc would paint a 25-tile-wide
    // body of water, which is what the `water` tool already does. Width here is
    // derived from brush size but stays narrow, and the bed is cut below its own
    // banks so the voxel view reads a carved valley rather than a flat blue strip.
    if (tool === 'river') {
        carveRiverAt(tx, ty, radius, strength);
        editStroke.lastX = tx;
        editStroke.lastY = ty;
        return;
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
    paintEditedTiles(targets.map(function (target) { return target.i; }));
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
      paintEditedTiles(record.indices);
      delete record.seen;
      undoStack.push(record);
      if (undoStack.length > 40) undoStack.shift();
      redoStack = [];
      updateUndoButtons();
      updateEditedStats();
      scheduleEditedTopRender();
    }
  }

  function undoEdit() {
    if (!undoStack.length || !grid) return;
    var record = undoStack.pop();
    redoStack.push(restoreRecord(record));
    paintEditedTiles(record.indices);
    updateUndoButtons(); updateEditedStats(); scheduleEditedTopRender();
  }

  function redoEdit() {
    if (!redoStack.length || !grid) return;
    var record = redoStack.pop();
    undoStack.push(restoreRecord(record));
    paintEditedTiles(record.indices);
    updateUndoButtons(); updateEditedStats(); scheduleEditedTopRender();
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
    // The river tool paints a narrow channel, not the full disc. Showing the disc
    // would make the cursor lie about what the next click does.
    if ($('editTool').value === 'river') radius = riverHalfWidth(radius) + 0.5;
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

  // --- camera drag / wheel ---
  function onDown(ev) {
    if (isVoxelMode()) {
      if (ev.button !== 0) return;
      ev.preventDefault();
      if (!ev.shiftKey) stopAutoRotate(); // pan doesn't touch yaw, orbit does
      drag = { x: ev.clientX, y: ev.clientY, voxel: true, pan: ev.shiftKey };
      stage.classList.add('dragging');
      return;
    }
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
    if (drag.voxel) {
      var dx = ev.clientX - drag.x;
      var dy = ev.clientY - drag.y;

      drag.x = ev.clientX;
      drag.y = ev.clientY;
      voxelSnap = null;
      if (drag.pan) {
        var pan = SM.VoxelCamera.panVector(
          voxelCamera.yaw,
          voxelCamera.pitch,
          voxelCamera.zoom,
          stage.clientWidth,
          dx,
          dy
        );
        setVoxelCamera({
          yaw: voxelCamera.yaw,
          pitch: voxelCamera.pitch,
          zoom: voxelCamera.zoom,
          tx: voxelCamera.tx + pan.x,
          ty: voxelCamera.ty,
          tz: voxelCamera.tz + pan.z
        });
      } else {
        setVoxelCamera({
          yaw: voxelCamera.yaw + dx * 360 / Math.max(1, stage.clientWidth),
          pitch: voxelCamera.pitch + dy * 180 / Math.max(1, stage.clientHeight), // Uğur: dikey eksen ters (2026-09-03)
          zoom: voxelCamera.zoom,
          tx: voxelCamera.tx,
          ty: voxelCamera.ty,
          tz: voxelCamera.tz
        });
      }
      return;
    }
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
    if (isVoxelMode() && voxelCamera) {
      ev.preventDefault();
      voxelSnap = null;
      setVoxelCamera({
        yaw: voxelCamera.yaw,
        pitch: voxelCamera.pitch,
        zoom: voxelCamera.zoom * (ev.deltaY < 0 ? 1 / 1.12 : 1.12),
        tx: voxelCamera.tx,
        ty: voxelCamera.ty,
        tz: voxelCamera.tz
      });
      return;
    }
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
    'island', 'mscale', 'tbias', 'mbias', 'rivers', 'isoexag', 'sun', 'yaw',
    'pitch', 'zoom'];

  function applyQueryValue(input, value) {
    var min;
    var max;
    var number;

    if (input.type !== 'range') {
      input.value = value;
      return;
    }
    number = parseFloat(value);
    if (!isFinite(number)) return;
    if (input.id === 'sun' && number >= 0 && number < 6) number += 24;
    min = parseFloat(input.min);
    max = parseFloat(input.max);
    input.value = Math.max(min, Math.min(max, number));
  }

  function applyQueryString() {
    // ⚠️ VARSAYILAN GÖRÜNÜM İZOMETRİK (WebGL voxel) ve bu bilinçli.
    // Bu fonksiyon bir zamanlar `!location.search` ise erken çıkıyordu, o yüzden
    // çıplak bir `index.html` yüklemesi `view = 'top'`ta kalıyor ve voxel hiç
    // devreye girmiyordu (2026-09-03'te düzeltildi) -- sessizce eski 2D render'a
    // düşen, konsolda izi olmayan bir hataydı. Erken çıkış geri EKLENMEMELİ.
    var q = location.search ? new URLSearchParams(location.search) : new URLSearchParams();
    QS_KEYS.forEach(function (id) {
      if (q.has(id) && $(id)) applyQueryValue($(id), q.get(id));
    });
    if (q.has('yaw') && q.has('pitch') && q.has('zoom')) {
      voxelCameraQuery = {
        yaw: SM.VoxelCamera.wrapYaw(q.get('yaw')),
        pitch: SM.VoxelCamera.clampPitch(q.get('pitch')),
        zoom: Math.max(1, Math.min(1000, +q.get('zoom')))
      };
    }
    // `view=top` açıkça istenmedikçe izometrik açılır.
    if (q.get('view') !== 'top') {
      view = 'iso';
      $('viewTop').classList.remove('active');
      $('viewIso').classList.add('active');
      document.body.classList.add('iso');
    }
  }

  function shareLink() {
    var q = new URLSearchParams();
    QS_KEYS.forEach(function (id) {
      if ($(id)) q.set(id, $(id).value);
    });
    q.set('view', view);
    if (isVoxelMode() && voxelCamera) {
      q.set('renderer', 'voxel');
      q.set('yaw', SM.VoxelCamera.wrapYaw(voxelCamera.yaw).toFixed(2));
      q.set('pitch', voxelCamera.pitch.toFixed(2));
      q.set('zoom', voxelCamera.zoom.toFixed(2));
    }
    var url = location.origin + location.pathname + '?' + q.toString();
    var btn = $('shareLink'), old = btn.textContent;
    function done(txt) { btn.textContent = txt; btn.classList.add('ok');
      setTimeout(function () { btn.textContent = old; btn.classList.remove('ok'); }, 1400); }
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { done('Copied'); }, function () { done('Copy failed'); });
    else done('—');
  }

  function exportPng() {
    var out;
    var octx;
    var fx;

    // ⚠️ İZOMETRİK EXPORT ARTIK ÇALIŞIYOR. Bu dal eskiden yalnızca
    // "not available yet (Faz 5)" diye uyarıp geri dönüyordu -- ve izometrik
    // VARSAYILAN görünüm olduğu için "Export PNG" düğmesi çoğu kullanıcı için
    // sessizce hiçbir şey yapmıyordu. Voxel renderer artık kendi karesini
    // okuyup veriyor (`capture`).
    if (isVoxelMode()) {
      out = voxelRenderer && voxelRenderer.capture ? voxelRenderer.capture() : null;
      if (!out) {
        console.warn('PNG export: WebGL karesi okunamadi.');
        return;
      }
    } else {
      out = document.createElement('canvas');
      out.width = map.width; out.height = map.height;
      octx = out.getContext('2d');
      octx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg') || '#0f1216';
      octx.fillRect(0, 0, out.width, out.height);
      octx.drawImage(map, 0, 0);
      // Nehir/lav parıltısı ayrı bir overlay canvas'ta; export onu da almalı.
      fx = $('riverfx');
      if (fx.width) octx.drawImage(fx, 0, 0);
    }
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
  $('isoexag').addEventListener('change', function () {
    if (isVoxelMode() && voxelRenderer && voxelMesh) {
      voxelRenderer.setVerticalScale(isoExag());
      requestVoxelRender();
    } else refresh(true);
  });
  $('sun').addEventListener('input', function () {
    applyDayNight();
    if (isVoxelMode()) updateVoxelSun();
  });
  $('sun').addEventListener('change', function () {
    if (!isVoxelMode() && view === 'iso') refresh(false); // re-bake shadows
    applyDayNight();
  });

  $('regen').addEventListener('click', regenerate);
  $('seed').addEventListener('change', regenerate);
  $('randomSeed').addEventListener('click', function () {
    $('seed').value = Math.floor(Math.random() * 1e6);
    regenerate();
  });
  $('showGrid').addEventListener('change', function () {
    if (view === 'top') refresh(false);
  });
  $('showShade').addEventListener('change', function () {
    if (view === 'top') refresh(false);
  });
  $('showClouds').addEventListener('change', function () {
    // Voxel: gorunurluk anahtari. Iso yolu bu kutuyu her karede kendisi
    // okuyor, orada dinleyiciye gerek yok.
    if (!isVoxelMode() || !voxelRenderer || !voxelRenderer.setSky) return;
    voxelRenderer.setSky(this.checked);
    requestVoxelRender();
  });
  $('showAnim').addEventListener('change', function () {
    if (!isVoxelMode()) return;
    voxelTimeLast = 0;
    if (this.checked) {
      requestVoxelRender();
    } else if (voxelAnim && !voxelDirty && !voxelSnap) {
      cancelAnimationFrame(voxelAnim);
      voxelAnim = 0;
    }
  });
  $('autoRotateBtn').addEventListener('click', function () {
    if (!isVoxelMode()) return;
    setAutoRotate(!autoRotating);
  });
  $('editTool').addEventListener('change', syncEditControls);
  $('brushSize').addEventListener('input', hideBrushCursor);
  $('editUndo').addEventListener('click', undoEdit);
  $('editRedo').addEventListener('click', redoEdit);
  $('editReset').addEventListener('click', regenerate);
  $('viewTop').addEventListener('click', function () { setView('top'); });
  $('viewIso').addEventListener('click', function () { setView('iso'); });
  $('rotSlider').addEventListener('input', function () {
    if (!isVoxelMode() || !voxelCamera) return;
    stopAutoRotate();
    voxelSnap = null;
    setVoxelCamera({
      yaw: parseFloat(this.value),
      pitch: voxelCamera.pitch,
      zoom: voxelCamera.zoom,
      tx: voxelCamera.tx,
      ty: voxelCamera.ty,
      tz: voxelCamera.tz
    });
  });
  $('exportPng').addEventListener('click', exportPng);
  $('shareLink').addEventListener('click', shareLink);
  window.addEventListener('resize', function () {
    if (isVoxelMode()) resizeVoxel();
    else if (grid) applyCam();
  });
  window.addEventListener('pagehide', function () {
    if (voxelAnim) { cancelAnimationFrame(voxelAnim); voxelAnim = 0; }
    if (voxelRenderer) voxelRenderer.dispose();
  });

  map.addEventListener('mousemove', onHover);
  stage.addEventListener('mouseleave', function () {
    if (view === 'top') hoverEl.hidden = true;
    hideBrushCursor();
  });
  map.addEventListener('mousedown', onDown);
  glCanvas.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  window.addEventListener('keydown', function (ev) {
    var target = ev.target;
    var tn = target && target.tagName;
    // Only text-editable fields swallow keys (seed's type=number legitimately
    // accepts "e" for scientific notation). A focused range slider (rotSlider
    // included) or select/checkbox has no letter-key behaviour of its own, so
    // it used to block Q/E globally just by holding focus -- clicking anything
    // in the panel silently killed the rotate shortcut. Bug found 2026-09-03.
    var textEditable = tn === 'TEXTAREA' || tn === 'SELECT' ||
      (tn === 'INPUT' && target.type !== 'range' && target.type !== 'checkbox');
    if (textEditable) return;
    var key = (ev.key || '').toLowerCase();
    if (ev.ctrlKey || ev.metaKey) {
      if (ev.altKey) return;
      if (key === 'z') { ev.preventDefault(); if (ev.shiftKey) redoEdit(); else undoEdit(); }
      else if (key === 'y') { ev.preventDefault(); redoEdit(); }
      return;
    }
    if (key === 'q') rotateView(-1);
    else if (key === 'e') rotateView(1);
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
