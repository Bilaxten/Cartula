/* Sky layer for the WebGL voxel view: drifting clouds and a circling flock.
 *
 * M4's remaining animation. Clouds already existed in the classic canvas iso
 * path (`main.js`, `drawClouds`), but that path is a bitmap projection — the
 * clouds were painted sprites. Here they are real geometry in world space, so
 * the orbit camera moves around them instead of past a flat overlay.
 *
 * WHY A SEPARATE FILE: `voxel3d.js` is already the largest renderer and this is
 * a distinct concern with its own geometry. Everything here is PURE — no GL, no
 * DOM — so `tools/headless.js --sky` can verify it under Node, the same
 * contract `buildVoxelMesh` follows.
 *
 * ONE SOURCE OF TRUTH FOR CLOUD POSITION: the cloud shadow is drawn by the
 * TERRAIN shader (it darkens the ground), while the cloud body is drawn by the
 * SKY shader. If each computed drift on its own the two would separate over
 * time — a shadow sliding out from under its cloud is exactly the kind of bug
 * that survives a screenshot. So drift is computed ONCE in JS
 * (`SM.driftClouds`) and handed to both programs as uniforms.
 */
(function (SM) {
  'use strict';

  // Uniform arrays are fixed-size in GLSL; this is the ceiling both shaders
  // declare. Raising it means editing the shader arrays too.
  var MAX_CLOUDS = 6;

  // Cube edge of one cloud voxel, in grid cells. Big enough that a cloud reads
  // as a handful of chunky blocks rather than a smooth blob — same visual
  // language as the terrain it floats over.
  var CLOUD_VOXEL = 2.2;

  function hash(seed, salt) {
    var value = (Math.imul(seed ^ salt, 1103515245) + 12345) >>> 0;
    return (value % 2147483647) / 2147483647;
  }

  /* Cloud instances: position, radius and drift speed. Deterministic from the
   * seed so the same map always gets the same sky. */
  function cloudInstances(bounds, count, seed) {
    var spanX = bounds.maxX - bounds.minX;
    var spanZ = bounds.maxZ - bounds.minZ;
    var n = Math.max(0, Math.min(MAX_CLOUDS, count));
    var list = [];
    var i;

    for (i = 0; i < n; i++) {
      // Radius scales with the map so a 64² and a 192² map read the same.
      var radius = spanX * (0.055 + hash(seed, i * 7 + 1) * 0.055);
      list.push({
        // X is the drift axis, so the start is spread across the full span.
        x: bounds.minX + spanX * hash(seed, i * 7 + 2),
        z: bounds.minZ + spanZ * (0.12 + hash(seed, i * 7 + 3) * 0.76),
        radius: radius,
        // Height above the tallest terrain, in unscaled level units. The caller
        // multiplies terrain Y by `vScale`, so the final Y is resolved in
        // `driftClouds` where that scale is known.
        // Low enough to read as a diorama sky, high enough not to sit inside a
        // peak. Measured against the tallest terrain at vScale 1.6.
        lift: 4.0 + hash(seed, i * 7 + 4) * 2.6,
        // A shared direction with a small spread: a sky where every cloud moves
        // at its own speed reads as noise, not weather.
        speed: spanX * (0.010 + hash(seed, i * 7 + 5) * 0.006)
      });
    }
    return list;
  }

  /* Advance clouds to `time` and resolve their world position.
   *
   * Pure: returns a fresh array, never mutates the instances. Wrapping happens
   * over a span padded by the cloud radius so a cloud leaves the map completely
   * before reappearing on the other side.
   */
  function driftClouds(instances, time, bounds, vScale, out) {
    var spanX = bounds.maxX - bounds.minX;
    var topY = bounds.maxY * (vScale || 1);
    var result = out || [];
    var i;

    result.length = instances.length;
    for (i = 0; i < instances.length; i++) {
      var cloud = instances[i];
      var pad = cloud.radius * 2;
      var range = spanX + pad * 2;
      var travelled = cloud.x - bounds.minX + pad + cloud.speed * time;
      var wrapped = travelled - Math.floor(travelled / range) * range;
      // `out` is reused across frames by the renderer, so entries are updated
      // in place rather than replaced -- this runs once per frame.
      if (!result[i]) result[i] = { x: 0, y: 0, z: 0, radius: 0 };
      result[i].x = bounds.minX - pad + wrapped;
      result[i].y = topY + cloud.lift * (vScale || 1);
      result[i].z = cloud.z;
      result[i].radius = cloud.radius;
    }
    return result;
  }

  /* Where each cloud's shadow lands, in the terrain's cell-UV space.
   *
   * The terrain fragment shader has `vCellUV` (0..1 across the map) but no world
   * position, so the shadow is expressed in that space. A cloud does not cast
   * straight down: the higher it floats and the lower the sun, the further the
   * shadow slides opposite the sun's horizontal direction.
   *
   * Returns a flat Float32Array of vec3 (u, v, radiusInUV), padded to
   * MAX_CLOUDS so the uniform upload has a constant shape.
   */
  function cloudShadowUniforms(clouds, bounds, sun, out) {
    var spanX = Math.max(1e-6, bounds.maxX - bounds.minX);
    var spanZ = Math.max(1e-6, bounds.maxZ - bounds.minZ);
    // Caller may pass a buffer it owns; the render loop always does.
    var data = out || new Float32Array(MAX_CLOUDS * 3);

    if (out) data.fill(0);
    var sx = sun && sun.length === 3 ? sun[0] : 0;
    var sy = sun && sun.length === 3 ? sun[1] : 1;
    var sz = sun && sun.length === 3 ? sun[2] : 0;
    var i;

    // Guard a sun at the horizon: the offset would run to infinity and the
    // shadow would snap across the map in a single frame.
    var lift = Math.max(0.18, Math.abs(sy));

    for (i = 0; i < clouds.length && i < MAX_CLOUDS; i++) {
      var cloud = clouds[i];
      var slide = cloud.y / lift;
      var shadowX = cloud.x - sx * slide;
      var shadowZ = cloud.z - sz * slide;
      data[i * 3] = (shadowX - bounds.minX) / spanX;
      data[i * 3 + 1] = (shadowZ - bounds.minZ) / spanZ;
      // The umbra is a little wider than the cloud and softens at its rim.
      data[i * 3 + 2] = (cloud.radius * 1.15) / spanX;
    }
    return data;
  }

  /* Cloud geometry: chunky voxel blobs, one blob per instance.
   *
   * Positions are LOCAL to the cloud (its origin is the uniform), so drift never
   * touches the buffer — the mesh is uploaded once and lives as long as the map.
   */
  function buildCloudMesh(instances) {
    var positions = [];
    var normals = [];
    var indices = [];
    var cloudIndex = [];
    var i;

    function addBox(cx, cy, cz, half, index) {
      // Six independent quads: shared corners would smear the flat facet shading
      // that makes these read as blocks instead of a smooth mass.
      var faces = [
        [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]
      ];
      var f;
      for (f = 0; f < faces.length; f++) {
        var nx = faces[f][0];
        var ny = faces[f][1];
        var nz = faces[f][2];
        // Two in-plane axes for this face.
        var ax = ny !== 0 || nz !== 0 ? [1, 0, 0] : [0, 1, 0];
        var bx = [
          ny * ax[2] - nz * ax[1],
          nz * ax[0] - nx * ax[2],
          nx * ax[1] - ny * ax[0]
        ];
        var base = positions.length / 3;
        var corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        var c;
        for (c = 0; c < 4; c++) {
          var u = corners[c][0];
          var v = corners[c][1];
          positions.push(
            cx + (nx + ax[0] * u + bx[0] * v) * half,
            cy + (ny + ax[1] * u + bx[1] * v) * half,
            cz + (nz + ax[2] * u + bx[2] * v) * half
          );
          normals.push(nx, ny, nz);
          cloudIndex.push(index);
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }

    for (i = 0; i < instances.length; i++) {
      var cloud = instances[i];
      var radius = cloud.radius;
      var step = CLOUD_VOXEL;
      var reach = Math.max(1, Math.round(radius / step));
      var gx, gy, gz;
      // A squashed ellipsoid: clouds are wide and flat, never spherical.
      for (gy = 0; gy <= 1; gy++) {
        for (gz = -reach; gz <= reach; gz++) {
          for (gx = -reach; gx <= reach; gx++) {
            var ex = gx / reach;
            var ez = gz / reach;
            var ey = gy / 1.6;
            // Per-cloud noise breaks the silhouette so no two look stamped.
            var wobble = 0.78 + hash(i * 131 + gx * 17 + gz * 7, gy + 3) * 0.34;
            if (ex * ex + ez * ez + ey * ey > wobble) continue;
            addBox(gx * step, gy * step * 0.8, gz * step, step * 0.5, i);
          }
        }
      }
    }

    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      cloudIndex: new Float32Array(cloudIndex),
      indices: new Uint32Array(indices),
      vertexCount: positions.length / 3,
      triangleCount: indices.length / 3
    };
  }

  /* Bird geometry: a flock of small V shapes.
   *
   * Birds do NOT get JS-side state. Unlike clouds nothing else in the scene
   * needs to know where a bird is, so its whole path lives in the vertex shader
   * and the buffer is built once. Each vertex carries which bird it belongs to
   * and which wing it is, and the shader derives orbit, height, heading and
   * flap from that index.
   *
   * `wing`: -1 left tip, +1 right tip, 0 body. The shader rotates the tips
   * around the body axis; the body vertices stay put.
   */
  function buildBirdMesh(count, seed) {
    var positions = [];
    var birdIndex = [];
    var wing = [];
    var indices = [];
    var n = Math.max(0, count);
    var i;

    for (i = 0; i < n; i++) {
      // Size varies a little so the flock has depth rather than reading as one
      // repeated sprite.
      var scale = 0.85 + hash(seed, i * 3 + 1) * 0.5;
      var base = positions.length / 3;

      // Body: a short bar along the flight direction (local +X).
      positions.push(-0.35 * scale, 0, 0);
      birdIndex.push(i); wing.push(0);
      positions.push(0.55 * scale, 0, 0);
      birdIndex.push(i); wing.push(0);

      // Wing tips, one on each side.
      positions.push(-0.15 * scale, 0, -1.15 * scale);
      birdIndex.push(i); wing.push(-1);
      positions.push(-0.15 * scale, 0, 1.15 * scale);
      birdIndex.push(i); wing.push(1);

      // Two triangles: body-to-left-tip and body-to-right-tip. A bird at this
      // size is two strokes; anything more is invisible and costs vertices.
      indices.push(base, base + 1, base + 2);
      indices.push(base, base + 1, base + 3);
    }

    return {
      positions: new Float32Array(positions),
      birdIndex: new Float32Array(birdIndex),
      wing: new Float32Array(wing),
      indices: new Uint32Array(indices),
      vertexCount: positions.length / 3,
      triangleCount: indices.length / 3
    };
  }

  /* The highest point the sky reaches, in the same scaled world Y the camera
   * works in.
   *
   * ⚠️ THE CAMERA MUST KNOW THIS. `fitCamera` framed the TERRAIN only, so the
   * first version of the sky was built, uploaded, drawn -- and clipped away
   * entirely by the ortho frustum. No GL error, no console warning, just an
   * empty sky: the exact failure that looks like "the feature was never
   * implemented". Anything added above the terrain has to be reported here.
   */
  function ceiling(bounds, vScale, birdReach) {
    var scale = vScale || 1;
    var spanX = bounds.maxX - bounds.minX;
    // Tallest cloud: the largest `lift` this module can produce, plus the blob
    // half-height above its own origin.
    var cloudTop = bounds.maxY * scale + (4.0 + 2.6) * scale + CLOUD_VOXEL;
    // Birds: `uFlockSpan.y` times the shader's own 0.75..1.45 spread, plus bob.
    var birdTop = bounds.maxY * scale + (birdReach || spanX * 0.09) * 1.55;
    return Math.max(cloudTop, birdTop);
  }

  SM.Sky = {
    MAX_CLOUDS: MAX_CLOUDS,
    ceiling: ceiling,
    cloudInstances: cloudInstances,
    driftClouds: driftClouds,
    cloudShadowUniforms: cloudShadowUniforms,
    buildCloudMesh: buildCloudMesh,
    buildBirdMesh: buildBirdMesh
  };
})(window.SM = window.SM || {});
