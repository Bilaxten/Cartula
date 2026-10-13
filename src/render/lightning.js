/* Lightning: rain clouds now and then flash, a blocky bolt to the ground.
 *
 * Owner-approved (2026-10-06), reworked 2026-10-13 (owner: brighter, a
 * slight shake, the bolt seen falling from the cloud to the ground). Only
 * the rain clouds of src/render/weather.js (never the snow clouds), only
 * while *Rain & snow* is on. A strike, from its start `te`:
 *   - the descent (DESCENT s): the bolt grows from the cloud's underside
 *     down to the ground, level by level (`reach` 0..1; the bolt shader
 *     clips everything below the front); the cloud starts to glow;
 *   - the arrival (te + DESCENT): the light -- the ground around the
 *     strike and, fainter, the whole map light up from above (the terrain
 *     shader's `uFlash`), the impact tile flares (`hit`), the cloud
 *     brightens (`glow`), the view shakes a few pixels (`shakeAt`); two
 *     pulses (a stroke and one re-strike PULSE_GAP later), each decaying
 *     in under a tenth of a second;
 *   - the bolt, a staircase of vertical drops and short horizontal jogs
 *     along the grid axes (blocky, like the voxels) with one short side
 *     branch, holds BOLT_HOLD after each pulse and fades over BOLT_FADE
 *     (`boltAlpha`).
 *
 * Rare and calm (not seizure-inducing): time is cut into SLOT-second
 * slots, a slot holds a strike with probability CHANCE (seeded), at a
 * seeded moment that keeps strikes at least MIN_GAP seconds apart -- at
 * most 60 / SLOT strikes a minute (5), about 2 on average, each two
 * pulses within 0.3 s, so never more than two flashes in any second. The
 * flash brightens the light by at most FLASH_LIGHT and decays fast.
 * With prefers-reduced-motion the light flash, the flare, the cloud glow
 * and the shake are left out (main.js); the bolt still shows.
 *
 * Stateless: everything is a pure function of (map seed, weather, time),
 * so a frame at time t is reproducible and costs a few hashes. `strikeAt`,
 * `boltPath` and `shakeAt` are DOM- and GL-free (`--lightning` in
 * tools/headless.js); only `createLayer` touches WebGL.
 */
(function (SM) {
  'use strict';

  var SLOT = 12;                // seconds per possible strike
  var CHANCE = 0.42;            // a slot's chance of a strike
  var MIN_GAP = 3;              // seconds between strikes, at least
  var DESCENT = 0.13;           // the bolt falls from cloud to ground, seconds
  var PULSE_GAP = 0.16;         // stroke -> re-strike, seconds (after arrival)
  var DECAY = [0.07, 0.09];     // e-folding time of each pulse, seconds
  var RESTRIKE = 0.65;          // the re-strike's strength
  var WINDOW = DESCENT + 0.7;   // a strike is over after this, seconds
  var BOLT_HOLD = 0.09;         // the bolt at full strength after each pulse
  var BOLT_FADE = 0.14;         // ...then fades out over this
  var PRE_GLOW = 0.35;          // cloud glow at the end of the descent
  var FLASH_LIGHT = 0.9;        // added light at the strike, full flash
  var FLASH_MAP = 0.4;          // share of it the whole map gets
  var HIT_LIGHT = 0.9;          // extra light on the impact tile, full flash
  var HIT_RADIUS = 2.5;         // tiles: the impact flare's radius
  var HIT_DECAY = 0.16;         // e-folding time of the flare, seconds
  var CLOUD_GLOW = 1.3;         // the striking cloud's colour gain at full glow
  var SHAKE_PX = 3;             // view shake at the arrival, CSS pixels
  var SHAKE_TIME = 0.25;        // ...gone after this, seconds
  var REACH = 40;               // tiles: the light's falloff radius
  var MAX_SEGMENTS = 24;
  var WIDTH = 0.36;             // bolt width, tiles
  var MIN_PIXELS = 3.2;         // ...but never thinner than this on screen
  var FLOATS = 7;               // per vertex: position xyz, tangent xyz, side

  function hash(a, b, c) {
    var s = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
    return s - Math.floor(s);
  }

  // Scratch for strikeAt (called every frame: no allocation).
  var centres = new Float32Array(8);
  var fades = new Float32Array(4);

  /* Light of the two pulses, dt seconds after the bolt's arrival. */
  function pulse(dt) {
    if (dt < 0) return 0;
    var f = Math.exp(-dt / DECAY[0]);
    if (dt >= PULSE_GAP) f += RESTRIKE * Math.exp(-(dt - PULSE_GAP) / DECAY[1]);
    return Math.min(1, f);
  }

  /* The bolt's opacity, dt seconds after its arrival: full while it lands
   * and BOLT_HOLD after each pulse, then fading over BOLT_FADE. */
  function boltAlpha(dt) {
    var a = 0;
    var starts = [0, PULSE_GAP];
    for (var k = 0; k < 2; k++) {
      var d = dt - starts[k];
      if (d < 0) continue;
      a = Math.max(a, d <= BOLT_HOLD ? 1 : Math.max(0, 1 - (d - BOLT_HOLD) / BOLT_FADE));
    }
    return a;
  }

  /* The strike at time t, into `out`: { active, cloud (index into the
   * weather clouds), x, y (grid, the bolt's foot), top, ground (levels:
   * cloud underside, ground), since (seconds since the strike began),
   * reach (0..1: how far the bolt has fallen), flash (0..1, the light,
   * from the arrival on), hit (0..1, the impact flare), glow (0..1, the
   * cloud), boltAlpha (0..1), bolt (true while visible), id (the slot) }.
   * `built` is SM.Weather.build's output; `seed` the map's. */
  function strikeAt(built, seed, t, out) {
    out = out || {};
    out.active = false;
    out.flash = 0;
    out.hit = 0;
    out.glow = 0;
    out.reach = 0;
    out.boltAlpha = 0;
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
      var da = dt - DESCENT;    // since the arrival (negative: falling)
      out.since = dt;
      out.reach = Math.min(1, dt / DESCENT);
      out.flash = pulse(da);
      out.hit = da < 0 ? 0 : Math.max(out.flash, Math.exp(-da / HIT_DECAY));
      out.glow = da < 0 ? PRE_GLOW * out.reach : Math.max(PRE_GLOW * Math.exp(-da / HIT_DECAY), out.flash);
      out.boltAlpha = da < 0 ? 1 : boltAlpha(da);
      out.bolt = out.boltAlpha > 0;
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

  /* The view's shake for a strike, into `out` [x, y] in CSS pixels: from
   * the bolt's arrival, SHAKE_PX at most, an uneven jitter that dies out
   * over SHAKE_TIME. [0, 0] otherwise. Seeded per strike. */
  function shakeAt(st, out) {
    out = out || [0, 0];
    out[0] = 0;
    out[1] = 0;
    if (!st || !st.active) return out;
    var da = st.since - DESCENT;
    if (!(da >= 0 && da < SHAKE_TIME)) return out;
    var env = 1 - da / SHAKE_TIME;
    env *= env;
    var px = hash(st.seed, st.id, 140) * 6.2831853;
    var py = hash(st.seed, st.id, 141) * 6.2831853;
    out[0] = SHAKE_PX * env * Math.sin(da * 2 * Math.PI * 23 + px);
    out[1] = SHAKE_PX * env * 0.7 * Math.sin(da * 2 * Math.PI * 17 + py);
    return out;
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
      'out highp float vLevel;',
      'void main() {',
      '  vLevel = aPosition.y;',
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
      'in highp float vLevel;',
      'uniform vec3 uColor;',
      // The falling bolt: everything below the front level is not there
      // yet (highp: levels reach a few dozen, a fraction matters).
      'uniform highp float uFront;',
      'uniform float uAlpha;',
      'out vec4 outColor;',
      'void main() {',
      '  if (vLevel < uFront) discard;',
      '  // A light source: not graded (it stays bright at night).',
      '  outColor = vec4(uColor, uAlpha);',
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
    ['uViewProjection', 'uVScale', 'uEye', 'uPixelWorld', 'uColor', 'uFront', 'uAlpha'].forEach(function (n) {
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

    /* `o`: { combined, vScale, eye[3], pixelWorld, strike, width, height }.
     * Drawn before the clouds: the translucent cloud passes over it. */
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
      // The front falls from the cloud's underside to the ground; once it
      // lands nothing is clipped (the foot's half-width end included).
      var top = Math.max(1, st.top - 0.3 - st.ground) + st.ground;
      gl.uniform1f(loc.uFront, st.reach >= 1 ? -1e4 : top - (top - st.ground) * st.reach);
      gl.uniform1f(loc.uAlpha, st.boltAlpha);
      gl.bindVertexArray(vao);
      gl.disable(gl.CULL_FACE);
      // Fading, it blends; it writes depth only while solid, so a faint
      // bolt never cuts a cloud behind it.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(st.boltAlpha >= 0.99);
      acct.drawElements(gl.TRIANGLES, count * 6, gl.UNSIGNED_INT, 0);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
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
    boltAlpha: boltAlpha,
    shakeAt: shakeAt,
    createLayer: createLayer,
    SLOT: SLOT,
    CHANCE: CHANCE,
    MIN_GAP: MIN_GAP,
    PULSE_GAP: PULSE_GAP,
    WINDOW: WINDOW,
    DESCENT: DESCENT,
    BOLT_HOLD: BOLT_HOLD,
    BOLT_FADE: BOLT_FADE,
    FLASH_LIGHT: FLASH_LIGHT,
    FLASH_MAP: FLASH_MAP,
    HIT_LIGHT: HIT_LIGHT,
    HIT_RADIUS: HIT_RADIUS,
    CLOUD_GLOW: CLOUD_GLOW,
    SHAKE_PX: SHAKE_PX,
    SHAKE_TIME: SHAKE_TIME,
    REACH: REACH,
    MAX_SEGMENTS: MAX_SEGMENTS
  };
})(window.SM = window.SM || {});
