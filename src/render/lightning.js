/* Lightning: rain clouds now and then flash, a blocky bolt to the ground.
 *
 * Owner-approved (2026-10-06). Only the rain clouds of src/render/weather.js
 * (never the snow clouds), only while *Rain & snow* is on. A strike is:
 *   - a brief light: the ground around the strike (and, fainter, the whole
 *     map) lights up from above -- the terrain shader's `uFlash` -- and the
 *     cloud itself brightens; two pulses (a stroke and one re-strike
 *     PULSE_GAP later), each decaying in under a tenth of a second;
 *   - the bolt, from the cloud's underside down to the ground under it, a
 *     staircase of vertical drops and short horizontal jogs along the
 *     grid axes (blocky, like the voxels) with one short side branch,
 *     visible during the two pulses only.
 *
 * Rare and calm (not seizure-inducing): time is cut into SLOT-second
 * slots, a slot holds a strike with probability CHANCE (seeded), at a
 * seeded moment that keeps strikes at least MIN_GAP seconds apart -- at
 * most 60 / SLOT strikes a minute (5), about 2 on average, each two
 * pulses within 0.3 s, so never more than two flashes in any second. The
 * flash brightens the light by at most FLASH_LIGHT; nothing goes white.
 * With prefers-reduced-motion the light flash is left out (main.js); the
 * bolt still shows.
 *
 * Stateless: everything is a pure function of (map seed, weather, time),
 * so a frame at time t is reproducible and costs a few hashes. `strikeAt`
 * and `boltPath` are DOM- and GL-free (`--lightning` in tools/headless.js);
 * only `createLayer` touches WebGL.
 */
(function (SM) {
  'use strict';

  var SLOT = 12;                // seconds per possible strike
  var CHANCE = 0.42;            // a slot's chance of a strike
  var MIN_GAP = 3;              // seconds between strikes, at least
  var PULSE_GAP = 0.16;         // stroke -> re-strike, seconds
  var DECAY = [0.07, 0.09];     // e-folding time of each pulse, seconds
  var RESTRIKE = 0.65;          // the re-strike's strength
  var WINDOW = 0.7;             // a strike is over after this, seconds
  var BOLT_ON = 0.11;           // bolt visible this long after each pulse
  var FLASH_LIGHT = 0.5;        // added light at the strike, full flash
  var REACH = 40;               // tiles: the light's falloff radius
  var MAX_SEGMENTS = 24;
  var WIDTH = 0.28;             // bolt width, tiles
  var MIN_PIXELS = 2.6;         // ...but never thinner than this on screen
  var FLOATS = 7;               // per vertex: position xyz, tangent xyz, side

  function hash(a, b, c) {
    var s = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
    return s - Math.floor(s);
  }

  // Scratch for strikeAt (called every frame: no allocation).
  var centres = new Float32Array(8);
  var fades = new Float32Array(4);

  function pulse(dt) {
    if (dt < 0) return 0;
    var f = Math.exp(-dt / DECAY[0]);
    if (dt >= PULSE_GAP) f += RESTRIKE * Math.exp(-(dt - PULSE_GAP) / DECAY[1]);
    return Math.min(1, f);
  }

  /* The strike at time t, into `out`: { active, cloud (index into the
   * weather clouds), x, y (grid, the bolt's foot), top, ground (levels:
   * cloud underside, ground), flash (0..1), bolt (true while visible),
   * id (the slot) }. `built` is SM.Weather.build's output; `seed` the
   * map's. */
  function strikeAt(built, seed, t, out) {
    out = out || {};
    out.active = false;
    out.flash = 0;
    out.bolt = false;
    if (!built || !built.clouds.length) return out;
    var rainCount = 0;
    var c;
    for (c = 0; c < built.clouds.length; c++) if (built.clouds[c].kind === 'rain') rainCount++;
    if (!rainCount) return out;
    var slot = Math.floor(t / SLOT);
    for (var s = slot; s >= slot - 1; s--) {
      if (hash(seed, s, 1) >= CHANCE) continue;
      // Within the slot, leaving MIN_GAP before the next slot's earliest.
      var te = s * SLOT + MIN_GAP + hash(seed, s, 2) * (SLOT - MIN_GAP - 1);
      var dt = t - te;
      if (dt < 0 || dt > WINDOW) continue;
      // The k-th rain cloud.
      var pick = Math.floor(hash(seed, s, 3) * rainCount);
      var n = -1;
      for (c = 0; c < built.clouds.length && n < 0; c++) {
        if (built.clouds[c].kind === 'rain' && pick-- === 0) n = c;
      }
      var cl = built.clouds[n];
      SM.Weather.cloudsAt(built, te, centres, fades);
      if (fades[n] < 0.5) continue;
      // A point under the cloud's lobes, fixed for the strike (the cloud
      // drifts on, the bolt does not).
      var px = NaN;
      var py = NaN;
      for (var k = 0; k < 8; k++) {
        var lx = (hash(seed, s, 10 + k) * 2 - 1) * cl.radius * 0.7;
        var lz = (hash(seed, s, 30 + k) * 2 - 1) * cl.radius * 0.7;
        if (!SM.Weather.insideLobes(cl.lobes, lx, lz, 0.7)) continue;
        px = centres[n * 2] + lx;
        py = centres[n * 2 + 1] + lz;
        break;
      }
      if (!(px >= 0 && py >= 0 && px < built.width && py < built.height)) continue;
      var gi = Math.floor(py) * built.width + Math.floor(px);
      out.active = true;
      out.cloud = n;
      out.x = Math.floor(px) + 0.5;
      out.y = Math.floor(py) + 0.5;
      out.top = cl.bottom;
      out.ground = built.ground[gi * 2];
      out.flash = pulse(dt);
      out.bolt = dt < BOLT_ON || (dt >= PULSE_GAP && dt < PULSE_GAP + BOLT_ON);
      out.id = s;
      out.seed = seed;
      return out;
    }
    return out;
  }

  /* The bolt of a strike as segments [x0, level0, y0, x1, level1, y1, ...]
   * (grid x/y, levels): vertical drops and horizontal jogs along the grid
   * axes from the cloud's underside to the ground, and one side branch.
   * Pure function of the strike (seed, id, top, ground, foot). */
  function boltPath(st) {
    var segs = [];
    var drop = Math.max(1, st.top - 0.3 - st.ground);
    var steps = Math.max(3, Math.min(8, Math.round(drop / 1.5)));
    var x = st.x;
    var y = st.y;
    var branchAt = 1 + Math.floor(hash(st.seed, st.id, 50) * Math.max(1, steps - 2));
    // Walk up from the foot so the bolt lands exactly on its tile: the
    // jogs are mirrored, the same staircase.
    var pts = [[x, st.ground, y]];
    for (var i = 1; i <= steps; i++) {
      var lv = st.ground + drop * i / steps;
      pts.push([x, lv, y]);
      if (i < steps) {
        var r = hash(st.seed, st.id, 60 + i);
        var len = (0.35 + 0.35 * hash(st.seed, st.id, 80 + i)) * (r < 0.5 ? -1 : 1);
        if (hash(st.seed, st.id, 100 + i) < 0.5) x += len; else y += len;
        pts.push([x, lv, y]);
      }
    }
    for (var j = 0; j + 1 < pts.length && segs.length / 6 < MAX_SEGMENTS - 2; j++) {
      segs.push(pts[j][0], pts[j][1], pts[j][2], pts[j + 1][0], pts[j + 1][1], pts[j + 1][2]);
    }
    // One branch: off a joint high up, a jog out and a short drop.
    var bj = Math.min(pts.length - 1, 2 * branchAt);
    var b0 = pts[bj];
    var bl = 0.6 * (hash(st.seed, st.id, 120) < 0.5 ? -1 : 1);
    var bx = b0[0] + (hash(st.seed, st.id, 121) < 0.5 ? bl : 0);
    var by = b0[2] + (bx === b0[0] ? bl : 0);
    var bh = Math.max(st.ground + 0.2, b0[1] - Math.min(1.6, drop / steps * 1.2));
    segs.push(b0[0], b0[1], b0[2], bx, b0[1], by);
    segs.push(bx, b0[1], by, bx, bh, by);
    return segs;
  }

  function makeBoltProgram(gl) {
    var vertexSource = [
      '#version 300 es',
      'in vec3 aPosition;',
      'in vec3 aTangent;',
      'in float aSide;',
      'uniform mat4 uViewProjection;',
      'uniform float uVScale;',
      'uniform vec3 uEye;',
      'uniform float uPixelWorld;',
      'void main() {',
      '  vec3 p = vec3(aPosition.x, aPosition.y * uVScale, aPosition.z);',
      '  vec3 t = vec3(aTangent.x, aTangent.y * uVScale, aTangent.z);',
      '  // Camera-facing strip across the segment, like the wind lines.',
      '  vec3 side = cross(t, uEye);',
      '  float len = length(side);',
      '  side = len > 1e-5 ? side / len : vec3(1.0, 0.0, 0.0);',
      '  float w = max(' + WIDTH.toFixed(2) + ', ' + MIN_PIXELS.toFixed(2) + ' * uPixelWorld) * 0.5;',
      '  gl_Position = uViewProjection * vec4(p + side * aSide * w, 1.0);',
      '}'
    ].join('\n');
    var fragmentSource = [
      '#version 300 es',
      'precision mediump float;',
      'uniform vec3 uColor;',
      'out vec4 outColor;',
      'void main() {',
      '  // A light source: not graded (it stays bright at night).',
      '  outColor = vec4(uColor, 1.0);',
      '}'
    ].join('\n');
    return SM.buildGLProgram(gl, 'lightning', vertexSource, fragmentSource,
      ['aPosition', 'aTangent', 'aSide']);
  }

  function rgb01(id) {
    var hex = SM.BIOME_LIST.find(function (b) { return b.id === id; }).color;
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }

  /* GL side: one small dynamic buffer, refilled only when the strike
   * changes. */
  function createLayer(gl, acct) {
    var program = makeBoltProgram(gl);
    var vao;
    var vbo;
    var ibo;
    var loc = {};
    var data = new Float32Array(MAX_SEGMENTS * 4 * FLOATS);
    var count = 0;
    var current = '';
    // Palette snow, a touch toward the shallow sea's blue.
    var color = rgb01('snow').map(function (v, k) { return v * 0.85 + rgb01('shallow_water')[k] * 0.15; });

    if (!program) return null;
    vao = gl.createVertexArray();
    vbo = gl.createBuffer();
    ibo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    acct.bufferData(gl.ARRAY_BUFFER, vbo, data.byteLength, gl.DYNAMIC_DRAW);
    [[0, 3, 0], [1, 3, 3], [2, 1, 6]].forEach(function (a) {
      gl.enableVertexAttribArray(a[0]);
      gl.vertexAttribPointer(a[0], a[1], gl.FLOAT, false, FLOATS * 4, a[2] * 4);
    });
    var idx = new Uint32Array(MAX_SEGMENTS * 6);
    for (var q = 0; q < MAX_SEGMENTS; q++) idx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 1, q * 4 + 3, q * 4 + 2], q * 6);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    acct.bufferData(gl.ELEMENT_ARRAY_BUFFER, ibo, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    ['uViewProjection', 'uVScale', 'uEye', 'uPixelWorld', 'uColor'].forEach(function (n) {
      loc[n] = gl.getUniformLocation(program, n);
    });

    function fill(st, W, H) {
      var segs = boltPath(st);
      var o = 0;
      count = Math.min(MAX_SEGMENTS, segs.length / 6);
      for (var s = 0; s < count; s++) {
        var a = segs.slice(s * 6, s * 6 + 3);
        var b = segs.slice(s * 6 + 3, s * 6 + 6);
        // Extend each segment by half a width at both ends, so the joints
        // of the staircase close.
        var dx = b[0] - a[0];
        var dl = b[1] - a[1];
        var dy = b[2] - a[2];
        var l = Math.sqrt(dx * dx + dl * dl + dy * dy) || 1;
        var e = WIDTH * 0.5 / l;
        var ends = [[a[0] - dx * e, a[1] - dl * e, a[2] - dy * e], [b[0] + dx * e, b[1] + dl * e, b[2] + dy * e]];
        for (var end = 0; end < 2; end++) {
          for (var side = -1; side <= 1; side += 2) {
            data[o++] = ends[end][0] - W / 2;
            data[o++] = ends[end][1];
            data[o++] = ends[end][2] - H / 2;
            data[o++] = dx;
            data[o++] = dl;
            data[o++] = dy;
            data[o++] = side;
          }
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, o);
    }

    /* `o`: { combined, vScale, eye[3], pixelWorld, strike, width, height } */
    function draw(o) {
      var st = o.strike;
      if (!st || !st.active || !st.bolt) return;
      var key = st.seed + ':' + st.id;
      if (key !== current) {
        current = key;
        fill(st, o.width, o.height);
      }
      if (!count) return;
      gl.useProgram(program);
      gl.uniformMatrix4fv(loc.uViewProjection, false, o.combined);
      gl.uniform1f(loc.uVScale, o.vScale);
      gl.uniform3fv(loc.uEye, o.eye);
      gl.uniform1f(loc.uPixelWorld, o.pixelWorld);
      gl.uniform3fv(loc.uColor, color);
      gl.bindVertexArray(vao);
      gl.disable(gl.CULL_FACE);
      acct.drawElements(gl.TRIANGLES, count * 6, gl.UNSIGNED_INT, 0);
      gl.enable(gl.CULL_FACE);
      gl.bindVertexArray(null);
    }

    function dispose() {
      gl.deleteBuffer(vbo);
      gl.deleteBuffer(ibo);
      acct.forget(vbo);
      acct.forget(ibo);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    }

    return { draw: draw, dispose: dispose };
  }

  SM.Lightning = {
    strikeAt: strikeAt,
    boltPath: boltPath,
    pulse: pulse,
    createLayer: createLayer,
    SLOT: SLOT,
    CHANCE: CHANCE,
    MIN_GAP: MIN_GAP,
    PULSE_GAP: PULSE_GAP,
    WINDOW: WINDOW,
    BOLT_ON: BOLT_ON,
    FLASH_LIGHT: FLASH_LIGHT,
    REACH: REACH,
    MAX_SEGMENTS: MAX_SEGMENTS
  };
})(window.SM = window.SM || {});
