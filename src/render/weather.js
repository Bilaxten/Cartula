/* Rain and snow over the voxel view, by biome.
 *
 * Which areas get weather is decided once per map from its seed: two or
 * three weather zones, centred on wet (forest, rainforest, marsh) or cold
 * (taiga, tundra, snow) land. Inside a zone the biome under each particle
 * decides what falls: snow over cold biomes, nothing over desert, mesa or
 * lava, rain everywhere else (a zone over a mountain snows on the peak and
 * rains in the valley). Zone edges fade out softly.
 *
 * Bounded and cheap: at most MAX_PARTICLES (900 by default, "light"),
 * built into ONE static vertex buffer per map; the fall itself is computed
 * in the vertex shader from time, so a frame costs no CPU work and no
 * upload. Rain is a thin streak along the world vertical, snow a small
 * square flake (blocky, like the voxels) that flutters and drifts with the
 * map's prevailing wind (src/render/wind.js). Both keep a minimum on-screen
 * size, and take the day/night grade like the rest of the world.
 *
 * `build` is DOM- and GL-free (checked by `--weather` in tools/headless.js).
 */
(function (SM) {
  'use strict';

  var MAX_PARTICLES = 900;
  var FLOATS = 8;          // per vertex: x, ground, z, phase, speed, kind, corner, zone
  var COLD = ['tundra', 'snow', 'taiga'];
  var DRY = ['desert', 'mesa', 'lava'];
  var SEEDS = ['forest', 'jungle', 'marsh', 'taiga', 'tundra', 'snow'];

  function ids(list) {
    return list.map(function (id) {
      return SM.BIOME_LIST.findIndex(function (b) { return b.id === id; });
    });
  }

  function smooth01(e0, e1, x) {
    var t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }

  /* Weather zones and particles of one map. Kind per particle: 0 rain,
   * 1 snow. Returns { zones, count, data (Float32Array, 4 vertices per
   * particle), tiles (Int32Array cell index per particle), kinds }. */
  function build(grid, seed, maxParticles) {
    var W = grid.width;
    var H = grid.height;
    var rnd = SM.mulberry32(((seed | 0) ^ 0x7ea7) >>> 0);
    var cold = ids(COLD);
    var dry = ids(DRY);
    var seedBiomes = ids(SEEDS);
    var scale = W / 192;
    var coldLand = [];
    var wetLand = [];
    var zones = [];
    var want;
    var i;
    var k;

    for (i = 0; i < W * H; i++) {
      if (grid.water[i] || seedBiomes.indexOf(grid.biome[i]) < 0) continue;
      if (cold.indexOf(grid.biome[i]) >= 0) coldLand.push(i);
      else wetLand.push(i);
    }
    // The first zone goes to cold land when the map has a real patch of it
    // (otherwise snow would be a rare accident); the others to wet land.
    want = 2 + Math.floor(rnd() * 2);
    for (k = 0; k < 60 && zones.length < want; k++) {
      var pool = zones.length === 0 && coldLand.length >= 30 * scale * scale ? coldLand :
        (wetLand.length ? wetLand : coldLand);
      if (!pool.length) break;
      var c = pool[Math.floor(rnd() * pool.length)];
      var zx = c % W;
      var zy = Math.floor(c / W);
      var far = zones.every(function (z) {
        return (z.x - zx) * (z.x - zx) + (z.y - zy) * (z.y - zy) > Math.pow(40 * scale, 2);
      });
      var r = (16 + rnd() * 14) * scale;
      if (far) zones.push({ x: zx + 0.5, y: zy + 0.5, r: r });
    }

    // Eligible tiles: inside a zone and not dry; how strongly each lies in
    // its zone (1 in the middle, soft to 0 at the rim).
    var tiles = [];
    var weight = [];
    for (i = 0; i < W * H; i++) {
      var tx = i % W + 0.5;
      var ty = Math.floor(i / W) + 0.5;
      var w = 0;
      if (dry.indexOf(grid.biome[i]) >= 0) continue;
      for (k = 0; k < zones.length; k++) {
        var d = Math.sqrt((tx - zones[k].x) * (tx - zones[k].x) + (ty - zones[k].y) * (ty - zones[k].y));
        w = Math.max(w, smooth01(zones[k].r, zones[k].r * 0.55, d));
      }
      if (w > 0.02) {
        tiles.push(i);
        weight.push(w);
      }
    }

    var cap = Math.min(MAX_PARTICLES, maxParticles == null ? MAX_PARTICLES : maxParticles | 0);
    var count = Math.min(cap, Math.round(tiles.length * 0.6));
    var data = new Float32Array(count * 4 * FLOATS);
    var cell = new Int32Array(count);
    var kinds = new Uint8Array(count);
    var o = 0;
    var p;

    for (p = 0; p < count; p++) {
      var pick = Math.floor(rnd() * tiles.length);
      var ti = tiles[pick];
      var px = ti % W + 0.1 + rnd() * 0.8;
      var py = Math.floor(ti / W) + 0.1 + rnd() * 0.8;
      var ground = Math.max(0, grid.level[ti]);
      var phase = rnd();
      var speed = 0.8 + rnd() * 0.4;
      var kind = cold.indexOf(grid.biome[ti]) >= 0 ? 1 : 0;
      cell[p] = ti;
      kinds[p] = kind;
      for (var corner = 0; corner < 4; corner++) {
        data[o++] = px - W / 2;
        data[o++] = ground;
        data[o++] = py - H / 2;
        data[o++] = phase;
        data[o++] = speed;
        data[o++] = kind;
        data[o++] = corner;
        data[o++] = weight[pick];
      }
    }
    return { zones: zones, count: count, data: data, tiles: cell, kinds: kinds };
  }

  function quadIndices(count) {
    var idx = new Uint32Array(count * 6);
    for (var p = 0; p < count; p++) {
      var a = p * 4;
      idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], p * 6);
    }
    return idx;
  }

  function makeWeatherProgram(gl, gradeGLSL) {
    var vertexSource = [
      '#version 300 es',
      'in vec3 aBase;',          // x, ground level, z
      'in vec4 aParams;',        // phase, speed factor, kind (0 rain, 1 snow), corner
      'in float aZone;',         // 0..1 inside the weather zone
      'uniform mat4 uViewProjection;',
      'uniform float uVScale;',
      'uniform highp float uTime;',
      'uniform vec3 uRight;',    // camera right / up, world space
      'uniform vec3 uUp;',
      'uniform vec2 uWind;',     // prevailing wind, world x/z
      'uniform float uPixelWorld;',
      'out float vAlpha;',
      'out float vKind;',
      'void main() {',
      '  float snow = step(0.5, aParams.z);',
      '  // Levels per second; the column a particle falls through is COLUMN',
      '  // levels tall above its own ground, and it loops forever.',
      '  const float COLUMN = 9.0;',
      '  float rate = mix(9.0, 1.4, snow) * aParams.y;',
      '  float cyc = fract(uTime * rate / COLUMN + aParams.x);',
      '  float fallen = COLUMN * cyc;',
      '  vec3 p = vec3(aBase.x, (aBase.y + COLUMN - fallen) * uVScale, aBase.z);',
      '  p.xz += uWind * fallen * mix(0.06, 0.3, snow);',
      '  p.xz += snow * 0.22 * vec2(sin(uTime * 1.3 + aParams.x * 40.0),',
      '    cos(uTime * 1.1 + aParams.x * 31.0));',
      '  float corner = aParams.w;',
      '  vec2 c = vec2(mod(corner, 2.0), floor(corner / 2.0)) - 0.5;',
      '  // Rain: a thin streak along the world vertical. Snow: a square flake',
      '  // facing the camera. Both at least ~1.5 px wide when zoomed out.',
      '  float w = mix(0.05, 0.16, snow);',
      '  float grow = max(1.0, 1.5 * uPixelWorld / w);',
      '  vec3 rainOff = uRight * c.x * w * grow + vec3(0.0, 1.0, 0.0) * c.y * 0.9 * uVScale;',
      '  vec3 snowOff = (uRight * c.x + uUp * c.y) * w * grow;',
      '  gl_Position = uViewProjection * vec4(p + mix(rainOff, snowOff, snow), 1.0);',
      '  // Invisible where it (re)appears at the top and where it lands.',
      '  vAlpha = aZone * smoothstep(0.0, 0.12, cyc) * (1.0 - smoothstep(0.85, 1.0, cyc));',
      '  vKind = snow;',
      '}'
    ].join('\n');
    var fragmentSource = [
      '#version 300 es',
      'precision mediump float;',
      'in float vAlpha;',
      'in float vKind;',
      'uniform vec3 uRainColor;',
      'uniform vec3 uSnowColor;',
      gradeGLSL,
      'out vec4 outColor;',
      'void main() {',
      '  vec3 c = mix(uRainColor, uSnowColor, vKind);',
      '  outColor = vec4(grade(c), vAlpha * mix(0.5, 0.9, vKind));',
      '}'
    ].join('\n');
    return SM.buildGLProgram(gl, 'weather', vertexSource, fragmentSource,
      ['aBase', 'aParams', 'aZone']);
  }

  function rgb01(id) {
    var hex = SM.BIOME_LIST.find(function (b) { return b.id === id; }).color;
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }

  function createLayer(gl, acct, gradeGLSL) {
    var program = makeWeatherProgram(gl, gradeGLSL);
    var vao;
    var vbo;
    var ibo;
    var loc;
    var count = 0;
    var wind = [0, 0];
    // Palette colours: snow, and rain as snow tinted a third toward the
    // shallow-sea blue.
    var snowColor = rgb01('snow');
    var sea = rgb01('shallow_water');
    var rainColor = snowColor.map(function (v, k) { return v * 0.67 + sea[k] * 0.33; });

    if (!program) return null;
    vao = gl.createVertexArray();
    vbo = gl.createBuffer();
    ibo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    [[0, 3, 0], [1, 4, 3], [2, 1, 7]].forEach(function (a) {
      gl.enableVertexAttribArray(a[0]);
      gl.vertexAttribPointer(a[0], a[1], gl.FLOAT, false, FLOATS * 4, a[2] * 4);
    });
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bindVertexArray(null);
    loc = {};
    ['uViewProjection', 'uVScale', 'uTime', 'uRight', 'uUp', 'uWind', 'uPixelWorld',
      'uRainColor', 'uSnowColor', 'uGradeTint', 'uGradeBS', 'uGradeOn'].forEach(function (n) {
      loc[n] = gl.getUniformLocation(program, n);
    });

    /* Per map: particles from `build`, prevailing wind [x, y] (grid axes). */
    function setData(built, prevailing) {
      count = built ? built.count : 0;
      wind = prevailing || [0, 0];
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      acct.bufferData(gl.ARRAY_BUFFER, vbo, built ? built.data : new Float32Array(0), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      acct.bufferData(gl.ELEMENT_ARRAY_BUFFER, ibo, quadIndices(count), gl.STATIC_DRAW);
      gl.bindVertexArray(null);
    }

    /* `o`: { combined, view (4x4), vScale, time, pixelWorld, setGrade } */
    function draw(o) {
      if (!count) return;
      gl.useProgram(program);
      gl.uniformMatrix4fv(loc.uViewProjection, false, o.combined);
      gl.uniform1f(loc.uVScale, o.vScale);
      gl.uniform1f(loc.uTime, o.time);
      gl.uniform3f(loc.uRight, o.view[0], o.view[4], o.view[8]);
      gl.uniform3f(loc.uUp, o.view[1], o.view[5], o.view[9]);
      gl.uniform2f(loc.uWind, wind[0], wind[1]);
      gl.uniform1f(loc.uPixelWorld, o.pixelWorld);
      gl.uniform3fv(loc.uRainColor, rainColor);
      gl.uniform3fv(loc.uSnowColor, snowColor);
      o.setGrade(loc.uGradeTint, loc.uGradeBS, loc.uGradeOn);
      gl.bindVertexArray(vao);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      acct.drawElements(gl.TRIANGLES, count * 6, gl.UNSIGNED_INT, 0);
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

    return { setData: setData, draw: draw, dispose: dispose };
  }

  SM.Weather = {
    build: build,
    createLayer: createLayer,
    MAX_PARTICLES: MAX_PARTICLES,
    COLD: COLD,
    DRY: DRY
  };
})(window.SM = window.SM || {});
