/* Rain and snow over the voxel view, falling from their own clouds.
 *
 * Which areas get weather is decided once per map from its seed: two or
 * three weather zones, centred on wet (forest, rainforest, marsh) or cold
 * (taiga, tundra, snow) land. Each zone has ONE weather cloud above it
 * (owner, 2026-10-05: "yağmur ve kar yarı saydam bulutlardan yağsın"):
 * voxel lobes like the fair-weather clouds (src/render/sky.js builds the
 * mesh), but semi-transparent (CLOUD_ALPHA: the map under it stays
 * readable), lower, and greyer -- rain clouds more than snow clouds, both
 * mixed from palette entries (snow and rock), no new colour. The zone IS
 * the cloud's footprint: every particle belongs to a cloud, starts at its
 * underside and falls inside its lobes.
 *
 * Weather clouds do not cross the map like the fair-weather ones (a snow
 * cloud would end up over the desert). They sway slowly to and fro along
 * the fair clouds' drift axis (x), SWAY of their radius, over a period of
 * minutes; the particles ride with them, so cloud, rain and shadow always
 * agree. Because the ground under a moving cloud changes, the vertex
 * shader looks up the ground level and the weather kind of the tile under
 * each particle in a small per-map texture (`ground`, two bytes a tile):
 * snow over cold biomes, nothing over desert, mesa or lava, rain everywhere
 * else (a cloud over a mountain snows on the peak and rains in the valley).
 * A drop disappears where it reaches the ground.
 *
 * Shadow: a weather cloud casts a LIGHTER shadow than a fair-weather one
 * (SHADOW of it, through the same lobe uniforms as the sky).
 *
 * Bounded and cheap: at most MAX_PARTICLES (900), ONE static vertex buffer
 * per map; the fall is computed in the vertex shader from time, the clouds'
 * positions are three uniforms. Rain is a thin streak along the world
 * vertical, snow a small square flake (blocky, like the voxels) that
 * flutters and drifts a little with the prevailing wind.
 *
 * `build` and `cloudsAt` are DOM- and GL-free (`--weather` in
 * tools/headless.js).
 */
(function (SM) {
  'use strict';

  var MAX_PARTICLES = 900;
  var MAX_CLOUDS = 3;               // one per zone
  var FLOATS = 6;                   // per vertex: local x, z, phase, speed, cloud, corner
  var COLD = ['tundra', 'snow', 'taiga'];
  var DRY = ['desert', 'mesa', 'lava'];
  var SEEDS = ['forest', 'jungle', 'marsh', 'taiga', 'tundra', 'snow'];
  // Opacity of a weather cloud, rain and snow (the map under it must stay
  // readable), and the share of a fair cloud's shadow it casts.
  var CLOUD_ALPHA = { rain: 0.58, snow: 0.48 };
  var SHADOW = 0.6;
  // How far below snow-white the cloud is mixed toward the palette's rock
  // grey: rain clouds are heavier.
  var GREY = { rain: 0.42, snow: 0.16 };
  // Sway: amplitude as a share of the cloud radius, period range (s).
  var SWAY = 0.25;
  var SWAY_PERIOD = [120, 170];
  // Underside of the cloud above the highest ground it can sway over.
  var CLOUD_LIFT = 4;
  // Weather kind codes in the ground texture (green byte).
  var KIND = { none: 0, rain: 1, snow: 2 };

  function ids(list) {
    return list.map(function (id) {
      return SM.BIOME_LIST.findIndex(function (b) { return b.id === id; });
    });
  }

  function rgb01(id) {
    var hex = SM.BIOME_LIST.find(function (b) { return b.id === id; }).color;
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }

  /* Cloud colour for a kind: palette snow mixed toward palette rock. */
  function cloudColor(kind) {
    var snow = rgb01('snow');
    var rock = rgb01('rock');
    var g = GREY[kind];
    return snow.map(function (v, k) { return v * (1 - g) + rock[k] * g; });
  }

  // Is local point (lx, lz) inside the cloud's lobes (scaled by `inset`)?
  function insideLobes(lobes, lx, lz, inset) {
    for (var j = 0; j < lobes.length; j++) {
      var L = lobes[j];
      var ex = (lx - L.x) / (L.rx * inset);
      var ez = (lz - L.z) / (L.rz * inset);
      if (ex * ex + ez * ez <= 1) return true;
    }
    return false;
  }

  /* Weather of one map. Returns { zones, clouds, count, data (Float32Array,
   * 4 vertices per particle), local (Float32Array x, z per particle),
   * cloudOf (Uint8Array), ground (Uint8Array, 2 bytes per tile: level,
   * kind code), width, height }. */
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
      var r = (12 + rnd() * 9) * scale;
      if (far) {
        zones.push({ x: zx + 0.5, y: zy + 0.5, r: r, cold: cold.indexOf(grid.biome[c]) >= 0 });
      }
    }

    // Ground texture: the level (water counts as its surface, never below
    // 0) and what falls there.
    var ground = new Uint8Array(W * H * 2);
    for (i = 0; i < W * H; i++) {
      ground[i * 2] = Math.max(0, Math.min(255, grid.level[i]));
      ground[i * 2 + 1] = dry.indexOf(grid.biome[i]) >= 0 ? KIND.none :
        (cold.indexOf(grid.biome[i]) >= 0 ? KIND.snow : KIND.rain);
    }
    function levelAt(x, y) {
      x = Math.max(0, Math.min(W - 1, Math.floor(x)));
      y = Math.max(0, Math.min(H - 1, Math.floor(y)));
      return ground[(y * W + x) * 2];
    }

    // One cloud per zone: a main lobe over the zone plus one or two side
    // lobes along x, so it reads as a cloud bank rather than a disc.
    var clouds = zones.map(function (z, n) {
      var r = z.r;
      var lobes = [{ x: 0, z: 0, rx: r * 0.8, rz: r * 0.62, h: 1.6 + rnd() * 0.8 }];
      var extra = 1 + Math.floor(rnd() * 2);
      var side = rnd() < 0.5 ? -1 : 1;
      for (var j = 0; j < extra; j++) {
        lobes.push({
          x: side * r * (0.45 + rnd() * 0.2),
          z: (rnd() - 0.5) * r * 0.5,
          rx: r * (0.42 + rnd() * 0.15),
          rz: r * (0.36 + rnd() * 0.15),
          h: 0.9 + rnd() * 0.8
        });
        side = -side;
      }
      var reach = 0;
      lobes.forEach(function (L) {
        reach = Math.max(reach, Math.abs(L.x) + L.rx * 1.1, Math.abs(L.z) + L.rz * 1.1);
      });
      var amp = SWAY * r;
      // Highest and lowest ground the cloud can ever stand over.
      var hi = 0;
      var lo = 255;
      for (var yy = Math.floor(z.y - reach); yy <= z.y + reach; yy++) {
        for (var xx = Math.floor(z.x - reach - amp); xx <= z.x + reach + amp; xx++) {
          var L0 = levelAt(xx, yy);
          if (L0 > hi) hi = L0;
          if (L0 < lo) lo = L0;
        }
      }
      // Snow cloud if most of what falls under the main lobe is snow.
      var snowN = 0;
      var allN = 0;
      for (yy = Math.floor(z.y - r * 0.6); yy <= z.y + r * 0.6; yy++) {
        for (xx = Math.floor(z.x - r * 0.8); xx <= z.x + r * 0.8; xx++) {
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          var kd = ground[(yy * W + xx) * 2 + 1];
          if (kd === KIND.none) continue;
          allN++;
          if (kd === KIND.snow) snowN++;
        }
      }
      var kind = snowN * 2 > allN ? 'snow' : 'rain';
      var bottom = hi + CLOUD_LIFT;
      return {
        index: n,
        x: z.x,
        y: z.y,
        r: r,
        lobes: lobes,
        radius: reach,
        shape: Math.floor(rnd() * 2147483647),
        kind: kind,
        alpha: CLOUD_ALPHA[kind],
        color: cloudColor(kind),
        bottom: bottom,             // underside, in levels
        column: bottom - lo,        // longest possible fall, in levels
        sway: { amp: amp, period: SWAY_PERIOD[0] + rnd() * (SWAY_PERIOD[1] - SWAY_PERIOD[0]),
          phase: rnd() * Math.PI * 2 }
      };
    });

    // Particles: a share of the budget per cloud by area, each at a seeded
    // point inside its cloud's lobes (cloud-local tiles).
    var cap = Math.min(MAX_PARTICLES, maxParticles == null ? MAX_PARTICLES : maxParticles | 0);
    var areas = clouds.map(function (cl) { return Math.PI * cl.r * cl.r; });
    var total = areas.reduce(function (a, b) { return a + b; }, 0);
    var count = Math.min(cap, Math.round(total * 0.35));
    var local = new Float32Array(count * 2);
    var cloudOf = new Uint8Array(count);
    var data = new Float32Array(count * 4 * FLOATS);
    var o = 0;
    var p = 0;
    clouds.forEach(function (cl, n) {
      var share = n === clouds.length - 1 ? count - p : Math.round(count * areas[n] / total);
      for (var q = 0; q < share && p < count; q++, p++) {
        var lx = 0;
        var lz = 0;
        for (var tries = 0; tries < 40; tries++) {
          lx = (rnd() * 2 - 1) * cl.radius;
          lz = (rnd() * 2 - 1) * cl.radius;
          if (insideLobes(cl.lobes, lx, lz, 0.85)) break;
          lx = 0;
          lz = 0;
        }
        var phase = rnd();
        var speed = 0.8 + rnd() * 0.4;
        local[p * 2] = lx;
        local[p * 2 + 1] = lz;
        cloudOf[p] = n;
        for (var corner = 0; corner < 4; corner++) {
          data[o++] = lx;
          data[o++] = lz;
          data[o++] = phase;
          data[o++] = speed;
          data[o++] = n;
          data[o++] = corner;
        }
      }
    });
    return {
      zones: zones, clouds: clouds, count: count, data: data, local: local, cloudOf: cloudOf,
      ground: ground, width: W, height: H
    };
  }

  /* Cloud centres at time t, in GRID coordinates (tiles): [x0, y0, x1, ...]
   * into `out`. The single source of where a weather cloud is: the sky
   * draw, its shadow and its particles all read these numbers. */
  function cloudsAt(built, t, out) {
    var list = built ? built.clouds : [];
    for (var n = 0; n < list.length; n++) {
      var cl = list[n];
      out[n * 2] = cl.x + cl.sway.amp * Math.sin(t * 2 * Math.PI / cl.sway.period + cl.sway.phase);
      out[n * 2 + 1] = cl.y;
    }
    return out;
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
      'in vec2 aLocal;',         // offset from its cloud's centre, tiles
      'in vec4 aParams;',        // phase, speed factor, cloud index, corner
      'uniform mat4 uViewProjection;',
      'uniform float uVScale;',
      'uniform highp float uTime;',
      'uniform vec3 uRight;',    // camera right / up, world space
      'uniform vec3 uUp;',
      'uniform vec2 uWind;',     // prevailing wind, world x/z
      'uniform float uPixelWorld;',
      // Per cloud: centre x, z (grid tiles), underside and longest fall
      // (levels). Same numbers as the cloud the sky pass draws.
      'uniform vec4 uCloud[' + MAX_CLOUDS + '];',
      'uniform float uCloudAlpha[' + MAX_CLOUDS + '];',
      // Ground level (R, bytes) and weather kind (G: 0 none, 1 rain,
      // 2 snow) per tile.
      'uniform highp sampler2D uGround;',
      'out float vAlpha;',
      'out float vKind;',
      'void main() {',
      '  int ci = int(aParams.z + 0.5);',
      '  vec4 cl = uCloud[ci];',
      '  vec2 grid = cl.xy + aLocal;',
      '  ivec2 size = textureSize(uGround, 0);',
      '  ivec2 cell = clamp(ivec2(floor(grid)), ivec2(0), size - 1);',
      '  vec2 g = texelFetch(uGround, cell, 0).rg * 255.0;',
      '  float snow = step(1.5, g.y);',
      '  float falls = step(0.5, g.y);',
      '  // Levels per second; every drop starts at the cloud underside and',
      '  // loops over the longest fall of its cloud, vanishing where it',
      '  // reaches the ground under it.',
      '  float rate = mix(9.0, 1.4, snow) * aParams.y;',
      '  float cyc = fract(uTime * rate / cl.w + aParams.x);',
      '  float fallen = cl.w * cyc;',
      '  float level = cl.z - fallen;',
      '  vec2 drift = uWind * fallen * mix(0.03, 0.12, snow) +',
      '    snow * 0.22 * vec2(sin(uTime * 1.3 + aParams.x * 40.0),',
      '      cos(uTime * 1.1 + aParams.x * 31.0));',
      '  vec3 p = vec3(grid.x + drift.x - float(size.x) * 0.5, level * uVScale,',
      '    grid.y + drift.y - float(size.y) * 0.5);',
      '  float corner = aParams.w;',
      '  vec2 c = vec2(mod(corner, 2.0), floor(corner / 2.0)) - 0.5;',
      '  // Rain: a thin streak along the world vertical. Snow: a square flake',
      '  // facing the camera. Both at least ~1.5 px wide when zoomed out.',
      '  float w = mix(0.05, 0.16, snow);',
      '  float grow = max(1.0, 1.5 * uPixelWorld / w);',
      '  vec3 rainOff = uRight * c.x * w * grow + vec3(0.0, 1.0, 0.0) * c.y * 0.9 * uVScale;',
      '  vec3 snowOff = (uRight * c.x + uUp * c.y) * w * grow;',
      '  gl_Position = uViewProjection * vec4(p + mix(rainOff, snowOff, snow), 1.0);',
      '  // Fades in just under the cloud, out where it lands; nothing where',
      '  // nothing falls (desert, mesa, lava) or once below the ground.',
      '  vAlpha = falls * smoothstep(0.0, 0.8, fallen) * smoothstep(g.x, g.x + 0.7, level) *',
      '    uCloudAlpha[ci];',
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
      ['aLocal', 'aParams']);
  }

  function createLayer(gl, acct, gradeGLSL) {
    var program = makeWeatherProgram(gl, gradeGLSL);
    var vao;
    var vbo;
    var ibo;
    var tex;
    var loc;
    var count = 0;
    var built = null;
    var wind = [0, 0];
    var cloudData = new Float32Array(MAX_CLOUDS * 4);
    var alphaData = new Float32Array(MAX_CLOUDS);
    // Palette colours: snow, and rain as snow tinted a third toward the
    // shallow-sea blue.
    var snowColor = rgb01('snow');
    var sea = rgb01('shallow_water');
    var rainColor = snowColor.map(function (v, k) { return v * 0.67 + sea[k] * 0.33; });

    if (!program) return null;
    vao = gl.createVertexArray();
    vbo = gl.createBuffer();
    ibo = gl.createBuffer();
    tex = gl.createTexture();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    [[0, 2, 0], [1, 4, 2]].forEach(function (a) {
      gl.enableVertexAttribArray(a[0]);
      gl.vertexAttribPointer(a[0], a[1], gl.FLOAT, false, FLOATS * 4, a[2] * 4);
    });
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bindVertexArray(null);
    loc = {};
    ['uViewProjection', 'uVScale', 'uTime', 'uRight', 'uUp', 'uWind', 'uPixelWorld', 'uCloud',
      'uCloudAlpha', 'uGround', 'uRainColor', 'uSnowColor', 'uGradeTint', 'uGradeBS',
      'uGradeOn'].forEach(function (n) {
      loc[n] = gl.getUniformLocation(program, n);
    });

    /* Per map: the output of `build`, prevailing wind [x, y] (grid axes). */
    function setData(b, prevailing) {
      built = b || null;
      count = built ? built.count : 0;
      wind = prevailing || [0, 0];
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      acct.bufferData(gl.ARRAY_BUFFER, vbo, built ? built.data : new Float32Array(0), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      acct.bufferData(gl.ELEMENT_ARRAY_BUFFER, ibo, quadIndices(count), gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      if (built) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, built.width, built.height, 0, gl.RG,
          gl.UNSIGNED_BYTE, built.ground);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        acct.texture(tex, built.width * built.height * 2);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
    }

    /* `o`: { combined, view (4x4), vScale, time, pixelWorld, setGrade,
     *       centres (cloudsAt output for this frame) } */
    function draw(o) {
      var n;

      if (!count || !built) return;
      cloudData.fill(0);
      alphaData.fill(0);
      for (n = 0; n < built.clouds.length; n++) {
        cloudData[n * 4] = o.centres[n * 2];
        cloudData[n * 4 + 1] = o.centres[n * 2 + 1];
        cloudData[n * 4 + 2] = built.clouds[n].bottom;
        cloudData[n * 4 + 3] = built.clouds[n].column;
        // Drops are as see-through as their cloud is, a little more solid.
        alphaData[n] = Math.min(1, built.clouds[n].alpha + 0.35);
      }
      gl.useProgram(program);
      gl.uniformMatrix4fv(loc.uViewProjection, false, o.combined);
      gl.uniform1f(loc.uVScale, o.vScale);
      gl.uniform1f(loc.uTime, o.time);
      gl.uniform3f(loc.uRight, o.view[0], o.view[4], o.view[8]);
      gl.uniform3f(loc.uUp, o.view[1], o.view[5], o.view[9]);
      gl.uniform2f(loc.uWind, wind[0], wind[1]);
      gl.uniform1f(loc.uPixelWorld, o.pixelWorld);
      gl.uniform4fv(loc.uCloud, cloudData);
      gl.uniform1fv(loc.uCloudAlpha, alphaData);
      gl.uniform3fv(loc.uRainColor, rainColor);
      gl.uniform3fv(loc.uSnowColor, snowColor);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(loc.uGround, 0);
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
      gl.bindTexture(gl.TEXTURE_2D, null);
    }

    function dispose() {
      gl.deleteBuffer(vbo);
      gl.deleteBuffer(ibo);
      gl.deleteTexture(tex);
      acct.forget(vbo);
      acct.forget(ibo);
      acct.forget(tex);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    }

    return { setData: setData, draw: draw, dispose: dispose };
  }

  SM.Weather = {
    build: build,
    cloudsAt: cloudsAt,
    cloudColor: cloudColor,
    insideLobes: insideLobes,
    createLayer: createLayer,
    MAX_PARTICLES: MAX_PARTICLES,
    MAX_CLOUDS: MAX_CLOUDS,
    CLOUD_ALPHA: CLOUD_ALPHA,
    SHADOW: SHADOW,
    SWAY: SWAY,
    KIND: KIND,
    COLD: COLD,
    DRY: DRY
  };
})(window.SM = window.SM || {});
