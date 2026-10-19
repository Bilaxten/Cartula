/* Wiring: read the panel, generate, render (top-down or isometric), and drive
 * one shared camera. The map is drawn once onto #map at full resolution; the
 * camera is a CSS transform on that canvas, so pan and zoom never redraw. */
(function (SM) {
  'use strict';



  var $ = function (id) { return document.getElementById(id); };
  // UI strings (TR / EN) come from src/i18n.js; `T` and not `t` because `t`
  // is a common local name here (transforms, times).
  var T = SM.I18N.t;
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
  var lastStats = null;             // numbers of the last generation, for renderStats
  var isoHintKey = 'hint.top';      // what #isohint says, re-read on a language change

  var TOP_TILE = 9;

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
  // Performance panel (P). While hidden, nothing here runs per frame: no
  // timestamps, no counting in the renderer, no panel timer.
  var perf = {
    on: false,
    stats: SM.Perf.createFrameStats(120),
    lastFrameAt: 0,       // rAF timestamp of the previous drawn frame
    timer: 0              // panel repaint interval, only while visible
  };
  var AUTOROTATE_DEG_PER_SEC = 5;   // one full turn every 72s -- "yavaş" per Uğur
  function isoExag() { return parseFloat($('isoexag').value); }
  // Season slider (0 spring .. 3 winter): a view setting, never generation.
  function seasonValue() { return parseFloat($('season').value); }

  var SLIDERS = {
    size: { label: 'sizeVal', fmt: function (v) { return v + '²'; } },
    // Sea level is a percentile of a fixed reference area, and later passes
    // (lakes, island consolidation) move land further, so (1 - v) was never
    // the land share: the old label said "62% land" over a 70% land map. The
    // TRUE share is written after each generation (regenerate); while
    // dragging, the label keeps the last measured value.
    sea: { label: 'seaVal', fmt: function () { return $('seaVal').textContent; } },
    rugged: { label: 'ruggedVal', fmt: function (v) { return (+v).toFixed(2); } },
    warp: { label: 'warpVal', fmt: function (v) { return (+v).toFixed(2); } },
    escale: { label: 'escaleVal', fmt: function (v) { return (+v).toFixed(1); } },
    octaves: { label: 'octavesVal', fmt: function (v) { return v; } },
    island: { label: 'islandVal', fmt: function (v) { return +v === 0 ? T('island.off') : (+v).toFixed(2); } },
    tbias: { label: 'tbiasVal', fmt: function (v) {
      v = +v; return T(v <= -0.2 ? 'tbias.frozen' : v <= -0.08 ? 'tbias.cold' : v < 0.08 ? 'tbias.temperate' : v < 0.2 ? 'tbias.warm' : 'tbias.hot');
    } },
    mbias: { label: 'mbiasVal', fmt: function (v) {
      v = +v; return T(v <= -0.2 ? 'mbias.arid' : v <= -0.08 ? 'mbias.dry' : v < 0.08 ? 'mbias.normal' : v < 0.2 ? 'mbias.wet' : 'mbias.veryWet');
    } },
    rivers: { label: 'riversVal', fmt: function (v) {
      v = +v; return T(v === 0 ? 'rivers.none' : v < 1 ? 'rivers.few' : v === 1 ? 'rivers.normal' : v < 2 ? 'rivers.more' : 'rivers.many');
    } },
    brushSize: { label: 'brushSizeVal', fmt: function (v) { return v; } },
    brushStrength: { label: 'brushStrengthVal', fmt: function (v) { return (+v).toFixed(1); } },
    isoexag: { label: 'isoexagVal', fmt: function (v) { return (+v).toFixed(1); } },
    sun: { label: 'sunVal', fmt: SM.formatClock },
    // Season (season.js): render only, named by the nearest season.
    season: { label: 'seasonVal', fmt: function (v) {
      return T(['season.spring', 'season.summer', 'season.autumn', 'season.winter'][Math.round(+v)] || 'season.summer');
    } }
  };

  // Time of day -> sun for the voxel view, plus a colour wash and a canvas
  // filter for the live look. Daylight is 6:00-18:00; outside that the sun is
  // below the horizon (night). `iso.dx/dy` is the horizontal direction the
  // light TRAVELS (x east, y south): the lit faces, the cast shadow and the
  // cloud shadow all read it that way (voxel3d.js `setSun`/`buildShadowMap`).
  function sunModel(hour) {
    hour = ((+hour % 24) + 24) % 24;
    var day = (hour - 6) / 12;                    // 0 sunrise .. 1 sunset
    var up = day > 0 && day < 1;
    var elev = up ? Math.sin(day * Math.PI) : 0;  // 0 horizon .. 1 noon
    var iso = {
      dx: up ? Math.cos(day * Math.PI) : -0.6,    // travels east in the morning, west by evening
      dy: -0.35 - 0.45 * elev,                    // always travelling north (lit from the south)
      rise: 0.22 + 1.15 * elev,                   // low sun -> long shadows
      strength: up ? (0.16 + 0.26 * elev) : 0.05,
      night: SM.nightAmount(hour),                // lava light, night grade
      fog: SM.Fog ? SM.Fog.amount(hour) : 0       // valley fog (fog.js)
    };
    // The colour grade as numbers: a multiply wash (rgb 0..255, alpha) and a
    // brightness + saturate filter. Rounded exactly as the CSS strings are,
    // because the voxel view applies the same numbers in its shaders.
    var r2 = function (v) { return Math.round(v * 100) / 100; };
    var wash, alpha, bright, sat;
    if (!up) {                                    // night — deep blue, dim
      var nd = Math.min(1, (hour < 6 ? (6 - hour) : (hour - 18)) / 3); // dusk->deep
      wash = [34, 50, 102]; alpha = r2(0.4 + 0.24 * nd);
      bright = r2(0.78 - 0.16 * nd); sat = 0.82;
    } else if (elev < 0.55) {                      // golden hour — warm
      var w = 1 - elev / 0.55;                     // 1 at horizon, 0 mid-morning
      wash = [255, Math.round(178 - 40 * w), Math.round(120 - 30 * w)]; alpha = r2(0.05 + 0.26 * w);
      bright = r2(0.98 - 0.14 * w); sat = r2(1 + 0.14 * w);
    } else {                                       // midday — clear
      wash = [255, 250, 235]; alpha = 0;
      bright = 1.02; sat = 1;
    }
    return {
      iso: iso,
      overlay: 'rgba(' + wash.join(',') + ',' + alpha + ')',
      filter: 'brightness(' + bright + ') saturate(' + sat + ')',
      // #daynight is mix-blend-mode: multiply, so the wash scales each
      // channel by (1 - a + a * wash / 255).
      grade: {
        tint: wash.map(function (c) { return 1 - alpha + alpha * c / 255; }),
        brightness: bright,
        saturate: sat
      }
    };
  }

  /* The colour grade is the CSS wash (#daynight) + filter on the canvases,
   * except in the voxel view while the night lights are on (17:00-7:00):
   * then the SAME grade runs inside the shaders and the CSS pair is off for
   * the GL canvas. Night window lights and their bloom are light SOURCES;
   * under a CSS wash applied after WebGL they came out grey-brown
   * (2026-10-05), in the shader they are added after the grade. By day the
   * CSS path stays, because a per-fragment grade cost ~20% of a frame on
   * SwiftShader for nothing. The two grades differ by <= 4/255 (measured),
   * so the hand-over at 17:00 / 7:00 does not show. */
  function applyDayNight() {
    var s = sunModel(parseFloat($('sun').value));
    var inShader = !!(isVoxelMode() && voxelRenderer && voxelRenderer.setGrade &&
      s.iso.night > 0);
    $('daynight').style.background = inShader ? 'transparent' : s.overlay;
    map.style.filter = s.filter;
    $('riverfx').style.filter = s.filter;
    glCanvas.style.filter = inShader ? 'none' : s.filter;
    if (voxelRenderer && voxelRenderer.setGrade) {
      voxelRenderer.setGrade(inShader ? s.grade : null);
      requestVoxelRender();
    }
  }

  // The seed is the whole map (Uğur 2026-10-19): one code (src/seed.js) that
  // carries the random base AND every generation setting. `seedBase` is the
  // random half; the settings live in the controls and are folded into the
  // code whenever one moves, so the #seed field always shows the code of what
  // is on screen. Typing or pasting a code loads its settings into the
  // controls and generates. The map is a pure function of the code.
  var DEFAULT_BASE = 1337;
  var seedBase = DEFAULT_BASE;

  function currentSettings() {
    var s = {};
    SM.Seed.FIELDS.forEach(function (f) { s[f.id] = parseFloat($(f.id).value); });
    return s;
  }

  function currentSeedCode() { return SM.Seed.encode(seedBase, currentSettings()); }

  function hideSeedError() {
    $('seedMsg').hidden = true;
    $('seedMsg').textContent = '';
    $('seed').removeAttribute('aria-invalid');
  }

  var seedErrorKey = '';
  function showSeedError(code) {
    seedErrorKey = 'seed.err.' + code;
    $('seedMsg').textContent = T(seedErrorKey);
    $('seedMsg').hidden = false;
    $('seed').setAttribute('aria-invalid', 'true');
  }

  // Put the code of the current base + settings in the field.
  function syncSeedField() {
    seedErrorKey = '';
    hideSeedError();
    $('seed').value = currentSeedCode();
  }

  // Write decoded settings into the controls (sliders, labels, world type).
  function writeSettings(values) {
    SM.Seed.FIELDS.forEach(function (f) {
      var input = $(f.id);
      input.value = values[f.id];
      paintRange(input);
      if (SLIDERS[f.id]) $(SLIDERS[f.id].label).textContent = SLIDERS[f.id].fmt(input.value);
    });
    $('worldType').value = matchWorldType();
  }

  // Typed or pasted code: valid -> controls jump to its settings and the map
  // is generated; invalid -> a message, nothing else changes.
  function applySeedText(text) {
    var d = SM.Seed.decode(text);
    if (!d.ok) { showSeedError(d.error); return false; }
    seedBase = d.base;
    writeSettings(d.settings);
    syncSeedField();
    regenerate(true);
    return true;
  }

  function readConfig() {
    var size = parseInt($('size').value, 10);
    return {
      width: size,
      height: size,
      seed: seedBase,
      seedCode: currentSeedCode(),
      seaLevel: parseFloat($('sea').value),
      ruggedness: parseFloat($('rugged').value),
      warp: parseFloat($('warp').value),
      elevationScale: parseFloat($('escale').value),
      octaves: parseInt($('octaves').value, 10),
      islandFalloff: parseFloat($('island').value),
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

  // A phone gets its own hint (pinch, two fingers) instead of the mouse and
  // keyboard one; the key stays the base one so a language switch re-reads it.
  var coarseMq = window.matchMedia ? window.matchMedia('(hover: none) and (pointer: coarse)') : null;
  function hintKeyFor(key) {
    if (!(coarseMq && coarseMq.matches && (key === 'hint.top' || key === 'hint.iso'))) return key;
    return key + '.touch' + (touchPan ? '.pan' : '');
  }
  function setIsoHint(key) {
    isoHintKey = key;
    $('isohint').textContent = T(hintKeyFor(key));
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
    setIsoHint('hint.top');
    updateRotationLabel();
    applyDayNight();
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
    if (perf.on) renderMeasured(now);
    else voxelRenderer.render();
    if (voxelSnap || voxelAnimationEnabled() || autoRotateEnabled()) {
      voxelAnim = requestAnimationFrame(renderVoxelFrame);
    }
  }

  /* One measured frame. The interval is rAF-to-rAF between two frames that
   * were both drawn; a gap over 250 ms means rendering was idle (on-demand
   * mode), which is not a slow frame, so it only restarts the series. */
  function renderMeasured(now) {
    var t0 = performance.now();
    var gap = perf.lastFrameAt ? now - perf.lastFrameAt : NaN;
    var s;

    voxelRenderer.render();
    perf.stats.push(gap > 0 && gap < 250 ? gap : NaN, performance.now() - t0);
    perf.lastFrameAt = now;
    s = voxelRenderer.drainGpuTimes();
    for (var g = 0; g < s.length; g++) perf.stats.pushGpu(s[g]);
  }

  function perfRow(label, value) {
    var row = document.createElement('div');
    var a = document.createElement('span');
    var b = document.createElement('span');
    row.className = 'perf-row';
    a.textContent = label;
    b.textContent = value;
    row.appendChild(a);
    row.appendChild(b);
    return row;
  }

  function paintPerf() {
    var el = $('perfPanel');
    var title = document.createElement('div');
    var note = document.createElement('div');
    var rows = [];
    var sum;
    var st;
    var mb = function (n) { return (n / 1048576).toFixed(1); };
    var ms = function (n) { return n == null ? '–' : n.toFixed(1); };
    var locale = SM.I18N.lang() === 'tr' ? 'tr-TR' : 'en-US';

    title.className = 'perf-title';
    title.textContent = T('perf.title');
    note.className = 'perf-note';
    if (!isVoxelMode() || !voxelRenderer) {
      note.textContent = T('perf.isoOnly');
      el.replaceChildren(title, note);
      return;
    }
    sum = perf.stats.summary();
    st = voxelRenderer.stats();
    for (var g = 0; g < st.gpuMs.length; g++) perf.stats.pushGpu(st.gpuMs[g]);
    rows.push(perfRow(T('perf.frame'), T('perf.frameVal', { avg: ms(sum.avgMs), worst: ms(sum.worstMs) })));
    rows.push(perfRow(T('perf.fps'), sum.fps == null ? '–' : sum.fps.toFixed(1)));
    rows.push(perfRow(T('perf.cpu'), T('perf.cpuVal', { avg: ms(sum.cpuAvgMs) })));
    rows.push(perfRow(T('perf.gpu'), st.gpuTimer === 'no' ? T('perf.gpuNone') :
      T('perf.gpuVal', { avg: ms(sum.gpuAvgMs) })));
    rows.push(perfRow(T('perf.draws'), String(st.frame.draws)));
    rows.push(perfRow(T('perf.tris'), st.frame.tris.toLocaleString(locale)));
    rows.push(perfRow(T('perf.mem'), T('perf.memVal', { total: mb(st.memory.total + st.canvasBytes) })));
    rows.push(perfRow('', T('perf.memDetail', {
      b: mb(st.memory.buffer), t: mb(st.memory.texture + st.memory.renderbuffer), c: mb(st.canvasBytes)
    })));
    note.textContent = performance.now() - perf.lastFrameAt > 1000 ?
      T('perf.idle') : T('perf.window', { n: sum.frames });
    el.replaceChildren.apply(el, [title].concat(rows, [note]));
  }

  function setPerfVisible(on) {
    perf.on = !!on;
    $('showPerf').checked = perf.on;
    $('perfPanel').hidden = !perf.on;
    perf.stats.reset();
    perf.lastFrameAt = 0;
    if (voxelRenderer && voxelRenderer.setStatsEnabled) voxelRenderer.setStatsEnabled(perf.on);
    if (perf.timer) { clearInterval(perf.timer); perf.timer = 0; }
    if (perf.on) {
      paintPerf();
      perf.timer = setInterval(paintPerf, 500);
      // One frame so draw calls / triangles are known even when idle.
      requestVoxelRender();
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
      applyStageClear();
      // A renderer rebuilt after pagehide / context loss must pick up the
      // camera the user left, not its own default. `rebuildVoxelMesh` only
      // hands the camera over when it refits, and an unchanged footprint does
      // not refit.
      if (voxelCamera) voxelRenderer.setCamera(voxelCamera);
    }
    if (voxelRenderer.setDebugView) voxelRenderer.setDebugView(parseInt($('debugView').value, 10));
    if (voxelRenderer.setStatsEnabled) voxelRenderer.setStatsEnabled(perf.on);
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
    if (voxelRenderer.setWind) voxelRenderer.setWind($('showWind').checked);
    if (voxelRenderer.setWeather) voxelRenderer.setWeather($('showWeather').checked);
    if (voxelRenderer.setSeason) voxelRenderer.setSeason(seasonValue());
    // Lightning keeps its bolt but not its light flash (nor the flare, the
    // cloud glow, the shake) for reduced motion.
    if (voxelRenderer.setFlashLight) {
      voxelRenderer.setFlashLight(!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches));
    }
    glCanvas.hidden = false;
    setIsoHint('hint.iso');
    applyDayNight();
    resizeVoxel();
    updateRotationLabel();
    return true;
  }

  function sameVoxelFootprint(a, b) {
    if (!a || !b) return false;
    return a.minX === b.minX && a.maxX === b.maxX &&
      a.minZ === b.minZ && a.maxZ === b.maxZ;
  }

  // Wind, rain/snow and volcano smoke follow the terrain, so they are rebuilt
  // with the mesh (new map or brush edit). The wind field alone is ~170 ms at
  // 320², so the intro's worker builds all three (`pre`) and hands them over
  // once, when the sky appears (`pre.applied`).
  function applyVoxelEffects(pre) {
    if (pre && pre.applied) return;
    if (pre) pre.applied = true;
    if (SM.Wind && voxelRenderer.setWindField) {
      var windField = pre && pre.wind ? pre.wind : SM.Wind.field(grid, grid.config && grid.config.seed);
      voxelRenderer.setWindField(windField);
      // Rain and snow: zones and particles per map seed; snow drifts with
      // the same prevailing wind.
      if (SM.Weather && voxelRenderer.setWeatherData) {
        voxelRenderer.setWeatherData(pre && pre.weather ? pre.weather : SM.Weather.build(grid, grid.config && grid.config.seed),
          windField.prevailing);
      }
      // Volcano smoke: a plume per crater, bent by this same wind field.
      if (SM.Smoke && voxelRenderer.setSmokeData) {
        voxelRenderer.setSmokeData(pre && pre.smoke ? pre.smoke : SM.Smoke.build(grid, windField));
      }
    }
  }

  // `pre` (SM.buildIsoExtra's result): the isometric intro already built the
  // mesh and effects in the worker and handed the mesh to the renderer.
  function rebuildVoxelMesh(forceFit, pre) {
    var shouldFit;

    if (!voxelRenderer || !grid || !SM.buildVoxelMesh) return;
    voxelMesh = pre ? pre.mesh : SM.buildVoxelMesh(grid);
    voxelRenderer.setVerticalScale(isoExag());
    applyVoxelEffects(pre);
    if (pre) {
      // Sun shadow came with the mesh (same sun, the intro only runs a few
      // seconds); the sun direction itself is already set.
      requestVoxelRender();
    } else {
      updateVoxelSun();
      voxelRenderer.setMesh(voxelMesh);
    }
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

    var fx = $('riverfx');
    fx.width = map.width;
    fx.height = map.height;
    fx.style.transform = map.style.transform;
    anim = {
      raf: 0, rivers: r, lavas: lv,
      tile: content.tile, t0: performance.now(), last: 0
    };
    tick();
  }

  function tick() {
    if (!anim) return;
    anim.raf = requestAnimationFrame(tick);
    var now = performance.now();
    if (now - anim.last < 32) return;
    anim.last = now;
    var ctx = $('riverfx').getContext('2d');
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
  // shrink the tile for very large maps so the canvas stays GPU-friendly
  function topTile(w, h) {
    if (w == null) { w = grid.width; h = grid.height; }
    return Math.max(3, Math.min(TOP_TILE,
      Math.floor(Math.sqrt(9e6 / (w * h)))));
  }

  // --- pipeline step-through ---------------------------------------------
  // Re-runs the CURRENT map's config with a recorder and lets the viewer scrub
  // through SM.PIPELINE_STAGES. Top-down only; brushes, undo and hover are off
  // while it is open (they act on the final grid, not the stage on screen).
  var pipeline = null; // { snaps: [...], index }

  function enterPipeline() {
    if (!grid || pipeline) return;
    if (view !== 'top') setView('top');
    var byId = {};
    SM.generate(grid.config, function (id, snap) { byId[id] = snap; });
    var stages = SM.PIPELINE_STAGES;
    pipeline = {
      snaps: stages.map(function (st) { return byId[st.id]; }),
      index: stages.length - 1
    };
    $('stageSlider').max = String(stages.length - 1);
    $('stageControls').hidden = false;
    $('pipelineToggle').textContent = T('pipeline.exit');
    $('pipelineToggle').setAttribute('aria-pressed', 'true');
    hoverEl.hidden = true;
    hideBrushCursor();
    showStage(0);
  }

  function exitPipeline(skipRefresh) {
    if (!pipeline) return;
    pipeline = null;
    $('stageControls').hidden = true;
    $('pipelineToggle').textContent = T('pipeline.enter');
    $('pipelineToggle').setAttribute('aria-pressed', 'false');
    if (!skipRefresh) refresh(false);
  }

  function showStage(k) {
    var stages = SM.PIPELINE_STAGES;
    k = Math.max(0, Math.min(stages.length - 1, k));
    pipeline.index = k;
    var st = stages[k];
    stopAnim();
    content = SM.renderStage(map, pipeline.snaps[k], st, {
      tile: topTile(),
      grid: $('showGrid').checked,
      shade: $('showShade').checked
    });
    if (content.width !== lastW || content.height !== lastH) fitCam();
    lastW = content.width;
    lastH = content.height;
    applyCam();
    $('stageSlider').value = String(k);
    paintRange($('stageSlider'));
    updateStageText();
    $('stagePrev').disabled = k === 0;
    $('stageNext').disabled = k === stages.length - 1;
  }

  // Stage texts come from the dictionary by stage id (`label` / `desc` in
  // generate.js stay the English source); split out so a language change
  // can rewrite them without re-rendering the stage.
  function updateStageText() {
    if (!pipeline) return;
    var stages = SM.PIPELINE_STAGES, k = pipeline.index, st = stages[k];
    $('stageLabel').textContent = (k + 1) + ' / ' + stages.length + ' \u00b7 ' + T('stage.' + st.id + '.label');
    $('stageDesc').textContent = T('stage.' + st.id + '.desc');
  }

  function drawContent() {
    if (editRenderTimer) { clearTimeout(editRenderTimer); editRenderTimer = 0; }
    stopAnim();
    // 2D artık YALNIZCA üstten görünüm. İzometrik canvas yolu (dört yönlü bake
    // edilmiş görüntü + rotasyon önbelleği) 2026-09-06'da kaldırıldı; izometrik
    // görünümü WebGL voxel çiziyor ve buraya hiç uğramıyor.
    var tt = topTile();
    content = SM.renderTopDown(map, grid, {
      tile: tt,
      grid: $('showGrid').checked,
      shade: $('showShade').checked,
      season: seasonValue()
    });
    editedSinceRender = false;
  }

  // refit = force re-centering; otherwise the camera is kept unless the
  // content changed size (e.g. map dimensions or iso exaggeration).

  function refresh(refit, fitVoxel) {
    if (!grid) return;
    // grid lines / hillshade toggles re-render the STAGE while stepping through
    if (pipeline && view === 'top') { showStage(pipeline.index); return; }
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
      $('viewIso').title = T('view.noWebgl');
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

  // `animate`: a new map the user asked for (Random, a seed, a world type)
  // plays the loading animation on the voxel world, like the first load.
  // Slider tweaks stay instant: they are retried over and over. Not under
  // reduced motion, not in the top view, not with a camera link pending.
  function regenerate(animate) {
    cancelIntro();
    exitPipeline(true);
    var cfg = readConfig();
    var reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (animate === true && !reduced && isVoxelMode() && voxelRenderer && !voxelCameraQuery && startVoxelIntro(cfg, true)) return;
    var t0 = performance.now();
    var g = SM.generate(cfg);
    adoptGrid(g, cfg, performance.now() - t0, false);
  }

  // A finished grid becomes the map on screen: edit history reset, view drawn,
  // stats written. `reveal` (first load, isometric only) lets the voxel world
  // be printed in under an ink sweep instead of appearing at once.
  function adoptGrid(g, cfg, dt, reveal) {
    grid = g;
    undoStack = [];
    redoStack = [];
    editedSinceRender = false;
    voxelNeedsFit = true;
    updateUndoButtons();
    if (reveal && isVoxelMode() && startVoxel()) {
      map.hidden = false;                 // startVoxel hid it; it is the layer under the sweep
      glCanvas.style.clipPath = 'inset(0 0 100% 0)';
      rebuildVoxelMesh(true);
      introReveal = revealVoxel();
    } else {
      refresh(true, true);
    }

    var s = SM.summarize(grid);
    lastStats = { w: cfg.width, h: cfg.height, ms: dt.toFixed(1), landPct: s.landPct, editedLandPct: null };
    renderStats();
    if (performance.mark) performance.mark('sm-final-map');
  }

  // --- layered intro (first load) ------------------------------------------
  // The first map is generated in a worker (src/genclient.js) so the page is
  // painted and usable at once, and the recorded passes are printed as they
  // arrive (src/intro.js): ink sweep per pass, then the finished map. Anything
  // that changes the map (regenerate), a tap, a key press or
  // prefers-reduced-motion skips straight to the result.
  var intro = null;         // { run, player, grid, ms, cfg, tile, frameShown, iso }
  var introReveal = null;   // running voxel reveal, { finish() }

  function introLineEl() { return $('introLine'); }
  function placeLine(x, y, w) {
    var el = introLineEl();
    el.hidden = false;
    el.style.left = x + 'px';
    el.style.width = w + 'px';
    el.style.transform = 'translateY(' + y + 'px)';
  }

  // Pixels per cell of an intro frame: enough to look crisp at the size the
  // map is shown (refresh() draws the full-resolution render once it is final).
  function introTile(size) {
    var avail = Math.min(stage.clientWidth, stage.clientHeight) * (window.devicePixelRatio || 1) * 0.92;
    return Math.max(2, Math.min(topTile(size, size), Math.ceil(avail / size)));
  }

  function introEnsureMap(frame) {
    if (intro.frameShown) return;
    intro.frameShown = true;
    map.width = frame.width;
    map.height = frame.height;
    content = { width: frame.width, height: frame.height, tile: intro.tile, rivers: [], lavas: [] };
    fitCam();
    applyCam();
    map.hidden = false;
    $('riverfx').hidden = true;
    if (performance.mark) performance.mark('sm-first-map');
  }

  function introPaint(from, to, p) {
    var ctx = map.getContext('2d');
    var w = map.width, h = map.height;
    ctx.clearRect(0, 0, w, h);
    if (from) ctx.drawImage(from, 0, 0);
    if (p >= 1) { ctx.drawImage(to, 0, 0); return; }
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h * p);
    ctx.clip();
    ctx.drawImage(to, 0, 0);
    ctx.restore();
  }

  function introLine(p, frame) {
    if (p == null) { introLineEl().hidden = true; return; }
    placeLine(cam.x, cam.y + p * frame.height * cam.scale, frame.width * cam.scale);
  }

  function revealVoxel() {
    var t0 = 0, raf = 0, done = false;
    function end() {
      if (done) return;
      done = true;
      if (raf) cancelAnimationFrame(raf);
      glCanvas.style.clipPath = '';
      if (isVoxelMode()) map.hidden = true;
      introLineEl().hidden = true;
      introReveal = null;
    }
    function step(now) {
      raf = 0;
      if (!t0) t0 = now;
      var p = Math.min(1, (now - t0) / 520);
      var e = 1 - Math.pow(1 - p, 3);
      glCanvas.style.clipPath = 'inset(0 0 ' + ((1 - e) * 100).toFixed(2) + '% 0)';
      placeLine(0, e * stage.clientHeight, stage.clientWidth);
      if (p >= 1) end(); else raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    return { finish: end };
  }

  function cancelIntro() {
    if (introReveal) introReveal.finish();
    if (!intro) return;
    if (intro.vox) voxIntroTeardown();
    intro.run.cancel();
    intro.player.cancel();
    intro = null;
  }

  function introFinish(skipped) {
    var it = intro;
    intro = null;
    // The sweep only makes sense if the view is still isometric; otherwise the
    // map is drawn the ordinary way.
    adoptGrid(it.grid, it.cfg, it.ms, !skipped && it.iso);
  }

  function startIntro() {
    var cfg = readConfig();
    var reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    // Isometric (the default, where people wait): the loading animation is
    // played ON the 3D voxel world. A shared link with a camera, reduced
    // motion and a missing WebGL2 keep the plain path below.
    if (!reduced && isVoxelMode() && !voxelCameraQuery && startVoxelIntro(cfg)) return;
    var defs = {};
    SM.PIPELINE_STAGES.forEach(function (s) { defs[s.id] = s; });
    var MAP_STAGE = { view: 'map' };
    if (performance.mark) performance.mark('sm-generate-start');
    $('stats').textContent = T('gen.busy');

    var it = intro = { cfg: cfg, tile: introTile(cfg.width), frameShown: false, grid: null, ms: 0, iso: false };
    it.player = SM.Intro.createPlayer({
      paint: introPaint,
      line: introLine,
      final: introFinish
    });
    it.run = SM.GenClient.run(cfg, {
      stages: reduced ? [] : SM.Intro.PASSES,
      onStage: function (id, snap) {
        var c = document.createElement('canvas');
        SM.Intro.frame(c, snap, defs[id], it.tile);
        introEnsureMap(c);
        it.player.push(c);
      },
      onDone: function (g, ms) {
        if (performance.mark) performance.mark('sm-generated');
        it.grid = g;
        it.ms = ms;
        it.iso = isVoxelMode();
        if (reduced) it.player.skip();
        if (!it.iso && !reduced) {
          var c = document.createElement('canvas');
          SM.Intro.frame(c, g, MAP_STAGE, it.tile);
          introEnsureMap(c);
          it.player.push(c);
        }
        it.player.end();
      },
      onError: function () {
        // Generation itself threw in the worker: build the map the old,
        // synchronous way (which reports the error properly) rather than
        // leave the page empty.
        if (intro === it) regenerate();
      }
    });
  }

  // --- isometric intro: the loading screen IS the voxel world --------------
  // (Uğur 2026-10-19.) The camera stays isometric throughout. Colour comes
  // first, on the FLAT map; the relief rises afterwards:
  //   slab   a near-black (#131313) slab at the map's footprint with a dim
  //          light cell grid on it, seen from straight above (pitch 89, the 2D
  //          map's view), for the first 250 ms
  //   camera the camera tilts into the normal isometric one (1.2 s,
  //          smootherstep, same yaw so it does not spin). Nothing is coloured
  //          before it has arrived
  //   paint  the flat map takes its colours behind a hard, rough front that
  //          starts at the corners and edges and closes in somewhere near the
  //          middle, as an irregular blob rather than a circle (domain warp +
  //          fractal noise, decided per cell, so the edge follows the voxel
  //          grid): all colours at once (water is just coloured cells), the
  //          grid still visible. Until the finished map exists the colours are
  //          the worker's own passes (raw relief, land and sea, then biomes:
  //          SM.Intro.pixels), shown flat on the slab where it is painted and
  //          eased into one another; the mesh then starts from them and eases
  //          into its own colours
  //   grid   the grid lines fade out as the paint closes, overlapping the start of the rise
  //   rise   the relief starts to rise ~300 ms before the paint ends (over the
  //          closing blob), every column on its own
  //          clock (smootherstep each), in the paint's order reversed: where the
  //          paint closed last (the middle blob) rises first, the corners and
  //          edges it began with rise last. Water keeps
  //          its own level, so the land rises around the sea; lakes and
  //          rivers rise with their ground. Occlusion, cast shadow and swell
  //          shading ease in with the rise. Lava glows as it rises
  //   clouds grow in from the map centre out to the edges
  // then it IS the normal render (the uniforms land exactly on it). The rise
  // needs the mesh: the clock holds at GATE (flat, coloured map, breathing)
  // until it is there. Each worker pass that lands (stageShare of its time incl.
  // the mesh) says how long the rest will take; on a slow device the clock
  // before the gate runs slower so the paint fills the wait. A tap, a key, or a
  // new map skips to the end.
  var VI = { V0: 0.05, GATE: 2100, MIN_RATE: 0.4, MORPH: 700, IMG_FADE: 600,
    PAINT: [0, 2400], GRID: [2000, 2900], RISE: [2100, 3800], CLOUD: [3300, 4500], TILT: [250, 1450], TOP_PITCH: 89, END: 4500 };
  // PAINT .. END run on the timeline clock, which starts when the camera has
  // finished tilting (and a colour image or the mesh exists). TILT is in plain
  // milliseconds from the start: the black slab shows for TILT[0], the camera
  // then tilts into the isometric view, and nothing coloured shows before it.

  // The paint front's parameters (INTRO_FRONT_GLSL): a noise offset taken from
  // the map's seed (same map, same front) and 1 / the map's half diagonal, so
  // the front is a circle about the map centre: corners first, centre last.
  function introFront(cfg) {
    var seed = (cfg.seed >>> 0) % 4099;
    return [3 + (seed % 61) * 0.83, 5 + ((seed * 7) % 59) * 0.79, 2 / Math.max(Math.sqrt(cfg.width * cfg.width + cfg.height * cfg.height), 1)];
  }

  function smootherstep(x) { return x * x * x * (x * (x * 6 - 15) + 10); }
  function easeInOutSine(x) { return -(Math.cos(Math.PI * x) - 1) / 2; }
  function span(t, w) { return Math.max(0, Math.min(1, (t - w[0]) / (w[1] - w[0]))); }

  // A stand-in colour image from the worker arrived (RGBA, one texel per
  // cell): the first one appears as it is, later ones are eased into.
  function introImage(vi, px, w, h) {
    var data = new Uint8Array(px.buffer, px.byteOffset, px.length);
    var im = vi.img;
    if (!im) {
      vi.img = { w: w, h: h, cur: new Uint8Array(data), from: null, to: null, t0: 0 };
      voxelRenderer.setIntroImage(vi.img.cur, w, h);
      if (performance.mark) performance.mark('sm-image');
      return;
    }
    im.from = new Uint8Array(im.cur);
    im.to = new Uint8Array(data);
    im.t0 = performance.now();
  }

  // One step of the image ease (per frame, only while a new image arrives).
  function introImageStep(vi, now) {
    var im = vi.img;
    if (!im || !im.to) return;
    var k = easeInOutSine(span(now - im.t0, [0, VI.IMG_FADE])), i, n = im.cur.length;
    for (i = 0; i < n; i += 4) {
      im.cur[i] = im.from[i] + (im.to[i] - im.from[i]) * k;
      im.cur[i + 1] = im.from[i + 1] + (im.to[i + 1] - im.from[i + 1]) * k;
      im.cur[i + 2] = im.from[i + 2] + (im.to[i + 2] - im.from[i + 2]) * k;
    }
    voxelRenderer.setIntroImage(im.cur, im.w, im.h);
    if (k >= 1) im.to = im.from = null;
  }

  // `replay`: a new map while one is on screen (Random, a seed, a world type).
  // The old map is dropped first and the same animation plays.
  function startVoxelIntro(cfg, replay) {
    if (!SM.Voxel3D || !SM.Voxel3D.isSupported() || !SM.GenClient) return false;
    if (!startVoxel()) return false;
    if (replay) {
      grid = null;                    // like the first load: no map to act on until the new one is there
      voxelMesh = null;
      undoStack = [];
      redoStack = [];
      updateUndoButtons();
      voxelRenderer.clearMesh();
    }
    if (voxelRenderer.setEffects) voxelRenderer.setEffects(false);   // the old map's wind / rain / smoke
    if (voxelRenderer.setSkyGrow) voxelRenderer.setSkyGrow(0);
    var W = cfg.width, H = cfg.height;
    var sunDir = sunModel(parseFloat($('sun').value)).iso;
    if (performance.mark) performance.mark('sm-generate-start');
    $('stats').textContent = T('gen.busy');
    map.hidden = true;
    var finalScale = isoExag();
    // The camera the finished map will get, from a footprint estimate (levels
    // are 0..11 incl. the plinth); the real fit replaces it when the mesh lands.
    var est = { minX: -W / 2, maxX: W / 2, minY: -4, maxY: 11, minZ: -H / 2, maxZ: H / 2 };
    voxelRenderer.setVerticalScale(finalScale);
    voxelCamera = voxelRenderer.fitCamera(est);
    var camA = { yaw: voxelCamera.yaw, pitch: voxelCamera.pitch, zoom: voxelCamera.zoom,
      tx: voxelCamera.tx, ty: voxelCamera.ty, tz: voxelCamera.tz };
    // The scale stays final all through: the rise is per column, in the shaders.
    var sweep = introFront(cfg);
    voxelRenderer.setSun(sunDir);
    voxelRenderer.setCamera({ yaw: camA.yaw, pitch: VI.TOP_PITCH, zoom: camA.zoom, tx: camA.tx, ty: camA.ty, tz: camA.tz });
    voxelRenderer.setIntroSlab({ w: W, h: H, top: 1, bottom: -4 });
    voxelRenderer.setIntro({ paint: 0, grid: 1, light: 0, imageOn: 0, blend: 1, sweep: sweep, map: [W, H],
      rise: 0, invR: 2 / Math.sqrt(W * W + H * H), v0: VI.V0, meshBlend: 1 });
    if (voxelRenderer.setSky) voxelRenderer.setSky(false);

    var vi = { cfg: cfg, camA: camA, camB: camA, t0: performance.now(), tR0: 0, clock: 0, rate: 1, last: 0,
      amp: 1, tMesh: 0, sweep: sweep, img: null, staged: false, extra: null, g: null, ms: 0, raf: 0, skip: false,
      started: false, done: false, skyOn: false };
    var it = intro = { cfg: cfg, vox: vi, grid: null, ms: 0, iso: true };
    it.player = { skip: function () { vi.skip = true; if (vi.extra) voxIntroFinish(); }, cancel: function () {} };

    function lerpCam(a, b, k) {
      return { yaw: a.yaw, pitch: a.pitch, zoom: a.zoom + (b.zoom - a.zoom) * k,
        tx: a.tx + (b.tx - a.tx) * k, ty: a.ty + (b.ty - a.ty) * k, tz: a.tz + (b.tz - a.tz) * k };
    }

    function frame(now) {
      vi.raf = 0;
      if (vi.done || intro !== it) return;
      var dt = vi.last ? now - vi.last : 0;
      vi.last = now;
      // The paint starts once the minimum wait is over and either a colour
      // image or the mesh is there; until then the clock sits at 0.
      if (!vi.tR0 && now - vi.t0 >= VI.TILT[1] && (vi.img || vi.extra)) {
        vi.tR0 = now;
        if (performance.mark) performance.mark('sm-rise-start');
      }
      if (vi.extra && !vi.started) voxIntroStart(now);
      introImageStep(vi, now);
      // The timeline clock: stands at 0 until the paint starts, runs at `rate`
      // (slower than real time while a slow generation is being covered), and
      // holds at the gate until the mesh is there.
      if (vi.tR0) vi.clock += Math.min(dt, 100) * (vi.extra ? 1 : vi.rate);   // a long task must not eat the move
      if (!vi.extra && vi.clock > VI.GATE) vi.clock = VI.GATE;
      var t = vi.clock;
      var waiting = !vi.tR0 || (!vi.extra && t >= VI.GATE);
      vi.amp += ((waiting ? 1 : 0) - vi.amp) * Math.min(1, dt / 160);
      var riseP = span(t, VI.RISE);          // linear: the shaders ease each column
      var rise = smootherstep(riseP);        // the camera's and the lighting's share of the same move
      var paint = easeInOutSine(span(t, VI.PAINT));
      var gridAmt = 1 - easeInOutSine(span(t, VI.GRID));
      // The mesh starts from the stand-in colours and eases into its own.
      var cblend = vi.started ? smootherstep(span(now - vi.tMesh, [0, VI.MORPH])) : 1;
      voxelRenderer.setIntro({ paint: paint, grid: gridAmt, light: rise, rise: riseP, imageOn: vi.img ? 1 : 0, blend: cblend });
      var cam = lerpCam(camA, vi.camB, rise);
      // The camera looks straight down (like the 2D map) through the slab and
      // the paint, then tilts into the normal isometric one across the end of
      // the paint and the start of the rise. The yaw never changes, so the
      // tilt does not spin; the pitch ends exactly on the normal camera's.
      cam.pitch = VI.TOP_PITCH + (camA.pitch - VI.TOP_PITCH) * smootherstep(span(now - vi.t0, VI.TILT));
      // Waiting: a slow, low breath of the whole map (camera lift and a hair
      // of zoom, a sine, never a wave across it).
      var s = Math.sin((now - vi.t0) / 1000 * (Math.PI * 2 / 4.4)) * vi.amp;
      cam.ty += camA.zoom * 0.006 * s;
      cam.zoom *= 1 + 0.004 * s;
      voxelRenderer.setCamera(cam);
      if (vi.started && t >= VI.CLOUD[0]) {
        if (!vi.skyOn) {
          vi.skyOn = true;
          if (voxelRenderer.setSky) voxelRenderer.setSky($('showClouds').checked);
          applyIntroEffects(vi);
          if (voxelRenderer.setEffects) voxelRenderer.setEffects(true);
        }
        if (voxelRenderer.setSkyGrow) voxelRenderer.setSkyGrow(easeInOutSine(span(t, VI.CLOUD)));
      }
      requestVoxelRender();
      if (vi.started && t >= VI.END) { voxIntroFinish(); return; }
      vi.raf = requestAnimationFrame(frame);
    }
    vi.frame = frame;

    // The passes worth showing and how far into the worker's whole job (mesh
    // included) each one lands.
    var stageDefs = { sample: { view: 'height' }, sea: { view: 'sea' }, climate: { view: 'map' } };
    var stageShare = { sample: 0.083, sea: 0.136, climate: 0.2 };
    it.run = SM.GenClient.run(cfg, {
      stages: ['sample', 'sea', 'climate'],
      mesh: { sun: sunDir },
      onStage: function (id, snap) {
        if (intro !== it || vi.extra || !stageDefs[id]) return;
        introImage(vi, SM.Intro.pixels(snap, stageDefs[id]), snap.width, snap.height);
        // The worker has run stageShare[id] of its work, so the mesh is due in
        // about (now / share) from the start.
        vi.staged = true;
        var now = performance.now(), due = vi.t0 + (now - vi.t0) / stageShare[id];
        var start = Math.max(vi.tR0 || now, vi.t0 + VI.TILT[1]);
        vi.rate = Math.max(VI.MIN_RATE, Math.min(1, (VI.GATE - vi.clock) / Math.max(1, due - Math.max(now, start))));
      },
      onDone: function (g, ms, extra) {
        if (performance.mark) performance.mark('sm-generated');
        vi.g = g; vi.ms = ms; vi.extra = extra;
        if (!extra || !extra.mesh) { voxIntroTeardown(); intro = null; adoptGrid(g, cfg, ms, false); return; }
        it.grid = g;
        if (vi.skip) voxIntroFinish();
      },
      onError: function () { if (intro === it) regenerate(); }
    });
    vi.raf = requestAnimationFrame(frame);
    if (performance.mark) performance.mark('sm-first-map');
    return true;
  }

  // The mesh lands: it replaces the slab (flat, same colours, same light, same
  // place) and the sun shadow goes up with it.
  function voxIntroStart(now) {
    var vi = intro.vox, ex = vi.extra, g = vi.g;
    vi.started = true;
    if (ex.shadow) voxelRenderer.setShadowMap(ex.shadow, g.width, g.height);
    voxelRenderer.setMesh(ex.mesh);
    voxelRenderer.setIntroSlab(null);
    vi.tMesh = now;
    // The fit depends on the vertical scale, and the normal render fits at
    // the final one: fit at it too, or the camera ends the intro off by the
    // height difference and snaps into place when the intro hands over (the
    // "click" at the end, Uğur 2026-10-19).
    voxelRenderer.setVerticalScale(isoExag());
    var fit = voxelRenderer.fitCamera(ex.mesh.bounds);
    vi.camB = { yaw: fit.yaw, pitch: fit.pitch, zoom: fit.zoom, tx: fit.tx, ty: fit.ty, tz: fit.tz };
    if (performance.mark) performance.mark('sm-mesh-up');
  }

  function voxIntroTeardown() {
    var vi = intro && intro.vox;
    if (!vi) return;
    vi.done = true;
    if (vi.raf) cancelAnimationFrame(vi.raf);
    vi.raf = 0;
    if (voxelRenderer) {
      voxelRenderer.setIntro(null);
      voxelRenderer.setIntroSlab(null);
      // Whatever the tilt reached, the normal camera is the isometric one.
      voxelRenderer.setCamera({ yaw: vi.camA.yaw, pitch: vi.camA.pitch, zoom: vi.camA.zoom, tx: vi.camA.tx, ty: vi.camA.ty, tz: vi.camA.tz });
      if (voxelRenderer.setSkyGrow) voxelRenderer.setSkyGrow(null);
      if (voxelRenderer.setEffects) voxelRenderer.setEffects(true);
      voxelRenderer.setVerticalScale(isoExag());
      if (voxelRenderer.setSky) voxelRenderer.setSky($('showClouds').checked);
    }
  }

  // Wind lines, rain clouds and smoke join the sky (their data came from the
  // worker). They need the grid only for the weather's sake: set it now.
  function applyIntroEffects(vi) {
    if (vi.extra.applied) return;
    grid = vi.g;                   // effects read grid.config; edits stay off until the end (introGuard)
    applyVoxelEffects(vi.extra);
    grid = null;
  }

  // Every uniform lands on the normal render; the grid becomes the map.
  function voxIntroFinish() {
    var it = intro;
    if (!it || !it.vox || it.vox.done) return;
    var vi = it.vox, ex = vi.extra;
    if (!vi.started) voxIntroStart(performance.now());
    voxIntroTeardown();
    intro = null;
    grid = vi.g;
    undoStack = [];
    redoStack = [];
    editedSinceRender = false;
    voxelNeedsFit = true;
    updateUndoButtons();
    rebuildVoxelMesh(true, ex);
    var s = SM.summarize(grid);
    lastStats = { w: vi.cfg.width, h: vi.cfg.height, ms: vi.ms.toFixed(1), landPct: s.landPct, editedLandPct: null };
    renderStats();
    if (performance.mark) performance.mark('sm-final-map');
  }

  // While the first map is still being built there is no grid to act on: a tap
  // or key skips the animation, and the event goes no further.
  function introGuard(ev) {
    if (grid || !intro) return;
    intro.player.skip();
    ev.stopImmediatePropagation();
  }
  ['pointerdown', 'mousedown', 'touchstart', 'wheel'].forEach(function (type) {
    stage.addEventListener(type, introGuard, { capture: true, passive: true });
  });
  window.addEventListener('keydown', function (ev) {
    var tag = ev.target && ev.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || ev.key === 'Tab') return;
    introGuard(ev);
  }, true);

  function rotateView(dir) {
    // Q/E: yalnızca voxel kamerasını çeyrek tur döndürür. Eskiden burada
    // dört yönlü bake edilmiş 2D görüntüler arasında geçiş yapan bir önbellek
    // vardı; o yol kaldırıldı.
    if (view !== 'iso' || !grid || !isVoxelMode()) return;
    snapVoxelCamera(dir);
  }

  function setView(mode) {
    if (mode === view) return;
    if (mode === 'iso') exitPipeline(true);
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
      row.appendChild(document.createTextNode(T('biome.' + b.id)));
      el.appendChild(row);
    });
  }

  function buildBiomeSelect() {
    var select = $('editBiome');
    select.innerHTML = '';
    SM.BIOME_LIST.forEach(function (b, i) {
      var option = document.createElement('option');
      option.value = i;
      option.textContent = T('biome.' + b.id);
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

  // Paint only changed top-down cells while a brush is live. The normal
  // renderer later cleans seams and re-adds global details in one idle pass.
  function paintEditedTiles(indices) {
    editedSinceRender = true;
    if (view !== 'top' || !content || !content.tile) return;
    var ctx = map.getContext('2d'), ts = content.tile;
    var hillshade = $('showShade').checked;
    // Same painter the full render uses (topdown.js), so a brushed tile
    // already has its final colour.
    for (var k = 0; k < indices.length; k++) {
      SM.paintTopDownTile(ctx, grid, indices[k], ts, hillshade, seasonValue());
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
        shade: $('showShade').checked,
        season: seasonValue()
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
    stage.classList.toggle('editing', EDIT_ENABLED && view === 'top' && $('editTool').value !== 'pan');
  }

  function updateUndoButtons() {
    $('editUndo').disabled = undoStack.length === 0;
    $('editRedo').disabled = redoStack.length === 0;
  }

  function updateEditedStats() {
    if (!lastStats) return;
    // Show the REAL land fraction after brush edits, not the pristine generate
    // value of the last generation.
    lastStats.editedLandPct = undoStack.length ? SM.summarize(grid).landPct : null;
    renderStats();
  }

  // Sea level value + footer stats from the stored numbers, so a language
  // change can rewrite them without regenerating.
  function renderStats() {
    if (!lastStats) return;
    var edited = lastStats.editedLandPct != null;
    $('seaVal').textContent = T('sea.value', { pct: lastStats.landPct });
    $('stats').textContent = T('stats.base', {
      w: lastStats.w, h: lastStats.h, ms: lastStats.ms,
      pct: edited ? lastStats.editedLandPct : lastStats.landPct
    }) + (edited ? ' \u00b7 ' + T('stats.edited') : '');
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

  // Pure half lives in `grid.js` (`SM.deriveEditedTile`), verified under Node by
  // `node tools/headless.js --edit`.
  function deriveTile(i, prevElevation) {
    SM.deriveEditedTile(grid, i, prevElevation);
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
      // No previous elevation: water is already decided here, so only the
      // level is re-derived (a river sits at its own height, like land).
      deriveTile(i);
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
        var beforeRL = grid.elevation[i];
        grid.elevation[i] = clamp01(beforeRL + sign * strength * 0.04 * weight);
        deriveTile(i, beforeRL);
      } else if (tool === 'smooth') {
        var beforeSm = grid.elevation[i];
        grid.elevation[i] += (smoothValues[k] - beforeSm) * strength * weight;
        deriveTile(i, beforeSm);
      } else if (tool === 'water') {
        var oldBiome = grid.biome[i], oldWater = grid.water[i];
        grid.water[i] = 1;
        grid.elevation[i] = Math.min(grid.elevation[i], grid.seaThresh - 0.02);
        if (!oldWater || (oldBiome !== SM.BIOME_IDX.deep_water &&
            oldBiome !== SM.BIOME_IDX.shallow_water && oldBiome !== SM.BIOME_IDX.river)) {
          grid.biome[i] = SM.BIOME_IDX.shallow_water;
        }
        deriveTile(i);
      } else if (tool === 'land') {
        grid.water[i] = 0;
        grid.elevation[i] = Math.max(grid.elevation[i], grid.seaThresh + 0.02);
        var landLf = clamp01((grid.elevation[i] - grid.seaThresh) / grid.landSpan);
        grid.biome[i] = SM.classifyBiome(landLf, grid.moisture[i], grid.temperature[i]);
        deriveTile(i);
      } else if (tool === 'biome') {
        grid.biome[i] = parseInt($('editBiome').value, 10);
        grid.water[i] = isWaterBiome(grid.biome[i]) ? 1 : 0;
        deriveTile(i);
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
    // Waterfalls are geometry on the final levels: a stroke can create or
    // flatten one, and the voxel mesh reads the tags. Likewise the moss on
    // lakes beside marsh (a stroke can paint marsh or dig a lake); the idle
    // re-render repaints lake tiles outside the stroke.
    SM.tagWaterfalls(grid);
    SM.tagMossyLakes(grid);
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

  // Undo/Redo also work from the isometric view (Ctrl+Z / the panel buttons),
  // but both repaint paths above are top-down only. Without this the grid went
  // back while the voxel mesh and its shadow map kept showing the edit
  // (tarama 2026-09-22 #4).
  function afterHistoryStep(record) {
    SM.tagWaterfalls(grid);
    SM.tagMossyLakes(grid);
    paintEditedTiles(record.indices);
    updateUndoButtons(); updateEditedStats(); scheduleEditedTopRender();
    if (isVoxelMode() && voxelRenderer) rebuildVoxelMesh(false);
  }

  function undoEdit() {
    if (!EDIT_ENABLED || !undoStack.length || !grid || pipeline) return;
    var record = undoStack.pop();
    redoStack.push(restoreRecord(record));
    afterHistoryStep(record);
  }

  function redoEdit() {
    if (!EDIT_ENABLED || !redoStack.length || !grid || pipeline) return;
    var record = redoStack.pop();
    undoStack.push(restoreRecord(record));
    afterHistoryStep(record);
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

  // Space + drag pans in both views, whatever the tool (Uğur 2026-10-05), the
  // way image editors do it. While Space is held the stage shows grab /
  // grabbing (#stage.space-pan in style.css) and the brush cursor hides,
  // because the next drag moves the view instead of painting. Shift+drag in
  // the isometric view still pans as before.
  var spaceHeld = false;
  function setSpaceHeld(on) {
    if (spaceHeld === on) return;
    spaceHeld = on;
    stage.classList.toggle('space-pan', on);
    if (on) hideBrushCursor();
  }
  function isSpaceKey(ev) { return ev.code === 'Space' || ev.key === ' '; }

  function showBrushCursor(tile) {
    if (!EDIT_ENABLED || !tile || view !== 'top' || $('editTool').value === 'pan' || spaceHeld) { hideBrushCursor(); return; }
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
    if (pipeline) return; // hover reads the final grid, not the stage on screen
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
      T('biome.' + b.id) + ' · (' + tx + ', ' + ty + ')' +
      ' · ' + (m >= 0 ? '+' : '') + m + ' m' +
      ' · ' + T('hover.moist') + ' ' + grid.moisture[i].toFixed(2) +
      ' · ' + Math.round(-8 + grid.temperature[i] * 42) + '°C';
  }

  // --- camera drag / wheel ---
  function onDown(ev) {
    if (isVoxelMode()) {
      if (ev.button !== 0) return;
      ev.preventDefault();
      var pan = ev.shiftKey || spaceHeld;
      if (!pan) stopAutoRotate(); // pan doesn't touch yaw, orbit does
      drag = { x: ev.clientX, y: ev.clientY, voxel: true, pan: pan };
      stage.classList.add('dragging');
      return;
    }
    if (EDIT_ENABLED && ev.button === 0 && view === 'top' && grid && !pipeline && !spaceHeld &&
        $('editTool').value !== 'pan') {
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

  // The isometric view clears to an opaque colour (the WebGL canvas has
  // alpha: false), so it has to match the CSS stage background by hand:
  // dark = the old night blue, light = the middle of the daylight gradient.
  var STAGE_CLEAR = { dark: [0.055, 0.075, 0.11], light: [0.87, 0.93, 0.95] };

  // The clear colour the renderer has now, and a running crossfade.
  var stageClearNow = null;
  var stageFade = 0;

  /* `animate`: crossfade over 0.6 s (the CSS stage layers take the same
   * time), one cheap re-render per frame; instant otherwise or with
   * prefers-reduced-motion. */
  function applyStageClear(animate) {
    if (!voxelRenderer) return;
    var c = STAGE_CLEAR[document.documentElement.getAttribute('data-stage')] || STAGE_CLEAR.dark;
    var from = stageClearNow || c;
    var t0 = 0;
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (stageFade) { cancelAnimationFrame(stageFade); stageFade = 0; }
    if (!animate || reduce || !stageClearNow) {
      stageClearNow = c.slice();
      voxelRenderer.setClearColor(c[0], c[1], c[2], 1);
      return;
    }
    from = from.slice();
    stageFade = requestAnimationFrame(function step(now) {
      var k;
      var e;
      if (!t0) t0 = now;
      k = Math.min(1, (now - t0) / 600);
      e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;   // ease in-out
      stageClearNow = [0, 1, 2].map(function (j) { return from[j] + (c[j] - from[j]) * e; });
      if (voxelRenderer) {
        voxelRenderer.setClearColor(stageClearNow[0], stageClearNow[1], stageClearNow[2], 1);
        requestVoxelRender();
      }
      stageFade = k < 1 ? requestAnimationFrame(step) : 0;
    });
  }

  function applyStage(mode, animate) {
    document.documentElement.setAttribute('data-stage', mode === 'light' ? 'light' : 'dark');
    applyStageClear(animate);
    if (voxelRenderer) requestVoxelRender();
  }

  // Theme switch: html.theme-fade turns on the 0.6 s colour transitions in
  // the CSS for a moment (they are off otherwise, so hover stays quick).
  var themeFadeTimer = 0;
  function fadeTheme() {
    var root = document.documentElement;
    root.classList.add('theme-fade');
    clearTimeout(themeFadeTimer);
    themeFadeTimer = setTimeout(function () { root.classList.remove('theme-fade'); }, 700);
  }

  // `mscale` (Moisture scale) was removed from the panel 2026-09-23 -- the
  // weakest slider (20-25% of tiles) with a jargon name; old links carrying it
  // are simply ignored and the generator keeps its default.
  // Read: every key an old link may carry. Written (shareLink): the seed code
  // already holds the generation settings and the season, so only the code and
  // the two view settings that are not part of it.
  var QS_KEYS = ['size', 'sea', 'rugged', 'warp', 'escale', 'octaves',
    'island', 'tbias', 'mbias', 'rivers', 'isoexag', 'sun', 'season', 'yaw',
    'pitch', 'zoom'];
  var QS_SHARE = ['isoexag', 'sun'];

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
    // A seed code decides base and settings together. A bare number is an
    // old link: its own size/sea/... keys (read above) are its settings.
    var seedParam = q.get('seed'), seedBad = '';
    if (seedParam !== null) {
      var dec = SM.Seed.decode(seedParam);
      if (dec.ok) { seedBase = dec.base; writeSettings(dec.settings); }
      else if (/^\d{1,10}$/.test(seedParam.trim())) seedBase = parseInt(seedParam, 10) >>> 0;
      else seedBad = dec.error;
    }
    $('worldType').value = matchWorldType();
    syncSeedField();
    if (seedBad) showSeedError(seedBad);
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
    q.set('seed', currentSeedCode());
    QS_SHARE.forEach(function (id) {
      if ($(id)) q.set(id, $(id).value);
    });
    q.set('view', view);
    // No `renderer` key: nothing reads it (the isometric view is always the
    // voxel one since 2026-09-06). Old links that still carry
    // `renderer=voxel` open the same way: unknown keys are ignored.
    if (isVoxelMode() && voxelCamera) {
      q.set('yaw', SM.VoxelCamera.wrapYaw(voxelCamera.yaw).toFixed(2));
      q.set('pitch', voxelCamera.pitch.toFixed(2));
      q.set('zoom', voxelCamera.zoom.toFixed(2));
    }
    var url = location.origin + location.pathname + '?' + q.toString();
    var btn = $('shareLink');
    // Restored from the dictionary, not a saved copy: the language may change
    // during the 1.4 s.
    function done(txt) { btn.textContent = txt; btn.classList.add('ok');
      setTimeout(function () { btn.textContent = T('share.label'); btn.classList.remove('ok'); }, 1400); }
    // The link carries the generation SETTINGS + camera, not the brush edits —
    // opening it regenerates the pristine map. Say so instead of pretending.
    var okText = T(undoStack.length ? 'share.copiedSettings' : 'share.copied');
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { done(okText); }, function () { done(T('share.failed')); });
    else done('—');
  }

  // Engine bundle (portfolio roadmap #4). The data half is pure
  // (SM.Export, src/export.js, `--export`); only the two PNGs need a canvas.
  // Exports the grid AS EDITED -- brush work is part of the map.
  function pngBytes(width, height, paint) {
    var c = document.createElement('canvas');
    c.width = width; c.height = height;
    paint(c.getContext('2d'));
    return new Promise(function (resolve) {
      c.toBlob(function (blob) {
        blob.arrayBuffer().then(function (buf) { resolve(new Uint8Array(buf)); });
      }, 'image/png');
    });
  }

  function exportUnity() {
    if (!grid || !SM.Export) return;
    var w = grid.width, h = grid.height;
    var albedo = pngBytes(w, h, function (ctx) {
      var big = document.createElement('canvas');
      // Albedo means unlit colour: no hillshade (a Unity terrain is lit by
      // the engine) and no settlement icons (3 px symbols over 1 px cells;
      // the towns are in map.json and in biome.png). It used to follow the
      // Hillshade checkbox and always drew the icons.
      SM.renderTopDown(big, grid, { tile: 1, grid: false, shade: false, markers: false });
      ctx.drawImage(big, 0, 0);
    });
    var biome = pngBytes(w, h, function (ctx) {
      ctx.putImageData(new ImageData(SM.Export.biomeRGBA(grid), w, h), 0, 0);
    });
    Promise.all([albedo, biome]).then(function (pngs) {
      var zip = SM.Export.buildUnityBundle(grid, { albedo: pngs[0], biome: pngs[1] });
      var url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
      var a = document.createElement('a');
      a.download = 'cartula-' + (grid.config ? (grid.config.seedCode || grid.config.seed) : 'map') + '-unity.zip';
      a.href = url;
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    });
  }

  function exportPng() {
    if (!grid) return;
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
    a.download = 'cartula-' + view + '-' + currentSeedCode() + '.png';
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
  // World types: every generation slider at once. Pure data + matching logic
  // live in `src/worldtypes.js` (SM.WorldTypes) so they can be verified
  // headless (`node tools/headless.js --worldtypes`); what stays here is the
  // DOM half -- writing slider values and reading them back for `match`.
  var WORLD_KEYS = SM.WorldTypes.KEYS;

  function applyWorldType(type) {
    var values = SM.WorldTypes.values(type);
    WORLD_KEYS.forEach(function (id) {
      var input = $(id);
      input.value = values[id];
      paintRange(input);
      $(SLIDERS[id].label).textContent = SLIDERS[id].fmt(input.value);
    });
    syncSeedField();
    regenerate(true);
  }

  // Which world type the sliders currently match (a shared link, or a user
  // who moved a slider back) -- 'custom' when none.
  function matchWorldType() {
    return SM.WorldTypes.match(function (id) { return parseFloat($(id).value); });
  }

  $('worldType').addEventListener('change', function () {
    if (this.value !== 'custom') applyWorldType(this.value);
  });
  // The seed field follows every setting live, while a slider is still being
  // dragged (the season too: it is part of the code, though not of the map).
  SM.Seed.FIELDS.forEach(function (f) { $(f.id).addEventListener('input', syncSeedField); });
  ['size', 'sea', 'rugged', 'warp', 'escale', 'octaves', 'island', 'tbias', 'mbias', 'rivers']
    .forEach(function (id) {
      $(id).addEventListener('change', function () {
        $('worldType').value = matchWorldType();
        regenerate();
      });
    });
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
  $('sun').addEventListener('change', applyDayNight);
  // Season: the voxel view follows the drag (uniforms only); the top-down
  // bake is repainted, and the voxel view's rain turns to snow on snowy
  // ground, once the slider is let go. The map is not touched.
  $('season').addEventListener('input', function () {
    if (isVoxelMode() && voxelRenderer && voxelRenderer.setSeason) {
      voxelRenderer.setSeason(seasonValue(), true);
      requestVoxelRender();
    }
  });
  $('season').addEventListener('change', function () {
    if (isVoxelMode() && voxelRenderer && voxelRenderer.setSeason) {
      voxelRenderer.setSeason(seasonValue());
      requestVoxelRender();
    }
    if (!isVoxelMode() && grid && !pipeline) {
      drawContent();
      applyCam();
      startRiverAnim();
    }
  });

  // One "new map" action: Random -- random world settings AND a new seed
  // (Shift+R). There is no Regenerate (Uğur 2026-10-19): the same code always
  // gives the same map, so rebuilding it would change nothing.
  // "Undo my brush edits" is still Edit → Reset to generated.
  function spin(id) {
    var btn = $(id);
    btn.classList.remove('rolling');
    void btn.offsetWidth; // restart the icon spin
    btn.classList.add('rolling');
    setTimeout(function () { btn.classList.remove('rolling'); }, 360);
  }

  // Random settings start from a random world type preset (so the result reads as a kind of
  // world, not noise) and move every generation slider by up to a quarter of its range, kept
  // out of the outer 10% of each range where maps degenerate (all sea, flat, one-tile rivers).
  // Map size is not touched: it is a performance choice, not a world property.
  var RANDOM_BAND = { sea: [0.30, 0.62] };

  function randomSettings() {
    var types = Object.keys(SM.WorldTypes.TYPES);
    var base = SM.WorldTypes.values(types[Math.floor(Math.random() * types.length)]);
    WORLD_KEYS.forEach(function (id) {
      var input = $(id);
      var min = parseFloat(input.min), max = parseFloat(input.max), step = parseFloat(input.step) || 0;
      var span = max - min;
      var lo = min + span * 0.1, hi = max - span * 0.1;
      // Sea level gets a tighter band: below ~0.30 a map came out 80-90% land in a headless run of
      // six random maps (2026-10-05), which reads as one flat continent, not a world.
      if (RANDOM_BAND[id]) { lo = RANDOM_BAND[id][0]; hi = RANDOM_BAND[id][1]; }
      var v = base[id] + (Math.random() - 0.5) * span * 0.5;
      v = Math.max(lo, Math.min(hi, v));
      if (step) v = min + Math.round((v - min) / step) * step;
      input.value = +v.toFixed(4);
      paintRange(input);
      $(SLIDERS[id].label).textContent = SLIDERS[id].fmt(input.value);
    });
    $('worldType').value = matchWorldType();
  }

  function randomMap() {
    randomSettings();
    seedBase = SM.Seed.randomBase();
    syncSeedField();
    regenerate(true);
    spin('randomMap');
  }
  $('randomMap').addEventListener('click', randomMap);
  // Seed field: a typed or pasted code applies when the field closes (blur;
  // on a phone, when the keyboard closes) or on Enter -- never per keystroke
  // (Uğur 2026-10-19). An unchanged code does nothing; an invalid one keeps
  // the text in the field, shows why, and leaves the map alone.
  function commitSeedField() {
    var text = $('seed').value;
    if (SM.Seed.normalize(text) === currentSeedCode()) { syncSeedField(); return; }
    applySeedText(text);
  }
  $('seed').addEventListener('blur', commitSeedField);
  $('seed').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); commitSeedField(); }
  });
  // Copy the APPLIED code (what is on screen), never an unapplied draft.
  var seedCopyTimer = 0;
  function seedCopied(ok) {
    var btn = $('seedCopy');
    btn.classList.toggle('ok', ok);
    btn.title = T(ok ? 'seed.copied' : 'seed.copyFailed');
    clearTimeout(seedCopyTimer);
    seedCopyTimer = setTimeout(function () { btn.classList.remove('ok'); btn.title = T('seed.copy'); }, 1500);
  }
  // Non-secure or old contexts: a throwaway readonly textarea + execCommand.
  function legacyCopy(text) {
    var ta = document.createElement('textarea'), ok = false;
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  // mousedown keeps the field's focus, so pressing Copy never blur-applies a draft.
  $('seedCopy').addEventListener('mousedown', function (ev) { ev.preventDefault(); });
  $('seedCopy').addEventListener('click', function () {
    copyText(currentSeedCode()).then(seedCopied);
  });
  $('seed').addEventListener('input', function (ev) {
    // Typing clears a stale message; the slider listener above also fires
    // syncSeedField for slider input, so only react to the field's own input.
    if (ev.target === $('seed') && $('seedMsg').hidden === false) hideSeedError();
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
  $('showPerf').addEventListener('change', function () { setPerfVisible(this.checked); });
  $('showWeather').addEventListener('change', function () {
    if (!isVoxelMode() || !voxelRenderer || !voxelRenderer.setWeather) return;
    voxelRenderer.setWeather(this.checked);
    requestVoxelRender();
  });
  $('showWind').addEventListener('change', function () {
    if (!isVoxelMode() || !voxelRenderer || !voxelRenderer.setWind) return;
    voxelRenderer.setWind(this.checked);
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
  // Center view (Uğur 2026-10-05): the same fit a new map gets
  // (renderer.fitCamera, which frames the terrain AND the sky for every yaw
  // and pitch), so pan and zoom go back to the whole map. Yaw and pitch stay
  // where the user left them; a running Q/E snap or auto-rotate carries on.
  function centerVoxelView() {
    var fit;
    if (!isVoxelMode() || !voxelRenderer || !voxelCamera || !voxelMesh) return;
    fit = voxelRenderer.fitCamera(voxelMesh.bounds);
    setVoxelCamera({
      yaw: voxelCamera.yaw,
      pitch: voxelCamera.pitch,
      zoom: fit.zoom,
      tx: fit.tx,
      ty: fit.ty,
      tz: fit.tz
    });
  }
  $('centerViewBtn').addEventListener('click', centerVoxelView);
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
  $('pipelineToggle').addEventListener('click', function () {
    if (pipeline) exitPipeline(); else enterPipeline();
  });
  $('stageSlider').addEventListener('input', function () {
    if (pipeline) showStage(parseInt(this.value, 10));
  });
  $('stagePrev').addEventListener('click', function () { if (pipeline) showStage(pipeline.index - 1); });
  $('stageNext').addEventListener('click', function () { if (pipeline) showStage(pipeline.index + 1); });
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
  // Unity export is ON (Uğur 2026-10-19, after the bundle was verified in
  // Unity 6: row order, scale, shoreline). The row stays hidden in index.html
  // until this flag shows it and wires the button; setting it to false hides
  // the feature again with no other change (exportUnity, src/export.js and the
  // `--export` harness stay).
  var UNITY_EXPORT_ENABLED = true;
  if (UNITY_EXPORT_ENABLED) {
    $('exportUnityRow').hidden = false;
    $('exportUnity').addEventListener('click', exportUnity);
  }
  // Brush editing is OFF for now (Uğur 2026-10-13: "edit bölümünü gizleyelim,
  // genel kullanılmaz"). All brush code, the `--edit` / `--river` harnesses and
  // the #editGroup markup stay; the group is hidden, the tool is forced to Pan
  // and the paint / cursor / undo paths are gated on this flag. Set it to true
  // to bring the Edit panel back; nothing else changes.
  var EDIT_ENABLED = false;
  if (!EDIT_ENABLED) {
    $('editGroup').hidden = true;
    $('editTool').value = 'pan';
  }
  // Dark mode: only the page chrome; the map keeps its own palette. The
  // initial value is set by the inline script in index.html.
  $('themeToggle').addEventListener('click', function () {
    var root = document.documentElement;
    var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    fadeTheme();
    root.setAttribute('data-theme', next);
    // Both keys: bilaxten.art reads `bx-theme` (same origin), so the site and
    // the demo agree; `sm-theme` keeps older Cartula builds in step.
    try {
      localStorage.setItem('bx-theme', next);
      localStorage.setItem('sm-theme', next);
    } catch (e) {}
    // An unpinned map background follows the theme.
    var pinned = null;
    try { pinned = localStorage.getItem('sm-stage'); } catch (e) {}
    if (pinned !== 'dark' && pinned !== 'light') applyStage(next, true);
  });
  // Map background, independent of the theme. Picking the value the theme
  // would give anyway unpins it, so it follows the theme again from then on.
  $('stageToggle').addEventListener('click', function () {
    var root = document.documentElement;
    var next = root.getAttribute('data-stage') === 'dark' ? 'light' : 'dark';
    try {
      if (next === root.getAttribute('data-theme')) localStorage.removeItem('sm-stage');
      else localStorage.setItem('sm-stage', next);
    } catch (e) {}
    applyStage(next, true);
  });
  // Render debug views live in the voxel shader; top-down has no lighting
  // terms to isolate, so the control only acts in the isometric view.
  $('debugView').addEventListener('change', function () {
    if (!voxelRenderer || !voxelRenderer.setDebugView) return;
    voxelRenderer.setDebugView(parseInt(this.value, 10));
    requestVoxelRender();
  });
  $('shareLink').addEventListener('click', shareLink);
  window.addEventListener('resize', function () {
    if (isVoxelMode()) resizeVoxel();
    else if (grid) applyCam();
  });

  // --- side panel: ☰ collapses / expands it (Uğur 2026-10-05) ---
  // State lives on <html data-panel>, set before first paint by the inline
  // script in index.html (saved choice in `sm-panel`, else collapsed on a
  // phone-sized screen). Same media query there and in style.css.
  var COMPACT_QUERY = '(max-width: 700px), (max-height: 500px)';
  var compactMq = window.matchMedia ? window.matchMedia(COMPACT_QUERY) : null;
  var panelToggle = $('panelToggle');
  function isCompact() { return !!(compactMq && compactMq.matches); }
  function panelOpen() { return document.documentElement.getAttribute('data-panel') !== 'collapsed'; }
  function syncPanelToggle() {
    var open = panelOpen();
    panelToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    panelToggle.setAttribute('aria-label', T(open ? 'panel.close' : 'panel.open'));
    panelToggle.title = T(open ? 'panel.close' : 'panel.open');
  }
  function setPanel(open, save) {
    var focusInPanel = $('panel').contains(document.activeElement);
    document.documentElement.setAttribute('data-panel', open ? 'expanded' : 'collapsed');
    syncPanelToggle();
    if (save) {
      try { localStorage.setItem('sm-panel', open ? 'open' : 'closed'); } catch (e) {}
    }
    // Focus must not stay on a control that is about to be hidden.
    if (!open && focusInPanel) panelToggle.focus();
  }
  panelToggle.addEventListener('click', function () { setPanel(!panelOpen(), true); });
  // On a compact screen the open panel is a drawer over the map, i.e. a
  // popup: a tap beside it or Esc closes it (Uğur's rule: one open at a time,
  // Esc / outside click closes). A docked desktop panel is not a popup and
  // ignores both.
  $('panelScrim').addEventListener('click', function () { setPanel(false, true); });
  window.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape' || !isCompact() || !panelOpen()) return;
    setPanel(false, true);
    panelToggle.focus();
  });
  syncPanelToggle();

  /* Page pinch-zoom (allowed on the panel, for accessibility) scales and
   * shifts position: fixed elements with the layout viewport. The ☰ button is
   * screen UI, so it is moved back by the visual viewport's offset and scaled
   * by 1 / scale: same place, same size on screen. */
  function placePanelToggle() {
    var vv = window.visualViewport;
    if (!vv) return;
    var s = vv.scale || 1;
    if (Math.abs(s - 1) < 1e-3 && !vv.offsetLeft && !vv.offsetTop) {
      panelToggle.style.transform = '';
      return;
    }
    var cs = getComputedStyle(panelToggle);
    var left = parseFloat(cs.left) || 0, top = parseFloat(cs.top) || 0;
    panelToggle.style.transform = 'translate(' +
      (vv.offsetLeft - left * (1 - 1 / s)) + 'px,' +
      (vv.offsetTop - top * (1 - 1 / s)) + 'px) scale(' + (1 / s) + ')';
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', placePanelToggle);
    window.visualViewport.addEventListener('scroll', placePanelToggle);
  }

  /* The stage changes size when the panel slides (every frame of the
   * 0.2 s transition), on a window resize and when a phone's address bar
   * moves. The map keeps its centre and its on-screen scale: the top-down
   * camera shifts by half the change; the isometric camera's zoom is the
   * ortho half-WIDTH in world units, so it scales with the width. The WebGL
   * frame is resized AND drawn right here, inside the ResizeObserver
   * callback (after layout, before paint): resizing a canvas clears it, and
   * waiting for the next animation frame would show one blank or stretched
   * frame. */
  var stageSize = { w: stage.clientWidth, h: stage.clientHeight };
  function onStageResize() {
    var w = stage.clientWidth, h = stage.clientHeight;
    var ow = stageSize.w, oh = stageSize.h;
    if (w === ow && h === oh) return;
    stageSize = { w: w, h: h };
    if (!w || !h) return;
    if (content && ow && oh) {
      cam.x += (w - ow) / 2;
      cam.y += (h - oh) / 2;
      applyCam();
    }
    if (isVoxelMode() && voxelRenderer) {
      if (voxelCamera && ow) {
        voxelCamera.zoom = Math.max(1, Math.min(1000, voxelCamera.zoom * w / ow));
        voxelRenderer.setCamera(voxelCamera);
      }
      voxelRenderer.resize(w, h, window.devicePixelRatio || 1);
      voxelRenderer.render();
    }
  }
  if (window.ResizeObserver) new ResizeObserver(onStageResize).observe(stage);
  window.addEventListener('pagehide', function () {
    if (voxelAnim) { cancelAnimationFrame(voxelAnim); voxelAnim = 0; }
    if (voxelRenderer) {
      voxelRenderer.dispose();
      // null'lanmazsa startVoxel'in `if (!voxelRenderer)` koruması bfcache
      // dönüşünde yeniden kurmayı atlar — izometrik görünüm ölü kalır (kod
      // taraması 2026-09-15, bulgu 4). Safari/iOS pagehide'ı bfcache girişinde
      // de tetikler, yalnız sekme kapanışında değil.
      voxelRenderer = null;
    }
  });
  // ...and the other half: nothing rebuilt it on the way BACK from bfcache, so
  // the isometric view came back as a dead canvas until the user switched tabs.
  window.addEventListener('pageshow', function (ev) {
    if (!ev.persisted || !grid || !isVoxelMode() || voxelRenderer) return;
    // A context lost while cached comes back through `webglcontextrestored`;
    // building on a lost context would fail to link and `startVoxel` would
    // write the view off as "no WebGL2" for good.
    if (voxelContextLost) return;
    refresh(false);
  });

  // GPU reset, driver update, too many contexts: the browser drops the WebGL
  // context and every buffer/program with it. preventDefault() is what asks
  // for it back; without it the canvas stays black for the rest of the session.
  var voxelContextLost = false;
  glCanvas.addEventListener('webglcontextlost', function (ev) {
    ev.preventDefault();
    voxelContextLost = true;
    if (voxelAnim) { cancelAnimationFrame(voxelAnim); voxelAnim = 0; }
    // Everything the renderer holds is already gone; drop it so every
    // `if (!voxelRenderer)` guard stands down until the context is back.
    if (voxelRenderer) {
      try { voxelRenderer.dispose(); } catch (err) { /* lost context */ }
      voxelRenderer = null;
    }
    if (isVoxelMode()) setIsoHint('hint.contextLost');
  });
  glCanvas.addEventListener('webglcontextrestored', function () {
    voxelContextLost = false;
    // In top-down view the next `startVoxel` builds a fresh renderer anyway.
    if (grid && isVoxelMode()) refresh(false);
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
    // Only text-editable fields swallow keys (the seed field is text). A focused range slider (rotSlider
    // included) or select/checkbox has no letter-key behaviour of its own, so
    // it used to block Q/E globally just by holding focus -- clicking anything
    // in the panel silently killed the rotate shortcut. Bug found 2026-09-03.
    var textEditable = tn === 'TEXTAREA' || tn === 'SELECT' ||
      (tn === 'INPUT' && target.type !== 'range' && target.type !== 'checkbox');
    if (textEditable) return;
    if (isSpaceKey(ev)) {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      // No page scroll, and a focused button or checkbox is not pressed:
      // Space is the pan modifier everywhere outside a text field / select.
      ev.preventDefault();
      setSpaceHeld(true);
      return;
    }
    var key = (ev.key || '').toLowerCase();
    if (ev.ctrlKey || ev.metaKey) {
      if (ev.altKey) return;
      if (key === 'z') { ev.preventDefault(); if (ev.shiftKey) redoEdit(); else undoEdit(); }
      else if (key === 'y') { ev.preventDefault(); redoEdit(); }
      return;
    }
    if (pipeline && target && target.type !== 'range') {
      if (key === 'arrowleft') { ev.preventDefault(); showStage(pipeline.index - 1); return; }
      if (key === 'arrowright') { ev.preventDefault(); showStage(pipeline.index + 1); return; }
    }
    if (key === 'r' && !ev.altKey && ev.shiftKey) { randomMap(); return; }
    if (key === 'p' && !ev.altKey && !ev.shiftKey) { setPerfVisible(!perf.on); return; }
    if (key === 'q') rotateView(-1);
    else if (key === 'e') rotateView(1);
  });
  window.addEventListener('keyup', function (ev) {
    if (!isSpaceKey(ev) || !spaceHeld) return;
    // A focused button fires its click on Space keyup; it must not here.
    ev.preventDefault();
    setSpaceHeld(false);
  });
  // A Space released while the window had no focus never sends keyup.
  window.addEventListener('blur', function () { setSpaceHeld(false); });
  stage.addEventListener('wheel', onWheel, { passive: false });

  // Pan toggle (touch screens only, style.css): on = one finger pans the map,
  // pinch zoom off; off = the view's own one-finger drag and the pinch zoom.
  function syncPanToggle() {
    var b = $('panToggle');
    b.setAttribute('aria-pressed', touchPan ? 'true' : 'false');
    b.title = T(touchPan ? 'pan.title.on' : 'pan.title.off');
    b.setAttribute('aria-label', T(touchPan ? 'pan.title.on' : 'pan.title.off'));
    $('isohint').textContent = T(hintKeyFor(isoHintKey));
  }
  $('panToggle').addEventListener('click', function () {
    touchPan = !touchPan;
    syncPanToggle();
  });

  // --- touch (Uğur 2026-10-05: "mobilde zoom kötü çalışıyor") ---
  // Until then the map had mouse handlers only: on a phone a one-finger drag
  // did nothing and a pinch zoomed the whole page, panel included. Now, with
  // pointer events on the stage (#stage has touch-action: none in style.css,
  // so the browser leaves gestures on the map to the app; the panel keeps
  // page zoom, for accessibility):
  //   one finger  = the mouse drag of that view (orbit in isometric; pan, or
  //                 the selected brush, in top-down)
  //   two fingers = pan + pinch zoom about the fingers (SM.Touch, src/touch.js)
  // A second finger ends the one-finger drag where it is (a brush stroke
  // younger than 300 ms is taken back: it was the start of a pinch). When one
  // finger of a pinch lifts, the other keeps panning from where it is; it
  // never starts an orbit or a stroke. Every change in the set of fingers
  // re-bases the gesture, so nothing jumps. A short tap in top-down view with
  // the Pan tool shows the tile card, as hovering does with a mouse.
  //
  // Uğur 2026-10-13 (real phone): "çalışıyor ama garip, istediğim gibi
  // kaydırıp yakınlaştıramıyorum". The pinch math was exact; the gesture
  // around it was not. Real fingers never land together: the first one is
  // down 30-100 ms early and drifts, and in isometric view that drift was
  // an orbit (0.87 deg per px on a 412 px phone), so most pinches began by
  // swinging the map a few degrees about the screen centre -- the point
  // under the fingers slid away, and again on every re-grab. And a second
  // finger that landed on the angle bar moved its slider (160 deg in the
  // CDP check) instead of joining the pinch. Now:
  //   - an isometric one-finger orbit starts only past TOUCH_TAP_PX, from
  //     where the finger is then (no jump), and an orbit younger than
  //     TOUCH_STROKE_UNDO_MS is taken back when a second finger lands, as a
  //     brush stroke is;
  //   - while a map gesture is on, a finger landing on the angle bar is a
  //     map finger; its touch events are cancelled so the slider and the
  //     two buttons never see it (touch.barClaim).
  //
  // Uğur 2026-10-13, third round on the phone ("kaydırma olmasın, zoom
  // in/zoom out yaparak çözeriz, iki parmak sadece zoom yapabilsin"): two
  // fingers only ZOOM. The map does not follow the fingers' midpoint; the
  // zoom is anchored at the midpoint where the pinch started (touch.anchor,
  // fixed for the whole gesture) and follows the finger-distance ratio, no
  // dead zone. You travel by zooming out and in again elsewhere. When a
  // finger of a pinch lifts, the others do nothing until every finger is up
  // (mode 'dead'): no stray pan or orbit at the end of a pinch.
  //
  // Uğur 2026-10-19 (real phone): the two-finger pan did not work well ("pan
  // düzgün çalışmıyor"), so pan is a button instead (#panToggle, touch
  // screens only): off, a map gesture is what it was before pan existed (one
  // finger = the view's own drag, two fingers = zoom only, as above); on, one
  // finger drags the map in both views and a second finger does nothing, so
  // zoom is off until the button is pressed again. The two-finger midpoint
  // pan of 932ddbc is gone.
  var touch = { pts: {}, order: [], mode: null, frame: null, start: null, strokeAt: 0, orbit0: null, barClaim: false, anchor: null };
  var touchPan = false;
  var TOUCH_TAP_PX = 8, TOUCH_TAP_MS = 350, TOUCH_STROKE_UNDO_MS = 300;

  function stageXY(ev) {
    var r = stage.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }
  function mouseLike(ev) {
    // Pan on: the one-finger drag is the view's pan (shift+drag in isometric).
    return { clientX: ev.clientX, clientY: ev.clientY, button: 0, shiftKey: touchPan, preventDefault: function () {} };
  }
  function touchFrame() {
    return SM.Touch.frame(touch.pts[touch.order[0]], touch.pts[touch.order[1]]);
  }
  function touchNavigate(prev, next) {
    if (isVoxelMode()) {
      if (!voxelCamera) return;
      voxelSnap = null;
      setVoxelCamera(SM.Touch.pinchVoxel(voxelCamera, prev, next,
        stage.clientWidth, stage.clientHeight, 1, 1000));
    } else if (content) {
      var c = SM.Touch.pinchTop(cam, prev, next, 0.1, 6); // same limits as the wheel
      cam.scale = c.scale;
      cam.x = c.x;
      cam.y = c.y;
      applyCam();
    }
  }
  function endOneFinger() {
    if (editStroke && performance.now() - touch.strokeAt < TOUCH_STROKE_UNDO_MS) {
      var record = editStroke.record;
      editStroke = null;
      restoreRecord(record);
      SM.tagWaterfalls(grid);
      SM.tagMossyLakes(grid);
      if (record.indices.length) {
        paintEditedTiles(record.indices);
        updateEditedStats();
        scheduleEditedTopRender();
      }
    }
    // Same rule for an isometric orbit: one that young was the first finger
    // of a pinch drifting before the second landed.
    var o = touch.orbit0;
    touch.orbit0 = null;
    if (o && voxelCamera && performance.now() - touch.strokeAt < TOUCH_STROKE_UNDO_MS &&
        (voxelCamera.yaw !== o.yaw || voxelCamera.pitch !== o.pitch)) {
      setVoxelCamera({ yaw: o.yaw, pitch: o.pitch, zoom: voxelCamera.zoom,
        tx: voxelCamera.tx, ty: voxelCamera.ty, tz: voxelCamera.tz });
    }
    onUp();
    hideBrushCursor();
  }
  stage.addEventListener('pointerdown', function (ev) {
    if (ev.pointerType !== 'touch') return;
    // A new gesture: the claim of the last one ends here, not at its last
    // pointerup, because that finger's touchend comes after it.
    if (!touch.order.length) touch.barClaim = false;
    // The angle chip's own controls handle their touches -- unless a map
    // gesture is already on: then this finger is part of it (barClaim).
    if (ev.target !== stage && ev.target !== map && ev.target !== glCanvas) {
      if (!touch.order.length) return;
      touch.barClaim = true;
    }
    ev.preventDefault(); // no compatibility mouse events after this
    try { stage.setPointerCapture(ev.pointerId); } catch (e) { /* already gone */ }
    touch.pts[ev.pointerId] = stageXY(ev);
    touch.order.push(ev.pointerId);
    hoverEl.hidden = true;
    if (touch.order.length === 1) {
      touch.mode = 'one';
      touch.start = { x: ev.clientX, y: ev.clientY, t: performance.now(), moved: false };
      touch.strokeAt = performance.now();
      touch.orbit0 = isVoxelMode() && voxelCamera ? { yaw: voxelCamera.yaw, pitch: voxelCamera.pitch } : null;
      onDown(mouseLike(ev));
      return;
    }
    if (touch.mode === 'one') endOneFinger();
    if (touch.mode === 'dead') return; // after a pinch: nothing until all fingers are up
    if (touchPan) { touch.mode = 'dead'; touch.start = null; return; } // pan on: zoom is off
    var wasTwo = touch.mode === 'two'; // a third finger rides along
    touch.mode = 'two';
    touch.start = null;
    touch.frame = touchFrame();
    if (!wasTwo) touch.anchor = { x: touch.frame.x, y: touch.frame.y };
  });
  stage.addEventListener('pointermove', function (ev) {
    if (ev.pointerType !== 'touch' || !touch.pts[ev.pointerId]) return;
    touch.pts[ev.pointerId] = stageXY(ev);
    if (touch.mode === 'one') {
      if (touch.start && !touch.start.moved &&
          Math.abs(ev.clientX - touch.start.x) + Math.abs(ev.clientY - touch.start.y) > TOUCH_TAP_PX) {
        touch.start.moved = true;
        // The orbit starts here, from where the finger is now: no jump.
        if (drag && drag.voxel) { drag.x = ev.clientX; drag.y = ev.clientY; }
      }
      if (drag && drag.voxel && !(touch.start && touch.start.moved)) return;
      onMove(mouseLike(ev));
    } else if (touch.mode === 'two') {
      if (touch.order.indexOf(ev.pointerId) > 1) return; // a third finger rides along
      // Zoom only, about the fixed anchor: same point before and after, so
      // the pinch math moves nothing but the scale.
      var f = touchFrame(), a = touch.anchor;
      touchNavigate({ x: a.x, y: a.y, d: touch.frame.d }, { x: a.x, y: a.y, d: f.d });
      touch.frame = f;
    }
  });
  function touchEnd(ev, cancelled) {
    if (ev.pointerType !== 'touch' || !touch.pts[ev.pointerId]) return;
    delete touch.pts[ev.pointerId];
    touch.order.splice(touch.order.indexOf(ev.pointerId), 1);
    if (touch.mode === 'one') {
      var s = touch.start;
      touch.mode = null;
      touch.strokeAt = -Infinity; // a lifted finger's stroke is kept
      endOneFinger();
      if (!cancelled && s && !s.moved && performance.now() - s.t < TOUCH_TAP_MS &&
          view === 'top' && $('editTool').value === 'pan') onHover(mouseLike(ev));
    } else if (touch.mode === 'two' && touch.order.length >= 2) {
      touch.frame = touchFrame(); // another pair: the ratio measures from it, same anchor
    } else {
      touch.mode = touch.order.length ? 'dead' : null;
    }
  }
  stage.addEventListener('pointerup', function (ev) { touchEnd(ev, false); });
  stage.addEventListener('pointercancel', function (ev) { touchEnd(ev, true); });
  // Pointer events come first, so by a claimed finger's touchstart the
  // pointerdown above has set barClaim. Cancelling its touch events keeps
  // the slider from moving and the buttons from getting a click.
  function blockClaimedBarTouch(ev) { if (touch.barClaim) ev.preventDefault(); }
  ['touchstart', 'touchmove', 'touchend'].forEach(function (type) {
    $('yawControl').addEventListener(type, blockClaimedBarTouch, { passive: false });
  });
  // iOS Safari's own pinch events: the map handles its pinches itself.
  stage.addEventListener('gesturestart', function (ev) { ev.preventDefault(); });

  // Read-only views of the camera for the headless browser checks (CDP);
  // nothing in the app reads them.
  SM.cameraState = function () {
    if (isVoxelMode() && voxelCamera) {
      return { view: 'iso', yaw: voxelCamera.yaw, pitch: voxelCamera.pitch, zoom: voxelCamera.zoom,
        tx: voxelCamera.tx, ty: voxelCamera.ty, tz: voxelCamera.tz };
    }
    return { view: 'top', scale: cam.scale, x: cam.x, y: cam.y };
  };
  SM.screenToWorld = function (clientX, clientY) {
    var r = stage.getBoundingClientRect(), x = clientX - r.left, y = clientY - r.top;
    if (isVoxelMode() && voxelCamera) {
      return SM.Touch.voxelGroundAt(voxelCamera, x, y, stage.clientWidth, stage.clientHeight);
    }
    return { x: (x - cam.x) / cam.scale, y: (y - cam.y) / cam.scale };
  };

  // Language switch (TR / EN, src/i18n.js): `SM.I18N.apply` has already
  // rewritten every hooked element; this rewrites what main.js writes itself.
  // Nothing is regenerated or re-rendered -- only text changes.
  function refreshLangText() {
    Object.keys(SLIDERS).forEach(function (id) {
      if (id !== 'sea') $(SLIDERS[id].label).textContent = SLIDERS[id].fmt($(id).value);
    });
    if (intro && !grid) $('stats').textContent = T('gen.busy');
    else renderStats();
    $('isohint').textContent = T(hintKeyFor(isoHintKey));
    $('pipelineToggle').textContent = T(pipeline ? 'pipeline.exit' : 'pipeline.enter');
    updateStageText();
    if ($('viewIso').disabled) $('viewIso').title = T('view.noWebgl');
    var legendRows = $('legend').children, options = $('editBiome').options;
    SM.BIOME_LIST.forEach(function (b, i) {
      if (legendRows[i]) legendRows[i].lastChild.nodeValue = T('biome.' + b.id);
      if (options[i]) options[i].textContent = T('biome.' + b.id);
    });
    hoverEl.hidden = true;
    syncPanelToggle();
    syncPanToggle();
    if (perf.on) paintPerf();
    if (seedErrorKey) $('seedMsg').textContent = T(seedErrorKey);
    $('seedCopy').title = T($('seedCopy').classList.contains('ok') ? 'seed.copied' : 'seed.copy');
  }
  SM.I18N.onChange(refreshLangText);

  hoverEl.hidden = true;
  setIsoHint(isoHintKey);
  $('pipelineToggle').textContent = T('pipeline.enter');
  syncPanToggle();
  applyQueryString();
  Object.keys(SLIDERS).forEach(function (id) {
    var input = $(id);
    if (input.type === 'range') {
      paintRange(input);
      // A missing label must never stop init: regenerate() below draws the map (one unreproduced
      // null here, 2026-10-05).
      var lab = $(SLIDERS[id].label);
      if (lab) lab.textContent = SLIDERS[id].fmt(input.value);
    }
  });
  $('worldType').value = matchWorldType();
  buildLegend();
  buildBiomeSelect();
  syncEditControls();
  updateUndoButtons();
  startIntro();
  applyDayNight();
})(window.SM = window.SM || {});
