/* Wind lines over the voxel view: short tapered streaks drifting over the
 * map and following the terrain -- along valleys, around high ground.
 *
 * Look: the stylized wind trails of cel-shaded games (Wind Waker, Breath of
 * the Wild): a thin light ribbon that fades in, glides, and fades out, thin
 * at both ends. Calm, few, never a particle storm.
 *
 * Flow: not a simulation. A cheap, deterministic heuristic in the spirit of
 * how wind behaves in complex terrain (it is steered by the slope where
 * relief is strong and channelled along valley axes):
 *
 *   1. h  = terrain level (water counts as its surface), box-blurred twice so
 *           single voxel steps do not steer the air;
 *   2. w0 = one prevailing direction per map seed;
 *   3. per cell, with n = the uphill unit gradient and s = how steep it is:
 *        - the part of w0 that would climb the slope is removed (air goes
 *          around high ground instead of over it),
 *        - the result is bent toward the contour direction closest to w0
 *          (the valley axis), and pulled a little downhill (low ground
 *          gathers the flow),
 *        - plus a little divergence-free curl noise (the curl of a smooth
 *          noise potential), so neighbouring lines do not run in lockstep;
 *   4. the field is blurred once more and normalised; speed drops slightly
 *      on steep ground.
 *
 * Streaks are stateless: streak k's position is a pure function of
 * (seed, k, time). Each lives a few seconds; its spawn point for every
 * "generation" comes from a hash, and its path is the field integrated from
 * there (fixed half-tile steps), so a frame never depends on frame timing
 * and a screenshot at time t is reproducible. A bounded number of streaks
 * (MAX_STREAKS) x points keeps the per-frame work and upload fixed.
 *
 * Everything above is DOM- and GL-free (checked by `--wind` in
 * tools/headless.js); only `createLayer` touches WebGL.
 */
(function (SM) {
  'use strict';

  var MAX_STREAKS = 64;
  var POINTS = 24;              // per streak, head included (~12 tiles)
  var STEP = 0.5;               // tiles between integration steps / points
  var SPEED = 2.4;              // tiles per second at full speed
  var LIFT = 1.4;               // levels above the smoothed ground
  var WIDTH = 0.3;              // ribbon width in tiles, at its widest
  var MIN_PIXELS = 2.2;         // ...but never thinner than this on screen
  var FLOATS = 8;               // per vertex: pos3, tangent3, side*width, alpha

  function hash(a, b, c) {
    var h = (a | 0) ^ Math.imul(b | 0, 0x9e3779b1) ^ Math.imul(c | 0, 0x85ebca77);
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function boxBlur(src, W, H, r) {
    var tmp = new Float32Array(W * H);
    var out = new Float32Array(W * H);
    var x;
    var y;
    var k;
    var sum;
    var n;

    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        sum = 0;
        n = 0;
        for (k = -r; k <= r; k++) {
          if (x + k < 0 || x + k >= W) continue;
          sum += src[y * W + x + k];
          n++;
        }
        tmp[y * W + x] = sum / n;
      }
    }
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        sum = 0;
        n = 0;
        for (k = -r; k <= r; k++) {
          if (y + k < 0 || y + k >= H) continue;
          sum += tmp[(y + k) * W + x];
          n++;
        }
        out[y * W + x] = sum / n;
      }
    }
    return out;
  }

  function smoothstep(a, b, x) {
    var t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  /* The flow field of one map. `seed` picks the prevailing direction and the
   * curl noise. Returns grid-sized arrays (cell centres). */
  function field(grid, seed) {
    var W = grid.width;
    var H = grid.height;
    var n = W * H;
    var level = new Float32Array(n);
    var ground = new Float32Array(n);
    var u = new Float32Array(n);
    var v = new Float32Array(n);
    var speed = new Float32Array(n);
    var s = (seed | 0) ^ 0x5eed;
    var angle = hash(s, 1, 2) * Math.PI * 2;
    var w0x = Math.cos(angle);
    var w0y = Math.sin(angle);
    var noise = SM.makeNoise2D ? SM.makeNoise2D(s) : function () { return 0; };
    var NOISE_SCALE = 0.035;
    // Curl-noise share against |w0| = 1, after normalising by the mean curl
    // magnitude of this map (simplex gradients average ~3 per noise unit;
    // unnormalised, the noise drowned the prevailing wind -- seen 2026-10-05).
    var CURL = 0.25;
    var curlX = new Float32Array(n);
    var curlY = new Float32Array(n);
    var curlMean = 0;
    var h;
    var i;
    var x;
    var y;

    for (i = 0; i < n; i++) level[i] = Math.max(0, grid.level[i]);
    h = boxBlur(boxBlur(level, W, H, 3), W, H, 3);

    // Ride height: the highest level in the 3x3 around a cell, lightly
    // smoothed, so a streak glides over ridges instead of cutting into them.
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        var m = 0;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            var xx = Math.max(0, Math.min(W - 1, x + dx));
            var yy = Math.max(0, Math.min(H - 1, y + dy));
            if (level[yy * W + xx] > m) m = level[yy * W + xx];
          }
        }
        ground[y * W + x] = m;
      }
    }
    // Smoothed, but never below the raw 3x3 maximum: a bilinear sample
    // inside a cell then mixes only centres that are each at least that
    // cell's own level, so a streak cannot sink into a column (--wind).
    var smoothGround = boxBlur(ground, W, H, 1);
    for (i = 0; i < n; i++) ground[i] = Math.max(ground[i], smoothGround[i]);

    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        var e = 0.8;
        i = y * W + x;
        // Curl of a smooth potential psi: (dpsi/dy, -dpsi/dx).
        curlX[i] = (noise(x * NOISE_SCALE, (y + e) * NOISE_SCALE) -
          noise(x * NOISE_SCALE, (y - e) * NOISE_SCALE)) / (2 * e * NOISE_SCALE);
        curlY[i] = -(noise((x + e) * NOISE_SCALE, y * NOISE_SCALE) -
          noise((x - e) * NOISE_SCALE, y * NOISE_SCALE)) / (2 * e * NOISE_SCALE);
        curlMean += Math.sqrt(curlX[i] * curlX[i] + curlY[i] * curlY[i]) / n;
      }
    }
    curlMean = curlMean || 1;

    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        i = y * W + x;
        var gx = (h[y * W + Math.min(W - 1, x + 1)] - h[y * W + Math.max(0, x - 1)]) * 0.5;
        var gy = (h[Math.min(H - 1, y + 1) * W + x] - h[Math.max(0, y - 1) * W + x]) * 0.5;
        var gl = Math.sqrt(gx * gx + gy * gy);
        var steep = smoothstep(0.04, 0.35, gl);
        var nx = gl > 1e-6 ? gx / gl : 0;
        var ny = gl > 1e-6 ? gy / gl : 0;
        var up = w0x * nx + w0y * ny;
        var vx = w0x;
        var vy = w0y;
        var tx = -ny;
        var ty = nx;

        // 1. Do not climb: remove the uphill share where it is steep.
        if (up > 0) {
          vx -= nx * up * steep;
          vy -= ny * up * steep;
        }
        // 2. Follow the valley axis: bend toward the contour direction that
        //    is closest to the prevailing wind.
        //    Weighted by how well the valley lines up with the wind: where it
        //    runs across the wind the contour choice flips sign, and full
        //    steering there made opposite arrows meet head-on (a sink line
        //    where streaks stalled -- seen in the field debug image).
        var along = tx * w0x + ty * w0y;
        if (along < 0) {
          tx = -tx;
          ty = -ty;
          along = -along;
        }
        vx += (tx - vx) * 0.6 * steep * along;
        vy += (ty - vy) * 0.6 * steep * along;
        // 3. Low ground gathers the flow -- gently: a stronger pull made
        //    sinks in closed basins where streaks bunched up and stalled.
        vx -= nx * 0.1 * steep;
        vy -= ny * 0.1 * steep;
        // 4. A little divergence-free curl noise.
        vx += CURL * curlX[i] / curlMean;
        vy += CURL * curlY[i] / curlMean;
        u[i] = vx;
        v[i] = vy;
        // Where the steering cancels most of the wind, the air slows down
        // rather than picking an arbitrary normalised direction at speed.
        speed[i] = Math.max(0.3, Math.min(1, Math.sqrt(vx * vx + vy * vy))) *
          (1 - 0.35 * steep);
      }
    }
    u = boxBlur(u, W, H, 1);
    v = boxBlur(v, W, H, 1);
    for (i = 0; i < n; i++) {
      var len = Math.sqrt(u[i] * u[i] + v[i] * v[i]) || 1;
      u[i] /= len;
      v[i] /= len;
    }
    return {
      width: W,
      height: H,
      u: u,
      v: v,
      speed: speed,
      ground: ground,
      smooth: h,
      prevailing: [w0x, w0y],
      seed: seed | 0
    };
  }

  // Bilinear sample of a cell-centred array at continuous grid coordinates.
  function sample(arr, f, px, py) {
    var fx = Math.max(0, Math.min(f.width - 1.001, px - 0.5));
    var fy = Math.max(0, Math.min(f.height - 1.001, py - 0.5));
    var x0 = Math.floor(fx);
    var y0 = Math.floor(fy);
    var ax = fx - x0;
    var ay = fy - y0;
    var i = y0 * f.width + x0;
    return (arr[i] * (1 - ax) + arr[i + 1] * ax) * (1 - ay) +
      (arr[i + f.width] * (1 - ax) + arr[i + f.width + 1] * ax) * ay;
  }

  // Reusable output of streaksInto (typed arrays: nothing is allocated per
  // frame -- per-frame garbage is banned in this renderer's draw path).
  function makeStreakBuffers() {
    return {
      count: 0,
      x: new Float32Array(MAX_STREAKS * POINTS),
      y: new Float32Array(MAX_STREAKS * POINTS),
      ground: new Float32Array(MAX_STREAKS * POINTS),
      alpha: new Float32Array(MAX_STREAKS),
      ringX: new Float32Array(POINTS),
      ringY: new Float32Array(POINTS)
    };
  }

  /* All streaks at time t as polylines in grid space, into `out`:
   * point j of streak k (j = 0 tail .. POINTS-1 head) at index k*POINTS+j;
   * out.alpha[k] is the life fade (0..1). Pure function of (field, t). */
  function streaksInto(f, t, count, out) {
    var n = Math.min(MAX_STREAKS, Math.max(0, count | 0));
    var k;
    var j;

    for (k = 0; k < n; k++) {
      var life = 4.5 + 2.5 * hash(f.seed, k, 101);
      var clock = t + life * hash(f.seed, k, 202);
      var gen = Math.floor(clock / life);
      var age = clock - gen * life;
      var px = 1 + hash(f.seed, k * 977 + gen, 303) * (f.width - 2);
      var py = 1 + hash(f.seed, k * 977 + gen, 404) * (f.height - 2);
      // Pre-rolled by its own length: a streak fades in already whole
      // instead of growing out of its spawn point.
      var steps = Math.floor(age * SPEED / STEP) + POINTS - 1;
      var written = 1;
      var base = k * POINTS;

      // The last POINTS positions of the path, in a ring.
      out.ringX[0] = px;
      out.ringY[0] = py;
      for (j = 0; j < steps; j++) {
        // Midpoint (RK2) step of STEP tiles, scaled by the local speed.
        var sp = sample(f.speed, f, px, py) * STEP;
        var mx = px + sample(f.u, f, px, py) * sp * 0.5;
        var my = py + sample(f.v, f, px, py) * sp * 0.5;
        px += sample(f.u, f, mx, my) * sp;
        py += sample(f.v, f, mx, my) * sp;
        px = Math.max(0.5, Math.min(f.width - 0.5, px));
        py = Math.max(0.5, Math.min(f.height - 0.5, py));
        out.ringX[written % POINTS] = px;
        out.ringY[written % POINTS] = py;
        written++;
      }
      // Unroll oldest -> newest; a young streak repeats its spawn point
      // (zero-length segments are invisible).
      for (j = 0; j < POINTS; j++) {
        var src = written <= POINTS ? Math.max(0, j - (POINTS - written)) :
          (written + j) % POINTS;
        out.x[base + j] = out.ringX[src];
        out.y[base + j] = out.ringY[src];
        out.ground[base + j] = sample(f.ground, f, out.ringX[src], out.ringY[src]);
      }
      // Fade in over the first second, out over the last 1.5 s.
      out.alpha[k] = smoothstep(0, 1, age) * smoothstep(life, life - 1.5, age);
    }
    out.count = n;
    return out;
  }

  /* Ribbon vertices for `streaksInto` output, into `buf` (Float32Array of
   * MAX_STREAKS * POINTS * 2 * FLOATS). World space: x - W/2, level, y - H/2
   * (level is scaled by the shader). Returns the vertex count written. */
  function ribbons(f, s, buf) {
    var o = 0;
    var k;
    var j;

    for (k = 0; k < s.count; k++) {
      var base = k * POINTS;
      for (j = 0; j < POINTS; j++) {
        var a = base + Math.max(0, j - 1);
        var b = base + Math.min(POINTS - 1, j + 1);
        var q = base + j;
        var along = j / (POINTS - 1);
        // Thin at both ends, widest just behind the head; brighter toward
        // the head, so it reads as moving forward.
        var width = WIDTH * Math.pow(Math.sin(Math.PI * Math.min(1, along * 1.08)), 0.7);
        var alpha = s.alpha[k] * Math.pow(along, 0.8);
        for (var side = -1; side <= 1; side += 2) {
          buf[o++] = s.x[q] - f.width / 2;
          buf[o++] = s.ground[q] + LIFT;
          buf[o++] = s.y[q] - f.height / 2;
          buf[o++] = s.x[b] - s.x[a];
          buf[o++] = s.ground[b] - s.ground[a];
          buf[o++] = s.y[b] - s.y[a];
          buf[o++] = side * width;
          buf[o++] = alpha;
        }
      }
    }
    return o / FLOATS;
  }

  function ribbonIndices() {
    var idx = new Uint32Array(MAX_STREAKS * (POINTS - 1) * 6);
    var o = 0;
    for (var k = 0; k < MAX_STREAKS; k++) {
      for (var j = 0; j < POINTS - 1; j++) {
        var a = (k * POINTS + j) * 2;
        idx[o++] = a;
        idx[o++] = a + 1;
        idx[o++] = a + 2;
        idx[o++] = a + 1;
        idx[o++] = a + 3;
        idx[o++] = a + 2;
      }
    }
    return idx;
  }

  function makeWindProgram(gl, gradeGLSL) {
    var vertexSource = [
      '#version 300 es',
      'in vec3 aPosition;',
      'in vec3 aTangent;',
      'in float aSide;',
      'in float aAlpha;',
      'uniform mat4 uViewProjection;',
      'uniform float uVScale;',
      // Camera direction in scaled world space (towards the eye).
      'uniform vec3 uEye;',
      // World units per pixel (ortho): keeps the widest point at least
      // MIN_PIXELS wide when zoomed out, scaling the whole taper with it.
      'uniform float uPixelWorld;',
      'out float vAlpha;',
      'void main() {',
      '  vec3 p = vec3(aPosition.x, aPosition.y * uVScale, aPosition.z);',
      '  vec3 t = vec3(aTangent.x, aTangent.y * uVScale, aTangent.z);',
      '  // Camera-facing ribbon: widen across the path and the view direction.',
      '  vec3 side = cross(t, uEye);',
      '  float len = length(side);',
      '  side = len > 1e-5 ? side / len : vec3(0.0);',
      '  vAlpha = aAlpha;',
      '  float grow = max(1.0, ' + MIN_PIXELS.toFixed(2) + ' * uPixelWorld / ' + WIDTH.toFixed(2) + ');',
      '  gl_Position = uViewProjection * vec4(p + side * aSide * grow, 1.0);',
      '}'
    ].join('\n');
    var fragmentSource = [
      '#version 300 es',
      'precision mediump float;',
      'in float vAlpha;',
      'uniform vec3 uColor;',
      'uniform float uOpacity;',
      gradeGLSL,
      'out vec4 outColor;',
      'void main() {',
      '  outColor = vec4(grade(uColor), vAlpha * uOpacity);',
      '}'
    ].join('\n');
    return SM.buildGLProgram(gl, 'wind', vertexSource, fragmentSource,
      ['aPosition', 'aTangent', 'aSide', 'aAlpha']);
  }

  /* GL side: one dynamic interleaved buffer, refilled each drawn frame. */
  function createLayer(gl, acct, gradeGLSL) {
    var program = makeWindProgram(gl, gradeGLSL);
    var vao;
    var vbo;
    var ibo;
    var data;
    var loc;
    var current = null;     // the field of the current map
    var tracks = makeStreakBuffers();

    if (!program) return null;
    vao = gl.createVertexArray();
    vbo = gl.createBuffer();
    ibo = gl.createBuffer();
    data = new Float32Array(MAX_STREAKS * POINTS * 2 * FLOATS);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    acct.bufferData(gl.ARRAY_BUFFER, vbo, data.byteLength, gl.DYNAMIC_DRAW);
    [[0, 3, 0], [1, 3, 3], [2, 1, 6], [3, 1, 7]].forEach(function (a) {
      gl.enableVertexAttribArray(a[0]);
      gl.vertexAttribPointer(a[0], a[1], gl.FLOAT, false, FLOATS * 4, a[2] * 4);
    });
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    acct.bufferData(gl.ELEMENT_ARRAY_BUFFER, ibo, ribbonIndices(), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    loc = {
      viewProjection: gl.getUniformLocation(program, 'uViewProjection'),
      vScale: gl.getUniformLocation(program, 'uVScale'),
      eye: gl.getUniformLocation(program, 'uEye'),
      pixelWorld: gl.getUniformLocation(program, 'uPixelWorld'),
      color: gl.getUniformLocation(program, 'uColor'),
      opacity: gl.getUniformLocation(program, 'uOpacity'),
      gradeTint: gl.getUniformLocation(program, 'uGradeTint'),
      gradeBS: gl.getUniformLocation(program, 'uGradeBS'),
      gradeOn: gl.getUniformLocation(program, 'uGradeOn')
    };

    function setField(f) {
      current = f || null;
    }

    /* `o`: { combined, vScale, time, eye[3], pixelWorld, color[3], opacity,
     *       setGrade(fn) } */
    function draw(o) {
      var s;
      var verts;

      if (!current) return;
      s = streaksInto(current, o.time, MAX_STREAKS, tracks);
      verts = ribbons(current, s, data);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, verts * FLOATS);
      gl.useProgram(program);
      gl.uniformMatrix4fv(loc.viewProjection, false, o.combined);
      gl.uniform1f(loc.vScale, o.vScale);
      gl.uniform3fv(loc.eye, o.eye);
      gl.uniform1f(loc.pixelWorld, o.pixelWorld);
      gl.uniform3fv(loc.color, o.color);
      gl.uniform1f(loc.opacity, o.opacity);
      o.setGrade(loc.gradeTint, loc.gradeBS, loc.gradeOn);
      gl.bindVertexArray(vao);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      acct.drawElements(gl.TRIANGLES, (verts / (POINTS * 2)) * (POINTS - 1) * 6,
        gl.UNSIGNED_INT, 0);
      gl.enable(gl.CULL_FACE);
      gl.depthMask(true);
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

    return { setField: setField, draw: draw, dispose: dispose };
  }

  SM.Wind = {
    field: field,
    streaksInto: streaksInto,
    makeStreakBuffers: makeStreakBuffers,
    ribbons: ribbons,
    sample: sample,
    createLayer: createLayer,
    MAX_STREAKS: MAX_STREAKS,
    POINTS: POINTS,
    LIFT: LIFT,
    FLOATS: FLOATS
  };
})(window.SM = window.SM || {});
