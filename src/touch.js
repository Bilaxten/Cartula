/* Touch navigation math, DOM-free so `node tools/headless.js --layout` can run
 * it (main.js owns the pointer events; this owns what a gesture does to the
 * camera).
 *
 * A two-finger gesture is read as a sequence of frames: the fingers' centroid
 * (x, y, stage pixels) and their distance d. Between two frames the camera
 * pans by the centroid's move and zooms by the distance ratio ABOUT the
 * centroid: the map point that was under the fingers stays under them. A
 * one-finger pan is the same call with an unchanged d. */
(function (SM) {
  'use strict';

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // Centroid and distance of two touch points ({x, y}, stage pixels).
  function frame(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.max(1, Math.sqrt(dx * dx + dy * dy)) };
  }

  /* Top-down view: the camera is a CSS transform, screen = cam.(x, y) +
   * content * cam.scale. The content point under prev's centroid lands under
   * next's centroid at the new scale. */
  function pinchTop(cam, prev, next, minScale, maxScale) {
    // Ratio first: an unchanged spread is then exactly 1, not a float drift.
    var scale = clamp(cam.scale * (next.d / prev.d), minScale, maxScale);
    var k = scale / cam.scale;
    return {
      scale: scale,
      x: next.x - (prev.x - cam.x) * k,
      y: next.y - (prev.y - cam.y) * k
    };
  }

  /* Isometric view: orthographic, `zoom` is the half-width of the view in
   * world units (a bigger zoom shows more). `SM.VoxelCamera.panVector` turns
   * a screen offset into the ground move that keeps the terrain under the
   * cursor; the ground point under a screen offset o from the stage centre
   * is therefore target - panVector(zoom, o). Solve for the new target that
   * puts the point under prev's centroid under next's centroid at the new
   * zoom. Yaw and pitch are untouched (one finger orbits, two never do). */
  function pinchVoxel(camera, prev, next, width, height, minZoom, maxZoom) {
    var pv = SM.VoxelCamera.panVector;
    var zoom = clamp(camera.zoom * (prev.d / next.d), minZoom, maxZoom);
    var p0 = pv(camera.yaw, camera.pitch, camera.zoom, width, prev.x - width / 2, prev.y - height / 2);
    var p1 = pv(camera.yaw, camera.pitch, zoom, width, next.x - width / 2, next.y - height / 2);
    return {
      yaw: camera.yaw,
      pitch: camera.pitch,
      zoom: zoom,
      tx: camera.tx - p0.x + p1.x,
      ty: camera.ty,
      tz: camera.tz - p0.z + p1.z
    };
  }

  // Ground point (world x, z on the target's height) under a stage point.
  function voxelGroundAt(camera, x, y, width, height) {
    var p = SM.VoxelCamera.panVector(camera.yaw, camera.pitch, camera.zoom, width, x - width / 2, y - height / 2);
    return { x: camera.tx - p.x, z: camera.tz - p.z };
  }

  /* Pan or pinch? (Uğur 2026-10-13, real phone: "iki parmak kaydırma kötü
   * çalışıyor, muhtemelen zoom ile çakışıyorlar".) Two fingers that pan
   * together never keep their distance: it wobbles a few per cent, and with
   * the distance ratio applied every frame each pan also zoomed a little
   * (anchored, but the map breathed under the fingers). Like a map app, a
   * two-finger gesture now starts as a pan: the centroid moves the map 1:1
   * at once, the zoom stays put. The zoom engages, once, when the spread has
   * changed from where the gesture started by
   *   - PINCH_HARD (15 %) or more, whatever the fingers did, or
   *   - PINCH_SOFT (6 %) or more AND by at least as many pixels as the
   *     centroid has travelled from its start (a pinch, not a pan),
   * and stays on until the gesture ends; from then on pan and zoom run
   * together. It starts from the frame where it engaged, so nothing jumps
   * (the spread change before it is not applied). Net centroid travel, not
   * path length: in a pure pinch the centroid barely moves.
   *
   * The decision is taken on whole frames only (main.js calls decide once
   * per animation frame, after every finger's pointermove of that frame).
   * A browser sends one event per finger, so between them one finger has
   * moved and the other not yet: in a fast pan (15-20 px per frame) that
   * half-moved pair looks like a 10-15 % spread change that is not there.
   * Navigation itself still runs on every event (no added latency): the pan
   * is exact on half-moved pairs too. */
  var PINCH_SOFT = Math.log(1.06), PINCH_HARD = Math.log(1.15);

  function gesture(f) {
    return { x0: f.x, y0: f.y, d0: f.d, pinch: false };
  }

  // Engage the zoom if the whole frame f says pinch; returns g.pinch.
  function decide(g, f) {
    if (g.pinch) return true;
    var s = Math.abs(Math.log(f.d / g.d0));
    var travel = Math.sqrt((f.x - g.x0) * (f.x - g.x0) + (f.y - g.y0) * (f.y - g.y0));
    if (s >= PINCH_HARD || (s >= PINCH_SOFT && Math.abs(f.d - g.d0) >= travel)) g.pinch = true;
    return g.pinch;
  }

  // The frame to navigate to from prev: next itself once the pinch is on,
  // else next with prev's spread (a pure pan).
  function gestureStep(g, prev, next) {
    return g.pinch ? next : { x: next.x, y: next.y, d: prev.d };
  }

  SM.Touch = { frame: frame, pinchTop: pinchTop, pinchVoxel: pinchVoxel, voxelGroundAt: voxelGroundAt,
    gesture: gesture, decide: decide, gestureStep: gestureStep, PINCH_SOFT: PINCH_SOFT, PINCH_HARD: PINCH_HARD };
})(window.SM = window.SM || {});
