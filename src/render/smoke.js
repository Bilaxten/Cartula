/* Volcano smoke: blocky plumes rising from lava craters, bent by the wind.
 *
 * Owner-approved (2026-10-06). One plume per volcano: a vent sits on the
 * crater -- the centre of the highest lava tiles of each lava field of at
 * least MIN_LAVA tiles, at most MAX_VENTS, largest first. A plume is
 * PUFFS axis-aligned cubes (the voxel language of the clouds: whole
 * blocks that never rotate), each born at the vent, rising, growing, and
 * dissipating by shrinking back to nothing -- not by fading, so every
 * puff stays one opacity and the clouds' depth-prepass trick (each pixel
 * blended once) holds without sorting.
 *
 * The wind is the wind lines' own field (src/render/wind.js), sampled at
 * the vent: the plume leaves the crater upright and bends over downwind,
 * more the higher it rises (drift ~ age^1.4). No second wind.
 *
 * Colour: palette only -- dark ash near the vent (volcanic rock toward
 * rock grey), paler higher up (rock toward snow). At night the underside
 * of the low puffs is lit by the lava under them (the palette's lava
 * colour, added after the night grade like the lava light itself,
 * flickering with the lava pulse), fading with height.
 *
 * Cheap: at most MAX_VENTS x PUFFS cubes (4 x 14 x 12 triangles), ONE
 * static buffer per map; every puff's path is a pure function of time in
 * the vertex shader (time stepped at the wind lines' 12 Hz, the same
 * hand-animated look), the vents and their winds are uniforms. A map
 * without lava draws nothing.
 *
 * `vents`, `build` and `puffAt` (the JS twin of the vertex shader's path)
 * are DOM- and GL-free (`--smoke` in tools/headless.js).
 */
(function (SM) {
  'use strict';

  var MAX_VENTS = 4;
  var PUFFS = 18;               // per plume
  var MIN_LAVA = 3;             // lava tiles for a field to smoke
  var LIFE = 10;                // seconds from vent to gone
  var RISE = 0.88;              // levels per second, at the start
  // A puff's top stays below the clouds' lowest possible underside
  // (SM.Sky.LIFT_MIN above the tallest ground), so the camera fit
  // (SM.Sky.ceiling) never has to know about smoke: rise x LIFE x (1 - 0.35/2.5)
  // + a puff's size stays under it (`--smoke` checks).
  var DECEL = 0.35;
  var DRIFT = 0.7;              // share of the wind lines' speed (SM.Wind.SPEED)
  var SIZE = [0.35, 1.2];       // edge, tiles: at birth, grown (x 0.75..1.25 per puff)
  var ALPHA = 0.82;
  var EDGE = 1.5;               // tiles past the map edge to shrink to nothing
  var UPDATE_HZ = 12;
  var FLOATS = 9;               // per vertex: corner xyz, normal xyz, vent, phase, jitter

  function rgb01(id) {
    var hex = SM.BIOME_LIST.find(function (b) { return b.id === id; }).color;
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }

  function mix(a, b, t) {
    return a.map(function (v, k) { return v * (1 - t) + b[k] * t; });
  }

  /* Craters: per 4-connected lava field of >= MIN_LAVA tiles, the centre of
   * its highest tiles. Grid coordinates (tile centres at +0.5); `level` is
   * that crater's level. Largest fields first, at most MAX_VENTS. */
  function vents(grid) {
    var W = grid.width;
    var H = grid.height;
    var lava = grid.lava;
    var seen = new Uint8Array(W * H);
    var out = [];
    var i;

    if (!lava) return out;
    for (i = 0; i < W * H; i++) {
      if (!lava[i] || seen[i]) continue;
      var q = [i];
      seen[i] = 1;
      for (var h = 0; h < q.length; h++) {
        var c = q[h];
        var x = c % W;
        var y = (c / W) | 0;
        var nb = [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, y > 0 ? c - W : -1, y < H - 1 ? c + W : -1];
        for (var k = 0; k < 4; k++) {
          if (nb[k] >= 0 && lava[nb[k]] && !seen[nb[k]]) { seen[nb[k]] = 1; q.push(nb[k]); }
        }
      }
      if (q.length < MIN_LAVA) continue;
      var top = -1e9;
      q.forEach(function (j) { if (grid.level[j] > top) top = grid.level[j]; });
      var sx = 0;
      var sy = 0;
      var n = 0;
      q.forEach(function (j) {
        if (grid.level[j] !== top) return;
        sx += j % W + 0.5;
        sy += ((j / W) | 0) + 0.5;
        n++;
      });
      out.push({ x: sx / n, y: sy / n, level: top, size: q.length });
    }
    out.sort(function (a, b) { return b.size - a.size || a.y - b.y || a.x - b.x; });
    return out.slice(0, MAX_VENTS);
  }

  /* Smoke of one map: vents, each with its wind (tiles/s along grid x/y,
   * the wind field sampled at the vent), and the static vertex data.
   * `windField` may be null (no wind module): the plumes then rise
   * straight. */
  function build(grid, windField) {
    var list = vents(grid);
    var rnd = SM.mulberry32((((grid.config && grid.config.seed) | 0) ^ 0x5307e) >>> 0);
    var data = new Float32Array(list.length * PUFFS * 24 * FLOATS);
    var indices = new Uint32Array(list.length * PUFFS * 36);
    var o = 0;
    var ix = 0;
    var base = 0;
    var speed = SM.Wind ? SM.Wind.SPEED : 2.4;

    list.forEach(function (v) {
      if (windField && SM.Wind) {
        var u = SM.Wind.sample(windField.u, windField, v.x, v.y);
        var w = SM.Wind.sample(windField.v, windField, v.x, v.y);
        var s = SM.Wind.sample(windField.speed, windField, v.x, v.y);
        var len = Math.sqrt(u * u + w * w) || 1;
        v.wind = [u / len * s * speed * DRIFT, w / len * s * speed * DRIFT];
      } else {
        v.wind = [0, 0];
      }
    });
    for (var vi = 0; vi < list.length; vi++) {
      for (var p = 0; p < PUFFS; p++) {
        var phase = (p + rnd() * 0.6) / PUFFS;
        var jitter = rnd();
        // Six faces, four corners each, CCW seen from outside.
        for (var axis = 0; axis < 3; axis++) {
          for (var sign = -1; sign <= 1; sign += 2) {
            var nrm = [0, 0, 0];
            nrm[axis] = sign;
            var a1 = (axis + 1) % 3;
            var a2 = (axis + 2) % 3;
            var quad = sign > 0 ? [[-1, -1], [1, -1], [1, 1], [-1, 1]] : [[-1, -1], [-1, 1], [1, 1], [1, -1]];
            for (var k = 0; k < 4; k++) {
              var cpos = [0, 0, 0];
              cpos[axis] = sign * 0.5;
              cpos[a1] = quad[k][0] * 0.5;
              cpos[a2] = quad[k][1] * 0.5;
              data[o++] = cpos[0];
              data[o++] = cpos[1];
              data[o++] = cpos[2];
              data[o++] = nrm[0];
              data[o++] = nrm[1];
              data[o++] = nrm[2];
              data[o++] = vi;
              data[o++] = phase;
              data[o++] = jitter;
            }
            indices.set([base, base + 1, base + 2, base, base + 2, base + 3], ix);
            ix += 6;
            base += 4;
          }
        }
      }
    }
    return {
      vents: list,
      puffs: list.length * PUFFS,
      data: data,
      indices: indices,
      width: grid.width,
      height: grid.height
    };
  }

  function hash(x, salt) {
    var s = Math.sin(x * 127.1 + salt * 311.7) * 43758.5453;
    return s - Math.floor(s);
  }

  function smoothstep(a, b, x) {
    var t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  /* Puff `p` of vent `v` at time t (the vertex shader's path, in JS): its
   * age (0..1), centre in grid coordinates (x, y) and level (unscaled,
   * centre), and edge `size` (tiles). */
  function puffAt(built, vi, p, t, out) {
    var v = built.vents[vi];
    var stride = 24 * FLOATS;
    var rec = (vi * PUFFS + p) * stride;
    var phase = built.data[rec + 7];
    var jitter = built.data[rec + 8];
    var ts = Math.floor(t * UPDATE_HZ) / UPDATE_HZ;
    var age = ts / LIFE + phase;
    age -= Math.floor(age);
    var life = age * LIFE;
    var spread = 0.2 + 1.1 * age;
    var bend = Math.pow(age, 1.4) * LIFE;
    out = out || {};
    out.age = age;
    out.x = v.x + v.wind[0] * bend + (hash(jitter, 1) - 0.5) * 2 * spread;
    out.y = v.y + v.wind[1] * bend + (hash(jitter, 2) - 0.5) * 2 * spread;
    out.level = v.level + 0.6 + RISE * life * (1 - DECEL * age) * (0.9 + 0.2 * hash(jitter, 3));
    // Past the map edge a puff shrinks away within EDGE tiles, like the
    // wind lines and the clouds: nothing hangs over the void.
    var outside = Math.max(-out.x, out.x - built.width, -out.y, out.y - built.height);
    out.size = (SIZE[0] + (SIZE[1] - SIZE[0]) * smoothstep(0, 0.4, age)) * (1 - smoothstep(0.7, 1, age)) *
      (0.75 + 0.5 * hash(jitter, 4)) * (1 - smoothstep(0, EDGE, outside));
    return out;
  }

  function glslFloat(value) {
    var text = String(value);
    return text.indexOf('.') < 0 ? text + '.0' : text;
  }

  function makeSmokeProgram(gl, gradeGLSL) {
    var vertexSource = [
      '#version 300 es',
      'in vec3 aCorner;',
      'in vec3 aNormal;',
      'in vec3 aPuff;',            // vent index, phase, jitter
      'uniform mat4 uViewProjection;',
      'uniform float uVScale;',
      'uniform highp float uTime;',
      // Per vent: world x, world z, crater level; and its wind (world x/z,
      // tiles per second).
      'uniform vec3 uVent[' + MAX_VENTS + '];',
      'uniform vec2 uVentWind[' + MAX_VENTS + '];',
      'uniform vec2 uMapHalf;',     // half the map, tiles (world x/z are centred)
      'out vec3 vNormal;',
      'out float vAge;',
      'out float vVent;',
      'float hash(float x, float salt) {',
      '  return fract(sin(x * 127.1 + salt * 311.7) * 43758.5453);',
      '}',
      'void main() {',
      '  int vi = int(aPuff.x + 0.5);',
      '  vec3 v = uVent[vi];',
      '  highp float ts = floor(uTime * ' + glslFloat(UPDATE_HZ) + ') / ' + glslFloat(UPDATE_HZ) + ';',
      '  float age = fract(ts / ' + glslFloat(LIFE) + ' + aPuff.y);',
      '  float life = age * ' + glslFloat(LIFE) + ';',
      '  float spread = 0.2 + 1.1 * age;',
      '  float bend = pow(age, 1.4) * ' + glslFloat(LIFE) + ';',
      '  vec2 jit = (vec2(hash(aPuff.z, 1.0), hash(aPuff.z, 2.0)) - 0.5) * 2.0 * spread;',
      '  vec2 xz = v.xy + uVentWind[vi] * bend + jit;',
      '  float level = v.z + 0.6 + ' + glslFloat(RISE) + ' * life * (1.0 - ' + glslFloat(DECEL) + ' * age) *',
      '    (0.9 + 0.2 * hash(aPuff.z, 3.0));',
      '  float size = mix(' + glslFloat(SIZE[0]) + ', ' + glslFloat(SIZE[1]) + ', smoothstep(0.0, 0.4, age)) *',
      '    (1.0 - smoothstep(0.7, 1.0, age)) * (0.75 + 0.5 * hash(aPuff.z, 4.0));',
      '  vec2 past = abs(xz) - uMapHalf;',
      '  size *= 1.0 - smoothstep(0.0, ' + glslFloat(EDGE) + ', max(past.x, past.y));',
      '  vNormal = aNormal;',
      '  vAge = age;',
      '  vVent = aPuff.x;',
      '  vec3 p = vec3(xz.x, level * uVScale, xz.y) + aCorner * size;',
      '  gl_Position = uViewProjection * vec4(p, 1.0);',
      '}'
    ].join('\n');
    var fragmentSource = [
      '#version 300 es',
      'precision mediump float;',
      'in vec3 vNormal;',
      'in float vAge;',
      'in float vVent;',
      'uniform vec3 uAsh;',
      'uniform vec3 uSteam;',
      'uniform vec3 uLava;',
      'uniform vec3 uSunDirection;',
      'uniform float uSunStrength;',
      'uniform float uNightLight;',
      'uniform highp float uTime;',
      gradeGLSL,
      'out vec4 outColor;',
      'void main() {',
      '  float daylight = clamp(uSunStrength / 0.42, 0.0, 1.0);',
      '  float ndl = max(0.0, dot(normalize(vNormal), normalize(uSunDirection)));',
      '  // Lit like the clouds, so it darkens at dusk with them.',
      '  float lambert = mix(0.62, 0.80, daylight) + 0.26 * daylight * ndl;',
      '  vec3 c = mix(uAsh, uSteam, smoothstep(0.0, 0.6, vAge)) * lambert;',
      '  // Lava light from below: undersides most, then the sides (what the',
      '  // camera sees from above), tops least; low puffs most; with the lava',
      '  // pulse; after the night grade, like the lava itself.',
      '  float under = vNormal.y < -0.5 ? 1.0 : (vNormal.y > 0.5 ? 0.3 : 0.7);',
      '  float pulse = 0.85 + 0.15 * sin(uTime * 2.40 + vVent * 1.7);',
      '  vec3 glow = uLava * uNightLight * 1.1 * pow(1.0 - vAge, 1.3) * under * pulse;',
      '  outColor = vec4(grade(c) + glow, ' + glslFloat(ALPHA) + ');',
      '}'
    ].join('\n');
    return SM.buildGLProgram(gl, 'smoke', vertexSource, fragmentSource,
      ['aCorner', 'aNormal', 'aPuff']);
  }

  function createLayer(gl, acct, gradeGLSL) {
    var program = makeSmokeProgram(gl, gradeGLSL);
    var vao;
    var vbo;
    var ibo;
    var loc = {};
    var built = null;
    var count = 0;
    var ventData = new Float32Array(MAX_VENTS * 3);
    var windData = new Float32Array(MAX_VENTS * 2);
    var ash = mix(rgb01('volcanic'), rgb01('rock'), 0.45);
    var steam = mix(rgb01('rock'), rgb01('snow'), 0.55);
    var lava = rgb01('lava');

    if (!program) return null;
    vao = gl.createVertexArray();
    vbo = gl.createBuffer();
    ibo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    [[0, 3, 0], [1, 3, 3], [2, 3, 6]].forEach(function (a) {
      gl.enableVertexAttribArray(a[0]);
      gl.vertexAttribPointer(a[0], a[1], gl.FLOAT, false, FLOATS * 4, a[2] * 4);
    });
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bindVertexArray(null);
    ['uViewProjection', 'uVScale', 'uTime', 'uVent', 'uVentWind', 'uMapHalf', 'uAsh', 'uSteam', 'uLava',
      'uSunDirection', 'uSunStrength', 'uNightLight', 'uGradeTint', 'uGradeBS', 'uGradeOn'
    ].forEach(function (n) { loc[n] = gl.getUniformLocation(program, n); });

    /* Per map: the output of `build` (or null). */
    function setData(b) {
      built = b && b.vents.length ? b : null;
      count = built ? built.indices.length : 0;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      acct.bufferData(gl.ARRAY_BUFFER, vbo, built ? built.data : new Float32Array(0), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      acct.bufferData(gl.ELEMENT_ARRAY_BUFFER, ibo, built ? built.indices : new Uint32Array(0), gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      ventData.fill(0);
      windData.fill(0);
      if (!built) return;
      built.vents.forEach(function (v, k) {
        ventData[k * 3] = v.x - built.width / 2;
        ventData[k * 3 + 1] = v.y - built.height / 2;
        ventData[k * 3 + 2] = v.level;
        windData[k * 2] = v.wind[0];
        windData[k * 2 + 1] = v.wind[1];
      });
    }

    /* `o`: { combined, vScale, time, sun[3], strength, night, setGrade } */
    function draw(o) {
      if (!count) return;
      gl.useProgram(program);
      gl.uniformMatrix4fv(loc.uViewProjection, false, o.combined);
      gl.uniform1f(loc.uVScale, o.vScale);
      gl.uniform1f(loc.uTime, o.time);
      gl.uniform3fv(loc.uVent, ventData);
      gl.uniform2fv(loc.uVentWind, windData);
      gl.uniform2f(loc.uMapHalf, built.width / 2, built.height / 2);
      gl.uniform3fv(loc.uAsh, ash);
      gl.uniform3fv(loc.uSteam, steam);
      gl.uniform3fv(loc.uLava, lava);
      gl.uniform3fv(loc.uSunDirection, o.sun);
      gl.uniform1f(loc.uSunStrength, o.strength);
      gl.uniform1f(loc.uNightLight, o.night);
      o.setGrade(loc.uGradeTint, loc.uGradeBS, loc.uGradeOn);
      gl.bindVertexArray(vao);
      // As the clouds: depth first, then only the front-most surface is
      // blended, so overlapping puffs never show each other's inner faces.
      gl.colorMask(false, false, false, false);
      acct.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, 0);
      gl.colorMask(true, true, true, true);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);
      acct.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, 0);
      gl.depthMask(true);
      gl.depthFunc(gl.LESS);
      gl.disable(gl.BLEND);
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

    return { setData: setData, draw: draw, dispose: dispose };
  }

  SM.Smoke = {
    vents: vents,
    build: build,
    puffAt: puffAt,
    createLayer: createLayer,
    MAX_VENTS: MAX_VENTS,
    PUFFS: PUFFS,
    MIN_LAVA: MIN_LAVA,
    LIFE: LIFE,
    RISE: RISE,
    DECEL: DECEL,
    SIZE: SIZE,
    EDGE: EDGE,
    ALPHA: ALPHA,
    UPDATE_HZ: UPDATE_HZ
  };
})(window.SM = window.SM || {});
