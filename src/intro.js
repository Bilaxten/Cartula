/* Layered intro: the first map is revealed pass by pass, an ink line sweeping
 * down the map and printing each recorded pass of generation in order (raw
 * noise, mountains, sea level, biomes, rivers, the finished map), the way the
 * launch film builds a world. This module is the scheduler and the cheap frame
 * painter; main.js owns the canvases and passes in how a sweep is painted.
 *
 *   var p = SM.Intro.createPlayer({
 *     paint: function (from, to, p)   draw `to` over `from` down to p (0..1)
 *     line:  function (p, frame)      place the ink line, p === null hides it
 *     final: function (skipped)       every frame shown; build the finished view
 *   });
 *   p.push(canvas)   a frame, in order      p.end()   no more frames
 *   p.skip()         show everything now    p.cancel()   stop, leave nothing
 *
 * A frame that arrives while a sweep is running waits; a backlog of two or more
 * speeds the sweeps up rather than lagging behind generation. After skip() the
 * frames are painted whole, without sweeps. */
(function (SM) {
  'use strict';

  var PASSES = ['sample', 'shape', 'sea', 'climate', 'rivers'];
  var SWEEP_MS = 280;      // one pass printed top to bottom
  var HOLD_MS = 50;        // a beat on the finished pass before the next
  var CATCH_UP = 0.55;     // sweep length factor while frames are queued

  function ease(t) { return 1 - Math.pow(1 - t, 3); }

  // --- frames -------------------------------------------------------------
  // The real top-down renderer paints a cell with two canvas calls and a style
  // string each; at 320 x 320 that is the cost of a whole generation on a
  // phone, and the intro needs five of them. A frame is the same colours (the
  // palette, the sea ramp, the lake tint, per-cell shade, the hillshade step)
  // written straight into pixels in one pass: milliseconds. It leaves out
  // what only matters at rest (settlement icons, river shimmer); the finished
  // map is drawn by the real renderer as soon as the intro ends.
  // `--intro` pins this against SM.paintTopDownTile cell for cell.
  var RGB = null;
  function biomeRgb() {
    if (!RGB) {
      RGB = SM.BIOME_LIST.map(function (b) {
        var n = parseInt(b.color.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      });
    }
    return RGB;
  }

  // RGBA bytes for one recorded pass (or a finished grid) of `stage.view`:
  // 'height' raw relief, 'sea' relief plus the sea mask, 'map' the biome map.
  function pixels(snap, stage) {
    var w = snap.width, h = snap.height, n = w * h;
    var out = new Uint8ClampedArray(n * 4);
    var e = snap.elevation, water = snap.water, biome = snap.biome;
    var rgb = biomeRgb(), IDX = SM.BIOME_IDX;
    var i, x, y, c, f, a, r, g, b, o;
    if (stage.view === 'map') {
      for (i = 0; i < n; i++) {
        c = SM.isSea(snap, i) ? SM.seaColor(snap, i)
          : biome[i] === IDX.lake ? SM.lakeColor(snap, i) : rgb[biome[i]];
        f = SM.biomeShade(snap, i);
        r = Math.round(c[0] * f); g = Math.round(c[1] * f); b = Math.round(c[2] * f);
        if (!water[i]) {
          x = i % w; y = (i / w) | 0;
          a = ((e[i] - (x > 0 ? e[i - 1] : e[i])) + (e[i] - (y > 0 ? e[i - w] : e[i]))) * 5;
          a = a > 0.4 ? 0.4 : a < -0.4 ? -0.4 : a;
          if (a > 0) { r += (255 - r) * a; g += (255 - g) * a; b += (255 - b) * a; }
          else { r *= 1 + a; g *= 1 + a; b *= 1 + a; }
        }
        o = i * 4;
        out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
      }
      return out;
    }
    var lo = Infinity, hi = -Infinity;
    for (i = 0; i < n; i++) { if (e[i] < lo) lo = e[i]; if (e[i] > hi) hi = e[i]; }
    var span = hi - lo || 1;
    var sea = stage.view === 'sea' ? rgb[IDX.shallow_water] : null;
    for (i = 0; i < n; i++) {
      o = i * 4;
      if (sea && water[i]) { out[o] = sea[0]; out[o + 1] = sea[1]; out[o + 2] = sea[2]; out[o + 3] = 255; continue; }
      x = i % w; y = (i / w) | 0;
      g = 40 + 200 * (e[i] - lo) / span;
      a = ((e[i] - (x > 0 ? e[i - 1] : e[i])) + (e[i] - (y > 0 ? e[i - w] : e[i]))) * 160 / span;
      a = a > 18 ? 18 : a < -18 ? -18 : a;
      out[o] = out[o + 1] = out[o + 2] = g + a;
      out[o + 3] = 255;
    }
    return out;
  }

  // Draw a frame onto `canvas`, `tile` pixels per cell, hard edges (the map
  // canvas is shown pixelated, so the cells stay cells).
  function frame(canvas, snap, stage, tile) {
    var w = snap.width, h = snap.height;
    var small = document.createElement('canvas');
    small.width = w; small.height = h;
    var sctx = small.getContext('2d');
    var img = sctx.createImageData(w, h);
    img.data.set(pixels(snap, stage));
    sctx.putImageData(img, 0, 0);
    canvas.width = w * tile;
    canvas.height = h * tile;
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
    return { width: canvas.width, height: canvas.height };
  }

  function createPlayer(host) {
    var queue = [], cur = null, sweep = null, raf = 0, holdUntil = 0;
    var ended = false, skipped = false, stopped = false;

    function schedule() { if (!raf && !stopped) raf = requestAnimationFrame(pump); }

    function pump(now) {
      raf = 0;
      if (stopped) return;
      if (!sweep) {
        if (!skipped && now < holdUntil) { schedule(); return; }
        if (!queue.length) {
          if (ended) { stopped = true; host.line(null); host.final(skipped); }
          return;                               // wait for push() or end()
        }
        var to = queue.shift();
        if (skipped) {
          // Newest frame only: the ones before it would be invisible.
          while (queue.length) to = queue.shift();
          host.paint(null, to, 1);
          cur = to;
          schedule();
          return;
        }
        sweep = { from: cur, to: to, t0: now, dur: SWEEP_MS * (queue.length > 1 ? CATCH_UP : 1) };
      }
      var p = (now - sweep.t0) / sweep.dur;
      if (p >= 1) {
        host.paint(sweep.from, sweep.to, 1);
        host.line(null);
        cur = sweep.to;
        sweep = null;
        holdUntil = now + HOLD_MS;
      } else {
        var e = ease(Math.max(0, p));
        host.paint(sweep.from, sweep.to, e);
        host.line(e, sweep.to);
      }
      schedule();
    }

    return {
      push: function (frame) { if (stopped) return; queue.push(frame); schedule(); },
      end: function () { if (stopped) return; ended = true; schedule(); },
      skip: function () {
        if (stopped || skipped) return;
        skipped = true;
        if (sweep) { host.paint(sweep.from, sweep.to, 1); cur = sweep.to; sweep = null; host.line(null); }
        schedule();
      },
      cancel: function () {
        stopped = true;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        sweep = null;
        queue = [];
        host.line(null);
      },
      get skipped() { return skipped; }
    };
  }

  SM.Intro = {
    PASSES: PASSES, SWEEP_MS: SWEEP_MS, HOLD_MS: HOLD_MS,
    pixels: pixels, frame: frame, createPlayer: createPlayer
  };
})(window.SM = window.SM || {});
