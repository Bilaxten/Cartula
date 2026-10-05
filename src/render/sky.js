/* Sky layer for the WebGL voxel view: drifting clouds and a circling flock.
 *
 * M4's remaining animation. Clouds once existed in the classic canvas iso path
 * as painted sprites on a bitmap projection; that whole path was deleted on
 * 2026-09-06. Here they are real geometry in world space, so the orbit camera
 * moves around them instead of past a flat overlay.
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

  // A cloud is a union of up to MAX_LOBES ellipsoids ("lobes"): a body plus
  // puffs, or the separate puffs of a cluster. The shadow is the same union
  // of ellipses, rasterised per frame into a small texture the terrain
  // shader samples once (rasterShadow), so the lobe count no longer costs
  // anything per fragment. The weather clouds (src/render/weather.js, up to
  // MAX_WEATHER_CLOUDS) use the same lobes and mesh builder but cast no
  // shadow (see voxel3d.js updateClouds).
  var MAX_LOBES = 7;
  var MAX_WEATHER_CLOUDS = 3;
  var MAX_SHADOW_LOBES = MAX_CLOUDS * MAX_LOBES;

  // Cube edge of one cloud voxel, in grid cells. Big enough that a cloud reads
  // as a handful of chunky blocks rather than a smooth blob — same visual
  // language as the terrain it floats over.
  var CLOUD_VOXEL = 2.2;
  // Voxel layers are a little flatter than they are wide, and stack without
  // overlapping: two coplanar walls in the same place would be blended twice
  // in the translucent colour pass while a cloud fades in or out.
  var CLOUD_LAYER = CLOUD_VOXEL * 0.8;
  // Thickest cloud, in layers: a one-layer stratus slab and a six-layer
  // cumulus tower side by side is most of what makes the sky read as varied.
  var MAX_LAYERS = 6;
  // Height above the tallest terrain, in unscaled level units. The caller
  // multiplies terrain Y by `vScale`, so the final Y is resolved in
  // `driftClouds` where that scale is known. Low enough to read as a diorama
  // sky, high enough not to sit inside a peak (`--sky` checks every vScale).
  var LIFT_MIN = 3.8;
  var LIFT_MAX = 7.0;
  // Silhouette noise: each voxel's inside-test threshold is jittered in this
  // range, so lobes have ragged rims instead of perfect ellipses.
  var WOBBLE_MIN = 0.8;
  var WOBBLE_SPAN = 0.3;

  // Kept for the birds: their layout predates the cloud rework and changing it
  // would move the flock for no reason.
  function hash(seed, salt) {
    var value = (Math.imul(seed ^ salt, 1103515245) + 12345) >>> 0;
    return (value % 2147483647) / 2147483647;
  }

  /* Uniform 0..1 from (seed, a, b), well mixed (murmur3 finaliser). The old
   * `hash` is a bare LCG of `seed ^ salt`: neighbouring salts give correlated
   * values, which is one reason every cloud used to come out about the same. */
  function rand(seed, a, b) {
    var h = Math.imul(seed | 0, 0x9E3779B1) ^ Math.imul((a | 0) + 0x632BE5AB, 0x85EBCA77) ^
      Math.imul((b | 0) + 0x1B873593, 0xC2B2AE3D);
    h ^= h >>> 16; h = Math.imul(h, 0x7FEB352D);
    h ^= h >>> 15; h = Math.imul(h, 0x846CA68B);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  /* How many clouds a map gets: 4 to 6, from the seed. */
  function cloudCount(seed) {
    return 4 + Math.floor(rand(seed, 991, 7) * 3);
  }

  /* Cloud shapes (owner, 2026-10-05: "bulutlardaki şekil varyasyonunu
   * arttıralım ... yükseklik voxel sayısı farklı bulutlar ... pofuduk
   * bulutlar ... küçük küçük birden fazla buluta sahip bulut kümeleri").
   * Every cloud is a set of lobes { x, z, rx, rz, h, top }: an ellipse on the
   * ground plane, a dome of `h` layers over a flat base, cut at `top`
   * layers (a slab: a high dome cut low). Archetypes, `main` = the size in
   * world units, `r(k)` = a seeded 0..1 per question k:
   *   stratus  one long, wide, flat slab (1-2 layers) plus 1-2 slabs along
   *            it;
   *   cumulus  a flat 1-2 layer base and 2-4 rounded towers on it, the
   *            tallest 4-6 layers: a lumpy top over a flat bottom;
   *   puff     a small round ball ("pofuduk") with one or two bumps;
   *   cluster  3-7 small separate puffs, drifting as one group;
   *   nimbus   the weather clouds: a wide 2-layer base with 3-4 puffy
   *            towers, heavier than a cumulus.
   * Whole voxels only: the lobes are filled on the cloud voxel grid. */
  var ARCHETYPES = ['cumulus', 'stratus', 'puff', 'cluster'];

  function cloudShape(kind, main, r, alongWind) {
    var lobes = [];
    var j;
    var minR = CLOUD_VOXEL * 1.6;
    function lobe(x, z, rx, rz, h, top) {
      lobes.push({
        x: alongWind ? x : z, z: alongWind ? z : x,
        rx: Math.max(minR, alongWind ? rx : rz), rz: Math.max(minR, alongWind ? rz : rx),
        h: h, top: top
      });
    }
    if (kind === 'stratus') {
      var st = 2.2 + r(1) * 1.4;
      var maj = main * Math.sqrt(st);
      var min = main / Math.sqrt(st);
      var thick = r(2) < 0.5 ? 1 : 2;
      lobe(0, 0, maj, min, 4, thick);
      var side = r(3) < 0.5 ? -1 : 1;
      for (j = 0; j < 1 + Math.floor(r(4) * 2); j++) {
        lobe(side * maj * (0.55 + r(10 + j) * 0.3), (r(20 + j) - 0.5) * min * 0.8,
          maj * (0.45 + r(30 + j) * 0.2), min * (0.6 + r(40 + j) * 0.3), 4, thick);
        side = -side;
      }
    } else if (kind === 'cumulus' || kind === 'nimbus') {
      var heavy = kind === 'nimbus';
      // Flat base: a wide low dome cut at 1-2 layers.
      lobe(0, 0, main * (heavy ? 1.15 : 1.0), main * (heavy ? 0.85 : 0.8), 4, heavy ? 2 : 1 + Math.floor(r(1) * 2));
      var towers = (heavy ? 3 : 2) + Math.floor(r(2) * 2);
      var a0 = r(3) * Math.PI * 2;
      for (j = 0; j < towers; j++) {
        var ang = a0 + j * Math.PI * 2 / towers + (r(10 + j) - 0.5) * 0.9;
        var dist = j === 0 ? 0 : main * (0.35 + r(20 + j) * 0.3);
        var tr = main * (j === 0 ? 0.62 : 0.4 + r(30 + j) * 0.18);
        // The first tower is the tallest: 4-6 layers (4.5-5 for nimbus).
        var th = j === 0 ? (heavy ? 4.5 + r(4) * 0.5 : 4 + r(4) * 2) : 2.4 + r(40 + j) * 1.8;
        lobe(Math.cos(ang) * dist, Math.sin(ang) * dist, tr, tr * (0.85 + r(50 + j) * 0.3), th, MAX_LAYERS);
      }
    } else if (kind === 'puff') {
      var pr = main * (0.9 + r(1) * 0.2);
      // Round: the dome is about as tall as it is wide.
      var ph = Math.min(5, Math.max(2.5, pr / CLOUD_LAYER));
      lobe(0, 0, pr, pr * (0.9 + r(2) * 0.2), ph, MAX_LAYERS);
      for (j = 0; j < 1 + Math.floor(r(3) * 2); j++) {
        var pa = r(10 + j) * Math.PI * 2;
        var bump = pr * (0.5 + r(20 + j) * 0.15);
        lobe(Math.cos(pa) * pr * 0.65, Math.sin(pa) * pr * 0.65, bump, bump, Math.max(2, ph * 0.75), MAX_LAYERS);
      }
    } else {
      // Cluster: 3-7 small puffs inside a radius of `main`, kept apart so
      // they read as separate clouds.
      // The first three sit on a triangle (always apart); the others take
      // the first free seeded spot, or are left out.
      var n = 3 + Math.floor(r(1) * 5);
      var turn = r(2) * Math.PI * 2;
      for (j = 0; j < n; j++) {
        var cr = Math.max(minR, main * (0.22 + r(10 + j) * 0.18));
        var crz = cr * (0.85 + r(30 + j) * 0.3);
        var cx = 0;
        var cz = 0;
        var clear = false;
        for (var tries = 0; tries < (j < 3 ? 1 : 30) && !clear; tries++) {
          var ca = j < 3 ? turn + j * Math.PI * 2 / 3 : r(100 + j * 32 + tries) * Math.PI * 2;
          var cd = main * (j < 3 ? 0.72 : 0.3 + 0.9 * Math.sqrt(r(300 + j * 32 + tries)));
          cx = Math.cos(ca) * cd;
          cz = Math.sin(ca) * cd;
          clear = true;
          for (var q = 0; q < lobes.length; q++) {
            var L = lobes[q];
            var need = (Math.max(L.rx, L.rz) + Math.max(cr, crz)) * 1.15;
            if ((L.x - cx) * (L.x - cx) + (L.z - cz) * (L.z - cz) < need * need) { clear = false; break; }
          }
        }
        if (!clear) continue;
        lobes.push({ x: cx, z: cz, rx: cr, rz: crz, h: 1.4 + r(40 + j) * 1.8, top: MAX_LAYERS });
      }
    }
    return lobes;
  }

  /* Horizontal bounding radius of a set of lobes (rim noise and half a voxel
   * included). */
  function lobeReach(lobes) {
    var reach = 0;
    var rim = Math.sqrt(WOBBLE_MIN + WOBBLE_SPAN);
    for (var j = 0; j < lobes.length; j++) {
      var L = lobes[j];
      reach = Math.max(reach, Math.abs(L.x) + L.rx * rim, Math.abs(L.z) + L.rz * rim);
    }
    return reach + CLOUD_VOXEL * 0.5;
  }

  /* Cloud instances: position, archetype, shape, height and drift speed.
   * Deterministic from the seed so the same map always gets the same sky.
   * Varied on five axes:
   *   archetype the first four clouds of a sky are four different
   *             archetypes (seeded order), further ones are drawn freely;
   *   size      stratified over the set, so a sky mixes small and big;
   *   shape     per archetype (cloudShape), stretched along the wind (mostly)
   *             or across it;
   *   thickness 1 (stratus) to 6 (cumulus) voxel layers, per lobe;
   *   height    lift LIFT_MIN..LIFT_MAX, stratified like size; higher clouds
   *             drift a little faster.
   * All clouds still drift the same way: a sky where every cloud moves its own
   * direction reads as noise, not weather. `radius` is the horizontal
   * bounding radius (drift padding and the fade use it). */
  function cloudInstances(bounds, count, seed) {
    var spanX = bounds.maxX - bounds.minX;
    var spanZ = bounds.maxZ - bounds.minZ;
    var n = Math.max(0, Math.min(MAX_CLOUDS, count));
    var list = [];
    var i;

    function strata(salt, m) {
      var order = [];
      for (var a = 0; a < m; a++) order.push(a);
      for (var b = m - 1; b > 0; b--) {
        var c = Math.floor(rand(seed, salt, b) * (b + 1));
        var t = order[b]; order[b] = order[c]; order[c] = t;
      }
      return order;
    }
    var order = strata(17, n);
    var heightOrder = strata(23, n);
    var kinds = strata(29, ARCHETYPES.length);

    for (i = 0; i < n; i++) {
      var r = function (k) { return rand(seed, i * 31 + 101, k); };
      var size = (order[i] + r(0)) / Math.max(1, n);       // 0..1, stratified
      var kind = i < ARCHETYPES.length ? ARCHETYPES[kinds[i]] :
        ARCHETYPES[Math.floor(r(12) * ARCHETYPES.length)];
      // Radius scales with the map so a 64² and a 448² map read the same.
      var main = spanX * ({ stratus: 0.07, cumulus: 0.032, puff: 0.017, cluster: 0.06 }[kind] +
        { stratus: 0.06, cumulus: 0.026, puff: 0.012, cluster: 0.05 }[kind] * size);
      var lobes = cloudShape(kind, main, function (k) { return rand(seed, i * 31 + 7001, k); }, r(2) < 0.75);
      var lift = LIFT_MIN + (heightOrder[i] + r(6)) / Math.max(1, n) * (LIFT_MAX - LIFT_MIN);
      var liftT = (lift - LIFT_MIN) / (LIFT_MAX - LIFT_MIN);
      list.push({
        kind: kind,
        // X is the drift axis, so the start is spread across the full span.
        x: bounds.minX + spanX * r(7),
        z: bounds.minZ + spanZ * (0.12 + r(8) * 0.76),
        radius: lobeReach(lobes),
        lift: lift,
        speed: spanX * (0.008 + r(9) * 0.006) * (0.85 + 0.35 * liftT),
        lobes: lobes,
        // Seed for the per-voxel rim noise in buildCloudMesh.
        shape: Math.floor(r(11) * 2147483647)
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
  function smoothstep(a, b, x) {
    var t = (x - a) / (b - a);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * (3 - 2 * t);
  }

  /* Opacity of a cloud at drift position x (0..1). Clouds wrap around the
   * map, and the orthographic camera sees past its edges, so a cloud used to
   * pop into existence at the wrap point and vanish at the far side (Uğur,
   * 2026-09-23). It now fades in while it crosses onto the map and out as it
   * leaves; at the wrap point (x = minX - pad or maxX + pad) the opacity is
   * exactly 0, so the jump itself is invisible.
   * The fade spans the cloud's own reach (2026-10-05): it is gone by the time
   * its near edge leaves the map. It used to run on to two radii past the
   * edge, which with the longer clouds left a grey ghost hanging beside the
   * map for a long stretch of its drift. */
  function cloudFade(x, radius, bounds) {
    var fadeIn = smoothstep(bounds.minX - radius, bounds.minX + radius, x);
    var fadeOut = 1 - smoothstep(bounds.maxX - radius, bounds.maxX + radius, x);
    return Math.min(fadeIn, fadeOut);
  }

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
      if (!result[i]) result[i] = { x: 0, y: 0, z: 0, radius: 0, fade: 0, lobes: null };
      result[i].x = bounds.minX - pad + wrapped;
      result[i].fade = cloudFade(result[i].x, cloud.radius, bounds);
      result[i].y = topY + cloud.lift * (vScale || 1);
      result[i].z = cloud.z;
      result[i].radius = cloud.radius;
      // Shape for the shadow: the instance's own (immutable) lobe list.
      result[i].lobes = cloud.lobes || null;
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
   * The shadow has the cloud's SHAPE: one soft ellipse per lobe, the same
   * lobes `buildCloudMesh` fills with voxels, so a long cloud casts a long
   * shadow and a side puff casts its own bump. A cloud without `lobes` (a
   * hand-built one) casts one round lobe of its radius.
   *
   * Returns a flat Float32Array of vec4 (u, v, radiusU, radiusV) per lobe,
   * padded to MAX_SHADOW_LOBES so the uniform upload has a constant shape.
   * `fadeOut` (optional, MAX_SHADOW_LOBES floats) receives each lobe's cloud
   * opacity: the shadow fades with its cloud.
   */
  function cloudShadowUniforms(clouds, bounds, sun, out, fadeOut) {
    var spanX = Math.max(1e-6, bounds.maxX - bounds.minX);
    var spanZ = Math.max(1e-6, bounds.maxZ - bounds.minZ);
    // Caller may pass a buffer it owns; the render loop always does.
    var data = out || new Float32Array(MAX_SHADOW_LOBES * 4);

    if (out) data.fill(0);
    if (fadeOut) fadeOut.fill(0);
    var sx = sun && sun.length === 3 ? sun[0] : 0;
    var sy = sun && sun.length === 3 ? sun[1] : 1;
    var sz = sun && sun.length === 3 ? sun[2] : 0;
    var k = 0;
    var i, j;

    // Guard a sun at the horizon: the offset would run to infinity and the
    // shadow would snap across the map in a single frame.
    var lift = Math.max(0.18, Math.abs(sy));

    for (i = 0; i < clouds.length && i < MAX_CLOUDS; i++) {
      var cloud = clouds[i];
      var slide = cloud.y / lift;
      var shadowX = cloud.x - sx * slide;
      var shadowZ = cloud.z - sz * slide;
      var lobes = cloud.lobes;
      var nl = lobes ? lobes.length : 1;
      for (j = 0; j < nl && k < MAX_SHADOW_LOBES; j++, k++) {
        var lx = lobes ? lobes[j].x : 0;
        var lz = lobes ? lobes[j].z : 0;
        var rx = lobes ? lobes[j].rx : cloud.radius;
        var rz = lobes ? lobes[j].rz : cloud.radius;
        data[k * 4] = (shadowX + lx - bounds.minX) / spanX;
        data[k * 4 + 1] = (shadowZ + lz - bounds.minZ) / spanZ;
        // The umbra is a little wider than the lobe and softens at its rim.
        data[k * 4 + 2] = (rx * 1.15) / spanX;
        data[k * 4 + 3] = (rz * 1.15) / spanZ;
        if (fadeOut) fadeOut[k] = cloud.fade == null ? 1 : cloud.fade;
      }
    }
    return data;
  }

  /* The cloud shadow as a w x h coverage image (Uint8Array, 0..255) over the
   * same 0..1 space as cloudShadowUniforms: every lobe a soft ellipse
   * (full inside 45% of its radius, 0 at its rim), times its fade,
   * overlapping lobes merged with max. The terrain shader samples it once
   * per fragment (linear filter) instead of looping over every lobe, so a
   * sky of many lobes costs no more per pixel than one of few. */
  function rasterShadow(data, fade, count, out, w, h) {
    out.fill(0);
    for (var k = 0; k < count; k++) {
      var cu = data[k * 4];
      var cv = data[k * 4 + 1];
      var ru = data[k * 4 + 2];
      var rv = data[k * 4 + 3];
      var f = fade ? fade[k] : 1;
      if (!(ru > 0 && rv > 0) || f <= 0) continue;
      var x0 = Math.max(0, Math.floor((cu - ru) * w - 0.5));
      var x1 = Math.min(w - 1, Math.ceil((cu + ru) * w - 0.5));
      var y0 = Math.max(0, Math.floor((cv - rv) * h - 0.5));
      var y1 = Math.min(h - 1, Math.ceil((cv + rv) * h - 0.5));
      for (var y = y0; y <= y1; y++) {
        var dv = ((y + 0.5) / h - cv) / rv;
        for (var x = x0; x <= x1; x++) {
          var du = ((x + 0.5) / w - cu) / ru;
          var len = Math.sqrt(du * du + dv * dv);
          if (len >= 1) continue;
          var v = Math.round(255 * f * (1 - smoothstep(0.45, 1, len)));
          var o = y * w + x;
          if (v > out[o]) out[o] = v;
        }
      }
    }
    return out;
  }

  /* Number of shadow lobes a cloud list uses (what `uCloudLobeCount` gets). */
  function shadowLobeCount(clouds) {
    var k = 0;
    for (var i = 0; i < clouds.length && i < MAX_CLOUDS; i++) {
      k += clouds[i].lobes ? clouds[i].lobes.length : 1;
    }
    return Math.min(MAX_SHADOW_LOBES, k);
  }

  /* Which voxels of a cloud are filled: Uint8Array over a local box
   * (2*rx+1) x (2*rz+1) x MAX_LAYERS, voxel (gx, gy, gz) centred at
   * (gx * CLOUD_VOXEL, gy * CLOUD_LAYER, gz * CLOUD_VOXEL). A voxel is in when
   * it falls inside any lobe ellipsoid (flat bottom at layer 0, domed top up
   * to the lobe's `h` layers), with a per-voxel jitter on the threshold. */
  function cloudVoxels(cloud) {
    var step = CLOUD_VOXEL;
    var reachX = 1, reachZ = 1;
    var lobes = cloud.lobes || [{ x: 0, z: 0, rx: cloud.radius, rz: cloud.radius, h: 1.6 }];
    var j;
    for (j = 0; j < lobes.length; j++) {
      reachX = Math.max(reachX, Math.ceil((Math.abs(lobes[j].x) + lobes[j].rx * 1.1) / step));
      reachZ = Math.max(reachZ, Math.ceil((Math.abs(lobes[j].z) + lobes[j].rz * 1.1) / step));
    }
    var nx = reachX * 2 + 1, nz = reachZ * 2 + 1;
    var cells = new Uint8Array(nx * nz * MAX_LAYERS);
    var gx, gy, gz;
    for (gy = 0; gy < MAX_LAYERS; gy++) {
      for (gz = -reachZ; gz <= reachZ; gz++) {
        for (gx = -reachX; gx <= reachX; gx++) {
          var px = gx * step, pz = gz * step;
          var wobble = WOBBLE_MIN + WOBBLE_SPAN * rand(cloud.shape | 0, (gx + 4096) * 8192 + gz + 4096, gy);
          for (j = 0; j < lobes.length; j++) {
            var L = lobes[j];
            var ex = (px - L.x) / L.rx;
            var ez = (pz - L.z) / L.rz;
            var ey = gy / L.h;
            if (gy < (L.top || MAX_LAYERS) && ex * ex + ez * ez + ey * ey <= wobble) {
              cells[(gy * nz + (gz + reachZ)) * nx + (gx + reachX)] = 1;
              break;
            }
          }
        }
      }
    }
    return { cells: cells, nx: nx, nz: nz, reachX: reachX, reachZ: reachZ };
  }

  /* Cloud geometry: chunky voxel clouds, one per instance.
   *
   * Positions are LOCAL to the cloud (its origin is the uniform), so drift never
   * touches the buffer — the mesh is uploaded once and lives as long as the map.
   * Only the outer shell is emitted: a face between two filled voxels of the
   * same cloud is never seen (the translucent pass colours only the front-most
   * surface anyway), so it is skipped. That keeps the bigger, lumpier clouds
   * at about a third of the old triangle count.
   */
  function buildCloudMesh(instances) {
    var positions = [];
    var normals = [];
    var indices = [];
    var cloudIndex = [];
    // Index range of each instance (first index, count): the weather
    // clouds are drawn one by one, each in its own colour.
    var ranges = [];
    var hx = CLOUD_VOXEL * 0.5;
    var hy = CLOUD_LAYER * 0.5;
    var FACES = [
      [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]
    ];
    var i;

    function addFace(cx, cy, cz, f, index) {
      // Independent quads: shared corners would smear the flat facet shading
      // that makes these read as blocks instead of a smooth mass.
      var nx = FACES[f][0];
      var ny = FACES[f][1];
      var nz = FACES[f][2];
      // Two in-plane axes for this face (a x b = n keeps the quad CCW).
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
          cx + (nx + ax[0] * u + bx[0] * v) * hx,
          cy + (ny + ax[1] * u + bx[1] * v) * hy,
          cz + (nz + ax[2] * u + bx[2] * v) * hx
        );
        normals.push(nx, ny, nz);
        cloudIndex.push(index);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    for (i = 0; i < instances.length; i++) {
      var first = indices.length;
      var vox = cloudVoxels(instances[i]);
      var nxs = vox.nx, nzs = vox.nz;
      var filled = function (x, y, z) {
        if (x < 0 || z < 0 || y < 0 || x >= nxs || z >= nzs || y >= MAX_LAYERS) return false;
        return vox.cells[(y * nzs + z) * nxs + x] === 1;
      };
      var x, y, z, f;
      for (y = 0; y < MAX_LAYERS; y++) {
        for (z = 0; z < nzs; z++) {
          for (x = 0; x < nxs; x++) {
            if (!filled(x, y, z)) continue;
            for (f = 0; f < 6; f++) {
              if (filled(x + FACES[f][0], y + FACES[f][1], z + FACES[f][2])) continue;
              addFace((x - vox.reachX) * CLOUD_VOXEL, y * CLOUD_LAYER,
                (z - vox.reachZ) * CLOUD_VOXEL, f, i);
            }
          }
        }
      }
      ranges.push([first, indices.length - first]);
    }

    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      cloudIndex: new Float32Array(cloudIndex),
      indices: new Uint32Array(indices),
      ranges: ranges,
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
    // Tallest cloud: the largest `lift` this module can produce, plus the top
    // of the thickest stack above its own origin (layer centres at
    // gy * CLOUD_LAYER, half a layer above the last one).
    var cloudTop = bounds.maxY * scale + LIFT_MAX * scale +
      (MAX_LAYERS - 0.5) * CLOUD_LAYER;
    // Birds: `uFlockSpan.y` times the shader's own 0.75..1.45 spread, plus bob.
    var birdTop = bounds.maxY * scale + (birdReach || spanX * 0.09) * 1.55;
    return Math.max(cloudTop, birdTop);
  }

  SM.Sky = {
    cloudFade: cloudFade,
    cloudShape: cloudShape,
    lobeReach: lobeReach,
    rasterShadow: rasterShadow,
    ARCHETYPES: ARCHETYPES,
    MAX_CLOUDS: MAX_CLOUDS,
    MAX_LOBES: MAX_LOBES,
    MAX_SHADOW_LOBES: MAX_SHADOW_LOBES,
    MAX_WEATHER_CLOUDS: MAX_WEATHER_CLOUDS,
    MAX_LAYERS: MAX_LAYERS,
    CLOUD_VOXEL: CLOUD_VOXEL,
    CLOUD_LAYER: CLOUD_LAYER,
    LIFT_MIN: LIFT_MIN,
    LIFT_MAX: LIFT_MAX,
    cloudCount: cloudCount,
    cloudVoxels: cloudVoxels,
    shadowLobeCount: shadowLobeCount,
    ceiling: ceiling,
    cloudInstances: cloudInstances,
    driftClouds: driftClouds,
    cloudShadowUniforms: cloudShadowUniforms,
    buildCloudMesh: buildCloudMesh,
    buildBirdMesh: buildBirdMesh
  };
})(window.SM = window.SM || {});
