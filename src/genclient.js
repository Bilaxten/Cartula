/* Generation client: runs SM.generate in a Web Worker (src/gen-worker.js) so
 * the page paints and stays usable while a map is built, and streams the
 * recorded passes back as they finish. Where a worker cannot start (no Worker
 * API, file:// pages, a blocked script) it falls back to the same SM.generate
 * on the main thread, after a frame has been painted -- the result is the same
 * grid either way; only the thread differs.
 *
 *   SM.GenClient.run(cfg, {
 *     stages:  ['sample', ...]      pass ids to report as they finish
 *     onStage: function (id, snap)  once per reported pass, in pipeline order
 *     mesh:    { sun: [x,y,z] }     also build everything the isometric view needs
 *                                   (SM.buildIsoExtra: mesh, shadow, water beds,
 *                                   wind, weather, smoke) off the page thread
 *     onDone:  function (grid, ms, extra)  the finished grid (SM.createGrid
 *                                   shape); extra = { mesh, shadow, floor } or null
 *     onError: function (message)   generation itself threw
 *   }) -> { cancel() }              no callback fires after cancel()
 */
(function (SM) {
  'use strict';

  var WORKER_URL = 'src/gen-worker.js';

  // A worker hands back plain data (functions do not survive a transfer);
  // rebuild the grid object around it with the model's own constructor.
  function toGrid(d) {
    var g = SM.createGrid(d.width, d.height);
    Object.keys(d).forEach(function (k) { g[k] = d[k]; });
    return g;
  }

  function run(cfg, o) {
    var cancelled = false, finished = false, worker = null, delivered = {};

    function stage(id, snap) {
      if (cancelled || finished || delivered[id]) return;
      delivered[id] = true;
      if (o.onStage) o.onStage(id, snap);
    }
    function done(grid, ms, extra) {
      if (cancelled || finished) return;
      finished = true;
      if (worker) { worker.terminate(); worker = null; }
      o.onDone(grid, ms, extra || null);
    }

    // Same generation, this thread. Passes are collected first and delivered
    // after, so a slow device paints once before the long task starts.
    function runHere() {
      if (cancelled || finished) return;
      var want = {}, snaps = [];
      (o.stages || []).forEach(function (id) { want[id] = true; });
      var t0 = performance.now();
      var grid;
      try {
        grid = SM.generate(cfg, function (id, snap) { if (want[id]) snaps.push([id, snap]); });
      } catch (e) {
        if (!cancelled && o.onError) o.onError(String(e && e.message || e));
        return;
      }
      var ms = performance.now() - t0;
      var extra = null;
      if (o.mesh && SM.buildVoxelMesh) {
        extra = SM.buildIsoExtra(grid, o.mesh.sun);
      }
      snaps.forEach(function (s) { stage(s[0], s[1]); });
      done(grid, ms, extra);
    }
    function runHereLater() {
      if (worker) { worker.terminate(); worker = null; }
      var go = function () { setTimeout(runHere, 0); };
      if (window.requestAnimationFrame) requestAnimationFrame(go); else go();
    }

    try {
      if (typeof Worker === 'undefined') throw new Error('no Worker');
      worker = new Worker(WORKER_URL);
      worker.onmessage = function (ev) {
        var m = ev.data;
        if (cancelled || !m) return;
        if (m.t === 'stage') stage(m.id, m.snap);
        else if (m.t === 'done') done(toGrid(m.grid), m.ms, m.extra);
        else if (m.t === 'error' && o.onError) o.onError(m.msg);
      };
      // Script load failures (file://, blocked, 404) surface here, not in the
      // constructor.
      worker.onerror = function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (!cancelled && !finished) runHereLater();
      };
      worker.onmessageerror = worker.onerror;
      worker.postMessage({ cfg: cfg, stages: o.stages || [], mesh: o.mesh || null });
    } catch (e) {
      worker = null;
      runHereLater();
    }

    return {
      cancel: function () {
        cancelled = true;
        if (worker) { worker.terminate(); worker = null; }
      }
    };
  }

  SM.GenClient = { run: run, toGrid: toGrid };
})(window.SM = window.SM || {});
