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
    var scale = clamp(cam.scale * next.d / prev.d, minScale, maxScale);
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
    var zoom = clamp(camera.zoom * prev.d / next.d, minZoom, maxZoom);
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

  SM.Touch = { frame: frame, pinchTop: pinchTop, pinchVoxel: pinchVoxel, voxelGroundAt: voxelGroundAt };
})(window.SM = window.SM || {});
