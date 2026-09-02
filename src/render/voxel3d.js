/* WebGL2 voxel terrain renderer. Mesh construction stays data-only so the
 * generation pipeline can verify it under Node without a browser or GL. */
(function (SM) {
  'use strict';

  // A neutral rim makes the generated island read as a finished diorama.
  var BORD = [70, 80, 92];

  function hexToRgb(hex) {
    // CSS palette strings are converted before entering the GPU's float range.
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /* Build independent quad vertices. Keeping faces independent permits a
   * material, normal, and depth discontinuity on every voxel edge. */
  function buildVoxelMesh(grid, opts) {
    // This function deliberately receives no GL object: headless checks can
    // compare its deterministic typed arrays without browser state.
    var o = opts || {};
    var W = grid.width;
    var H = grid.height;
    var level = grid.level;
    var waterDepth = (grid.config && grid.config.waterDepth) || 3;
    var levels = (grid.config && grid.config.levels) || 10;
    var floorLevel = -waterDepth - 1;
    var maxLevel = levels + 1;
    var pos = [];
    var norm = [];
    var color = [];
    var depth = [];
    var indices = [];
    var minX = Infinity;
    var minY = Infinity;
    var minZ = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    var maxZ = -Infinity;
    // Convert the palette once per mesh rather than once per cell face.
    var rgb = SM.BIOME_LIST.map(function (biome) {
      return hexToRgb(biome.color);
    });
    var shallow = SM.BIOME_IDX.shallow_water;

    function addVertex(x, y, z, nx, ny, nz, c, d) {
      // Positions preserve the raw integer level. uVScale later exaggerates Y
      // without invalidating the mesh topology.
      pos.push(x, y, z);
      norm.push(nx, ny, nz);
      color.push(Math.max(0, Math.min(1, c[0] / 255)));
      color.push(Math.max(0, Math.min(1, c[1] / 255)));
      color.push(Math.max(0, Math.min(1, c[2] / 255)));
      // Depth is a shader-only tonal cue, not geometry or baked lighting.
      depth.push(d);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    /* Each quad is CCW from its outward-facing side. CULL_FACE can therefore
     * discard its back face without exposing the terrain interior. */
    function addQuad(vertices, normal, faceColor, sideDepth) {
      var base = pos.length / 3;

      // Duplicating the four vertices lets adjacent faces retain hard normals.
      addVertex(
        vertices[0], vertices[1], vertices[2],
        normal[0], normal[1], normal[2], faceColor, sideDepth[0]
      );
      addVertex(
        vertices[3], vertices[4], vertices[5],
        normal[0], normal[1], normal[2], faceColor, sideDepth[1]
      );
      addVertex(
        vertices[6], vertices[7], vertices[8],
        normal[0], normal[1], normal[2], faceColor, sideDepth[2]
      );
      addVertex(
        vertices[9], vertices[10], vertices[11],
        normal[0], normal[1], normal[2], faceColor, sideDepth[3]
      );
      indices.push(base, base + 1, base + 2);
      indices.push(base, base + 2, base + 3);
    }

    function levelAt(x, y) {
      // The terrain's outside is its floor, exposing an honest outer shell.
      if (x < 0 || y < 0 || x >= W || y >= H) return floorLevel;
      return level[y * W + x];
    }

    function borderTop(x, y) {
      var cx = x < 0 ? 0 : (x >= W ? W - 1 : x);
      var cy = y < 0 ? 0 : (y >= H ? H - 1 : y);
      var L = level[cy * W + cx];

      // Water edges stop at sea level, avoiding a raised border around lakes.
      return L < 0 ? 0 : L;
    }

    function terrainColor(x, y, i, L) {
      var c = rgb[grid.biome[i]].slice();
      var topC = c;
      var shoreN = 0;
      var shoreDiag = 0;
      var wt;
      var taller = 0;
      var sv;
      var topF;
      var ao;

      if (grid.biome[i] === shallow) {
        // A shoreline tint preserves the water's readable shallows in 3D.
        if (x > 0 && !grid.water[i - 1]) shoreN++;
        if (x < W - 1 && !grid.water[i + 1]) shoreN++;
        if (y > 0 && !grid.water[i - W]) shoreN++;
        if (y < H - 1 && !grid.water[i + W]) shoreN++;
        if (x > 0 && y > 0 && !grid.water[i - W - 1]) shoreDiag++;
        if (x < W - 1 && y > 0 && !grid.water[i - W + 1]) shoreDiag++;
        if (x > 0 && y < H - 1 && !grid.water[i + W - 1]) shoreDiag++;
        if (x < W - 1 && y < H - 1 && !grid.water[i + W + 1]) shoreDiag++;
        wt = Math.min(1, shoreN * 0.5 + shoreDiag * 0.125) * 0.55;
        topC = [
          c[0] + (122 - c[0]) * wt,
          c[1] + (196 - c[1]) * wt,
          c[2] + (201 - c[2]) * wt
        ];
      }

      // This is local ambient occlusion, intentionally separate from sunlight.
      if (levelAt(x - 1, y) > L) taller++;
      if (levelAt(x + 1, y) > L) taller++;
      if (levelAt(x, y - 1) > L) taller++;
      if (levelAt(x, y + 1) > L) taller++;
      sv = SM.biomeShade(grid, i);
      topF = grid.water[i] ? 1 : (0.90 + 0.15 * (L / maxLevel));
      // Taller neighbours darken crowded tops before directional light is added.
      ao = 1 - 0.06 * Math.min(3, taller);
      return {
        top: [
          topC[0] * topF * sv * ao,
          topC[1] * topF * sv * ao,
          topC[2] * topF * sv * ao
        ],
        side: [c[0] * sv, c[1] * sv, c[2] * sv]
      };
    }

    function addTop(x, y, L, c) {
      var x0 = x - W / 2;
      var x1 = x0 + 1;
      var z0 = y - H / 2;
      var z1 = z0 + 1;

      // The vertex order looks down on the face from outside, hence CCW.
      addQuad(
        [x0, L, z0, x0, L, z1, x1, L, z1, x1, L, z0],
        [0, 1, 0],
        c,
        [0, 0, 0, 0]
      );
    }

    function addSide(x, y, L, NL, dir, c) {
      var x0 = x - W / 2;
      var x1 = x0 + 1;
      var z0 = y - H / 2;
      var z1 = z0 + 1;
      // The gradient follows the visible drop instead of the absolute altitude.
      var d = L - NL;

      // Each branch preserves the outward normal and matching CCW winding.
      if (dir === 0) {
        addQuad(
          [x0, L, z0, x0, NL, z0, x0, NL, z1, x0, L, z1],
          [-1, 0, 0],
          c,
          [0, d, d, 0]
        );
      } else if (dir === 1) {
        addQuad(
          [x1, L, z1, x1, NL, z1, x1, NL, z0, x1, L, z0],
          [1, 0, 0],
          c,
          [0, d, d, 0]
        );
      } else if (dir === 2) {
        addQuad(
          [x1, L, z0, x1, NL, z0, x0, NL, z0, x0, L, z0],
          [0, 0, -1],
          c,
          [0, d, d, 0]
        );
      } else {
        addQuad(
          [x0, L, z1, x0, NL, z1, x1, NL, z1, x1, L, z1],
          [0, 0, 1],
          c,
          [0, d, d, 0]
        );
      }
    }

    /* A cell's top is always visible. Its wall reaches down to the neighbour's
     * level, because every exposed step between the two columns needs a face.
     * When NL >= L the neighbour already hides the full side, so no quad exists. */
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var i = y * W + x;
        var L = level[i];
        var material = terrainColor(x, y, i, L);
        var west;
        var east;
        var north;
        var south;

        // Top and sides share one material decision so biome seams stay sharp.
        addTop(x, y, L, material.top);
        west = levelAt(x - 1, y);
        east = levelAt(x + 1, y);
        north = levelAt(x, y - 1);
        south = levelAt(x, y + 1);
        if (west < L) addSide(x, y, L, west, 0, material.side);
        if (east < L) addSide(x, y, L, east, 1, material.side);
        if (north < L) addSide(x, y, L, north, 2, material.side);
        if (south < L) addSide(x, y, L, south, 3, material.side);
      }
    }

    /* A one-cell charcoal ring follows the nearest map edge. Its exterior walls
     * always reach the base, while changed edge heights expose connecting walls. */
    for (y = -1; y <= H; y++) {
      for (x = -1; x <= W; x++) {
        var edgeWest;
        var edgeEast;
        var edgeNorth;
        var edgeSouth;

        // Only the perimeter cells belong to the display plinth.
        if (x >= 0 && x < W && y >= 0 && y < H) continue;
        L = borderTop(x, y);
        addTop(x, y, L, BORD);
        edgeWest = x === -1;
        edgeEast = x === W;
        edgeNorth = y === -1;
        edgeSouth = y === H;
        if (edgeWest) addSide(x, y, L, floorLevel, 0, BORD);
        if (edgeEast) addSide(x, y, L, floorLevel, 1, BORD);
        if (edgeNorth) addSide(x, y, L, floorLevel, 2, BORD);
        if (edgeSouth) addSide(x, y, L, floorLevel, 3, BORD);
        if (!edgeWest && borderTop(x - 1, y) < L) {
          addSide(x, y, L, borderTop(x - 1, y), 0, BORD);
        }
        if (!edgeEast && borderTop(x + 1, y) < L) {
          addSide(x, y, L, borderTop(x + 1, y), 1, BORD);
        }
        if (!edgeNorth && borderTop(x, y - 1) < L) {
          addSide(x, y, L, borderTop(x, y - 1), 2, BORD);
        }
        if (!edgeSouth && borderTop(x, y + 1) < L) {
          addSide(x, y, L, borderTop(x, y + 1), 3, BORD);
        }
      }
    }

    /* One base closes the hollow terrain at low camera angles. It is a single
     * quad rather than a filled volume because interior geometry is never seen. */
    var bx0 = -W / 2 - 1;
    var bx1 = W / 2 + 1;
    var bz0 = -H / 2 - 1;
    var bz1 = H / 2 + 1;
    addQuad(
      [
        bx0, floorLevel, bz1,
        bx0, floorLevel, bz0,
        bx1, floorLevel, bz0,
        bx1, floorLevel, bz1
      ],
      [0, -1, 0],
      BORD,
      [0, 0, 0, 0]
    );
    void o;
    return {
      positions: new Float32Array(pos),
      normals: new Float32Array(norm),
      colors: new Float32Array(color),
      sideDepth: new Float32Array(depth),
      indices: new Uint32Array(indices),
      vertexCount: pos.length / 3,
      triangleCount: indices.length / 3,
      bounds: {
        minX: minX,
        maxX: maxX,
        minY: minY,
        maxY: maxY,
        minZ: minZ,
        maxZ: maxZ
      }
    };
  }

  function mat4Multiply(out, a, b) {
    // Keep the small matrix layer local: file:// mode cannot assume a library.
    var a00 = a[0];
    var a01 = a[1];
    var a02 = a[2];
    var a03 = a[3];
    var a10 = a[4];
    var a11 = a[5];
    var a12 = a[6];
    var a13 = a[7];
    var a20 = a[8];
    var a21 = a[9];
    var a22 = a[10];
    var a23 = a[11];
    var a30 = a[12];
    var a31 = a[13];
    var a32 = a[14];
    var a33 = a[15];
    var b00 = b[0];
    var b01 = b[1];
    var b02 = b[2];
    var b03 = b[3];
    var b10 = b[4];
    var b11 = b[5];
    var b12 = b[6];
    var b13 = b[7];
    var b20 = b[8];
    var b21 = b[9];
    var b22 = b[10];
    var b23 = b[11];
    var b30 = b[12];
    var b31 = b[13];
    var b32 = b[14];
    var b33 = b[15];

    // The order is projection * view, matching WebGL's column-vector transform.
    out[0] = b00 * a00 + b01 * a10 + b02 * a20 + b03 * a30;
    out[1] = b00 * a01 + b01 * a11 + b02 * a21 + b03 * a31;
    out[2] = b00 * a02 + b01 * a12 + b02 * a22 + b03 * a32;
    out[3] = b00 * a03 + b01 * a13 + b02 * a23 + b03 * a33;
    out[4] = b10 * a00 + b11 * a10 + b12 * a20 + b13 * a30;
    out[5] = b10 * a01 + b11 * a11 + b12 * a21 + b13 * a31;
    out[6] = b10 * a02 + b11 * a12 + b12 * a22 + b13 * a32;
    out[7] = b10 * a03 + b11 * a13 + b12 * a23 + b13 * a33;
    out[8] = b20 * a00 + b21 * a10 + b22 * a20 + b23 * a30;
    out[9] = b20 * a01 + b21 * a11 + b22 * a21 + b23 * a31;
    out[10] = b20 * a02 + b21 * a12 + b22 * a22 + b23 * a32;
    out[11] = b20 * a03 + b21 * a13 + b22 * a23 + b23 * a33;
    out[12] = b30 * a00 + b31 * a10 + b32 * a20 + b33 * a30;
    out[13] = b30 * a01 + b31 * a11 + b32 * a21 + b33 * a31;
    out[14] = b30 * a02 + b31 * a12 + b32 * a22 + b33 * a32;
    out[15] = b30 * a03 + b31 * a13 + b32 * a23 + b33 * a33;
    return out;
  }

  function mat4Ortho(out, left, right, bottom, top, near, far) {
    var lr = 1 / (left - right);
    var bt = 1 / (bottom - top);
    var nf = 1 / (near - far);

    // Orthographic projection keeps the old isometric look during rotation.
    out[0] = -2 * lr;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = -2 * bt;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = 2 * nf;
    out[11] = 0;
    out[12] = (left + right) * lr;
    out[13] = (top + bottom) * bt;
    out[14] = (far + near) * nf;
    out[15] = 1;
    return out;
  }

  function mat4LookAt(out, eye, target, up) {
    var zx = eye[0] - target[0];
    var zy = eye[1] - target[1];
    var zz = eye[2] - target[2];
    var zlen = Math.sqrt(zx * zx + zy * zy + zz * zz) || 1;
    var xx;
    var xy;
    var xz;
    var xlen;
    var yx;
    var yy;
    var yz;

    // Build an orthonormal camera basis so its right/up axes remain stable.
    zx /= zlen;
    zy /= zlen;
    zz /= zlen;
    xx = up[1] * zz - up[2] * zy;
    xy = up[2] * zx - up[0] * zz;
    xz = up[0] * zy - up[1] * zx;
    xlen = Math.sqrt(xx * xx + xy * xy + xz * xz) || 1;
    xx /= xlen;
    xy /= xlen;
    xz /= xlen;
    yx = zy * xz - zz * xy;
    yy = zz * xx - zx * xz;
    yz = zx * xy - zy * xx;

    out[0] = xx;
    out[1] = yx;
    out[2] = zx;
    out[3] = 0;
    out[4] = xy;
    out[5] = yy;
    out[6] = zy;
    out[7] = 0;
    out[8] = xz;
    out[9] = yz;
    out[10] = zz;
    out[11] = 0;
    out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    out[15] = 1;
    return out;
  }

  function compileShader(gl, type, source) {
    var shader = gl.createShader(type);

    // Return null on failure so the optional voxel route can fail closed.
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function makeProgram(gl) {
    // Arrays preserve GLSL's own line structure without a template dependency.
    var vertexSource = [
      '#version 300 es',
      'in vec3 aPosition;',
      'in vec3 aNormal;',
      'in vec3 aColor;',
      'in float aSideDepth;',
      'uniform mat4 uViewProjection;',
      'uniform float uVScale;',
      'out vec3 vNormal;',
      'out vec3 vColor;',
      'out float vSideDepth;',
      '',
      'void main() {',
      '  vNormal = aNormal;',
      '  vColor = aColor;',
      '  vSideDepth = aSideDepth;',
      '  // Keep Y raw in the mesh so isoexag changes need no mesh rebuild.',
      '  // Axis-aligned faces keep their normals valid under this Y-only scale.',
      '  gl_Position = uViewProjection * vec4(',
      '    aPosition.x,',
      '    aPosition.y * uVScale,',
      '    aPosition.z,',
      '    1.0',
      '  );',
      '}'
    ].join('\n');
    var fragmentSource = [
      '#version 300 es',
      'precision mediump float;',
      'in vec3 vNormal;',
      'in vec3 vColor;',
      'in float vSideDepth;',
      'uniform vec3 uSunDirection;',
      'out vec4 outColor;',
      '',
      'void main() {',
      '  vec3 light = normalize(uSunDirection);',
      '  // Dividing by light.y pins a horizontal top face at full 1.0 light.',
      '  float ndl = max(',
      '    0.0,',
      '    dot(normalize(vNormal), light) / max(light.y, 0.001)',
      '  );',
      '  // Faz 2: low sun over-brightens side faces here.',
      '  float lambert = min(1.0, 0.47 + 0.53 * ndl);',
      '  float gradient = 1.0 - 0.28 * min(1.0, vSideDepth / 2.6);',
      '  outColor = vec4(vColor * lambert * gradient, 1.0);',
      '}'
    ].join('\n');
    // Vertex scale and fragment lighting are uniforms, not baked attributes.
    var vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    var fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    var program;

    /* Albedo stays unlit in the mesh. Light is evaluated in the shader so a
     * Faz 2 sun change does not require rebuilding and uploading terrain. */
    if (!vertex || !fragment) {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      return null;
    }
    program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }

  function isSupported() {
    return !!window.WebGL2RenderingContext;
  }

  function create(canvas) {
    var gl;

    // WebGL2 is opt-in; an unavailable context must leave the 2D renderer safe.
    try {
      gl = canvas.getContext('webgl2', { alpha: false, antialias: true });
    } catch (err) {
      return null;
    }
    if (!gl) return null;

    var program = makeProgram(gl);
    if (!program) return null;

    // A VAO fixes the mesh layout once; render only needs to bind and draw it.
    var vao = gl.createVertexArray();
    var positionBuffer = gl.createBuffer();
    var normalBuffer = gl.createBuffer();
    var colorBuffer = gl.createBuffer();
    var sideDepthBuffer = gl.createBuffer();
    var indexBuffer = gl.createBuffer();
    // Separate buffers make each data channel inspectable in headless output.
    var position = gl.getAttribLocation(program, 'aPosition');
    var normal = gl.getAttribLocation(program, 'aNormal');
    var color = gl.getAttribLocation(program, 'aColor');
    var sideDepth = gl.getAttribLocation(program, 'aSideDepth');
    var viewProjection = gl.getUniformLocation(program, 'uViewProjection');
    var verticalScale = gl.getUniformLocation(program, 'uVScale');
    var sunDirection = gl.getUniformLocation(program, 'uSunDirection');
    var projection = new Float32Array(16);
    var view = new Float32Array(16);
    var combined = new Float32Array(16);
    var camera = { yaw: 35, pitch: 42, zoom: 10, tx: 0, ty: 0, tz: 0 };
    var fit = { distance: 100, near: 0.1, far: 300 };
    var vScale = 1.6;
    var sun = [0.5, 1.0, 0.74];
    var indexCount = 0;
    var clearColor = [0.055, 0.075, 0.11, 1];
    var width = 1;
    var height = 1;
    var disposed = false;

    /* Faces were emitted CCW in addQuad, so back-face culling removes only
     * hidden interior faces and keeps the outward terrain shell. */
    gl.enable(gl.CULL_FACE);
    gl.frontFace(gl.CCW);
    gl.enable(gl.DEPTH_TEST);
    gl.bindVertexArray(vao);

    function setupAttrib(buffer, location, size) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    }

    setupAttrib(positionBuffer, position, 3);
    setupAttrib(normalBuffer, normal, 3);
    setupAttrib(colorBuffer, color, 3);
    setupAttrib(sideDepthBuffer, sideDepth, 1);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bindVertexArray(null);

    function resize(cssW, cssH, dpr) {
      if (disposed) return;
      // Canvas pixels follow DPR so orthographic edges stay crisp on Retina.
      width = Math.max(1, Math.round(cssW * (dpr || 1)));
      height = Math.max(1, Math.round(cssH * (dpr || 1)));
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }

    function setCamera(cam) {
      if (!cam) return;
      // Clamp the public orbit range before its trigonometry reaches render.
      camera.yaw = ((+cam.yaw % 360) + 360) % 360;
      camera.pitch = Math.max(10, Math.min(89, +cam.pitch));
      camera.zoom = Math.max(0.01, +cam.zoom);
      camera.tx = +cam.tx || 0;
      camera.ty = +cam.ty || 0;
      camera.tz = +cam.tz || 0;
    }

    function setClearColor(r, g, b, a) {
      // Keep clear colour state here so resize and render share one source.
      clearColor[0] = r;
      clearColor[1] = g;
      clearColor[2] = b;
      clearColor[3] = a;
    }

    function setVerticalScale(v) {
      // Scaling happens in the vertex shader, keeping this control upload-free.
      vScale = Math.max(0.01, +v || 1);
    }

    function setSun(nextSun) {
      var s = nextSun || {};

      // Iso uses incoming ray direction; WebGL lighting needs the opposite.
      sun[0] = -(+s.dx || 0);
      sun[1] = Math.max(0.12, +s.rise || 0.12);
      sun[2] = -(+s.dy || 0);
    }

    function setMesh(mesh) {
      if (!mesh || disposed) return;
      // Static buffers are replaced only when generation produces a new grid.
      // Bind the VAO during upload so element-buffer ownership stays attached.
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.colors, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, sideDepthBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.sideDepth, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      indexCount = mesh.indices.length;
    }

    function maxVerticalExtent(horizontalRadius, verticalHalf) {
      /* Every yaw fits within horizontalRadius. For the vertical camera axis,
       * its XZ contribution is r * sin(pitch), and its height contribution is
       * h * cos(pitch); evaluating their support peak covers all valid pitches. */
      var minPitch = 10 * Math.PI / 180;
      var maxPitch = 89 * Math.PI / 180;
      var peakPitch = Math.atan2(horizontalRadius, verticalHalf);
      var minExtent = horizontalRadius * Math.sin(minPitch) +
        verticalHalf * Math.cos(minPitch);
      var maxExtent = horizontalRadius * Math.sin(maxPitch) +
        verticalHalf * Math.cos(maxPitch);

      // The support function peaks where the XZ and height contributions align.
      if (peakPitch >= minPitch && peakPitch <= maxPitch) {
        return Math.sqrt(
          horizontalRadius * horizontalRadius + verticalHalf * verticalHalf
        );
      }
      return Math.max(minExtent, maxExtent);
    }

    function fitCamera(bounds) {
      // Fit around the scaled geometry because the camera sees scaled Y values.
      var tx = (bounds.minX + bounds.maxX) / 2;
      var ty = (bounds.minY + bounds.maxY) * vScale / 2;
      var tz = (bounds.minZ + bounds.maxZ) / 2;
      var halfX = (bounds.maxX - bounds.minX) / 2;
      var halfY = (bounds.maxY - bounds.minY) * vScale / 2;
      var halfZ = (bounds.maxZ - bounds.minZ) / 2;
      var horizontalRadius = Math.sqrt(halfX * halfX + halfZ * halfZ);
      var verticalExtent = maxVerticalExtent(horizontalRadius, halfY);
      var radius = Math.sqrt(
        horizontalRadius * horizontalRadius + halfY * halfY
      );
      var aspect = width / height;

      /* Projecting the eight corners onto the active camera right/up axes makes
       * a tight frame only for one yaw and pitch. Instead, XZ's half diagonal
       * bounds every yaw, and the maximum XZ-plus-height support over pitches
       * 10..89 bounds every vertical projection. The corner-sphere radius is
       * retained solely for depth range, avoiding its looser use as screen size. */
      camera.tx = tx;
      camera.ty = ty;
      camera.tz = tz;
      camera.zoom = Math.max(
        1,
        (Math.max(horizontalRadius, verticalExtent * aspect) + 2) * 1.08
      );
      fit.distance = Math.max(10, radius * 2.5 + 10);
      fit.near = 0.1;
      fit.far = fit.distance + radius * 2.5 + 20;
      return {
        yaw: camera.yaw,
        pitch: camera.pitch,
        zoom: camera.zoom,
        tx: tx,
        ty: ty,
        tz: tz
      };
    }

    function render() {
      var yaw;
      var pitch;
      var target;
      var eye;
      var aspect;
      var halfH;

      if (disposed) return;
      // Orbit changes only the view matrix; mesh buffers remain immutable.
      yaw = camera.yaw * Math.PI / 180;
      pitch = camera.pitch * Math.PI / 180;
      target = [camera.tx, camera.ty, camera.tz];
      eye = [
        target[0] + Math.cos(yaw) * Math.cos(pitch) * fit.distance,
        target[1] + Math.sin(pitch) * fit.distance,
        target[2] + Math.sin(yaw) * Math.cos(pitch) * fit.distance
      ];
      // Ortho distance controls clipping depth, while zoom controls screen size.
      aspect = width / height;
      halfH = camera.zoom / aspect;
      mat4Ortho(
        projection,
        -camera.zoom,
        camera.zoom,
        -halfH,
        halfH,
        fit.near,
        fit.far
      );
      mat4LookAt(view, eye, target, [0, 1, 0]);
      mat4Multiply(combined, projection, view);
      gl.clearColor(
        clearColor[0],
        clearColor[1],
        clearColor[2],
        clearColor[3]
      );
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!indexCount) return;
      gl.useProgram(program);
      gl.uniformMatrix4fv(viewProjection, false, combined);
      gl.uniform1f(verticalScale, vScale);
      gl.uniform3fv(sunDirection, sun);
      gl.bindVertexArray(vao);
      gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);
    }

    function dispose() {
      if (disposed) return;
      // Explicitly release GPU allocations because renderer switches are opt-in.
      gl.deleteBuffer(positionBuffer);
      gl.deleteBuffer(normalBuffer);
      gl.deleteBuffer(colorBuffer);
      gl.deleteBuffer(sideDepthBuffer);
      gl.deleteBuffer(indexBuffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      disposed = true;
    }

    return {
      resize: resize,
      setCamera: setCamera,
      setClearColor: setClearColor,
      setMesh: setMesh,
      setVerticalScale: setVerticalScale,
      setSun: setSun,
      fitCamera: fitCamera,
      render: render,
      dispose: dispose
    };
  }

  SM.buildVoxelMesh = buildVoxelMesh;
  SM.Voxel3D = { isSupported: isSupported, create: create };
})(window.SM = window.SM || {});
