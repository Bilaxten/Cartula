/* Generation worker. A classic worker script (no modules, no bundler): it
 * loads the same four files the page does, in the same order, so SM.generate
 * runs here exactly as it runs on the main thread -- the grid model stays the
 * single source of truth and the named passes in generate.js are untouched.
 * Those files write to `window.SM`; a worker has no `window`, so it is aliased
 * to the worker scope before they load.
 *
 * Protocol (src/genclient.js is the other half):
 *   in   { cfg, stages: [stage ids to report] }
 *   out  { t: 'stage', id, snap }   a recorded pass (SM.generate's recorder)
 *        { t: 'done', grid, ms }    the finished grid, functions stripped
 *        { t: 'error', msg }
 * Typed arrays travel as transfers: nothing is copied on the way back. */
'use strict';
self.window = self;
importScripts('noise.js', 'biome.js', 'grid.js', 'generate.js');

// Collect the distinct ArrayBuffers behind every typed array in `obj` (a
// buffer listed twice in a transfer list throws).
function buffersOf(obj, out) {
  var seen = out || [];
  Object.keys(obj).forEach(function (k) {
    var v = obj[k];
    if (v && ArrayBuffer.isView(v) && seen.indexOf(v.buffer) < 0) seen.push(v.buffer);
  });
  return seen;
}

self.onmessage = function (ev) {
  var msg = ev.data || {};
  var want = {};
  (msg.stages || []).forEach(function (id) { want[id] = true; });
  try {
    var t0 = performance.now();
    var grid = self.SM.generate(msg.cfg, function (id, snap) {
      if (!want[id]) return;
      self.postMessage({ t: 'stage', id: id, snap: snap }, buffersOf(snap));
    });
    var data = {};
    Object.keys(grid).forEach(function (k) {
      if (typeof grid[k] !== 'function') data[k] = grid[k];
    });
    self.postMessage({ t: 'done', grid: data, ms: performance.now() - t0 }, buffersOf(data));
  } catch (e) {
    self.postMessage({ t: 'error', msg: String(e && e.message || e) });
  }
};
