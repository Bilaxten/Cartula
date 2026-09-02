/* WebGL2 voxel renderer foundation. Terrain mesh generation is added in Faz 1;
 * this phase only draws a temporary world-space reference for camera checks. */
(function (SM) {
  'use strict';

  function mat4Identity(out) {
    out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
    out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
    return out;
  }

  function mat4Multiply(out, a, b) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    var b00 = b[0], b01 = b[1], b02 = b[2], b03 = b[3];
    var b10 = b[4], b11 = b[5], b12 = b[6], b13 = b[7];
    var b20 = b[8], b21 = b[9], b22 = b[10], b23 = b[11];
    var b30 = b[12], b31 = b[13], b32 = b[14], b33 = b[15];

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
    out[0] = -2 * lr; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = -2 * bt; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = 2 * nf; out[11] = 0;
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
    zx /= zlen; zy /= zlen; zz /= zlen;

    var xx = up[1] * zz - up[2] * zy;
    var xy = up[2] * zx - up[0] * zz;
    var xz = up[0] * zy - up[1] * zx;
    var xlen = Math.sqrt(xx * xx + xy * xy + xz * xz) || 1;
    xx /= xlen; xy /= xlen; xz /= xlen;

    var yx = zy * xz - zz * xy;
    var yy = zz * xx - zx * xz;
    var yz = zx * xy - zy * xx;

    out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
    out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
    out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
    out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    out[15] = 1;
    return out;
  }

  function compileShader(gl, type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function makeProgram(gl) {
    var vertex = compileShader(gl, gl.VERTEX_SHADER,
      '#version 300 es\n' +
      'in vec3 aPosition;\n' +
      'in vec3 aColor;\n' +
      'uniform mat4 uViewProjection;\n' +
      'out vec3 vColor;\n' +
      'void main() { vColor = aColor; gl_Position = uViewProjection * vec4(aPosition, 1.0); }');
    var fragment = compileShader(gl, gl.FRAGMENT_SHADER,
      '#version 300 es\nprecision mediump float;\n' +
      'in vec3 vColor;\n' +
      'out vec4 outColor;\n' +
      'void main() { outColor = vec4(vColor, 1.0); }');
    var program;
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

  function makeReferenceVertices() {
    var data = [];
    function line(ax, ay, az, bx, by, bz, r, g, b) {
      data.push(ax, ay, az, r, g, b, bx, by, bz, r, g, b);
    }
    // TEMP: Faz 1'de kaldırılacak
    line(0, 0, 0, 6, 0, 0, 1, 0.2, 0.2);
    line(0, 0, 0, 0, 6, 0, 0.2, 1, 0.2);
    line(0, 0, 0, 0, 0, 6, 0.2, 0.45, 1);
    for (var i = -5; i <= 5; i++) {
      line(i, 0, -5, i, 0, 5, 0.28, 0.32, 0.4);
      line(-5, 0, i, 5, 0, i, 0.28, 0.32, 0.4);
    }
    return new Float32Array(data);
  }

  function isSupported() {
    return !!window.WebGL2RenderingContext;
  }

  function create(canvas) {
    var gl;
    try {
      gl = canvas.getContext('webgl2', { alpha: false, antialias: true });
    } catch (err) {
      return null;
    }
    if (!gl) return null;

    var program = makeProgram(gl);
    if (!program) return null;
    var buffer = gl.createBuffer();
    var vertices = makeReferenceVertices();
    var position = gl.getAttribLocation(program, 'aPosition');
    var color = gl.getAttribLocation(program, 'aColor');
    var viewProjection = gl.getUniformLocation(program, 'uViewProjection');
    var projection = new Float32Array(16);
    var view = new Float32Array(16);
    var combined = new Float32Array(16);
    var camera = { yaw: 35, pitch: 42, zoom: 9, tx: 0, ty: 0, tz: 0 };
    var clearColor = [0.055, 0.075, 0.11, 1];
    var width = 1, height = 1;
    var disposed = false;

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.enable(gl.DEPTH_TEST);

    function resize(cssW, cssH, dpr) {
      if (disposed) return;
      width = Math.max(1, Math.round(cssW * (dpr || 1)));
      height = Math.max(1, Math.round(cssH * (dpr || 1)));
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }

    function setCamera(cam) {
      if (!cam) return;
      camera.yaw = ((+cam.yaw % 360) + 360) % 360;
      camera.pitch = Math.max(10, Math.min(89, +cam.pitch));
      camera.zoom = Math.max(0.01, +cam.zoom);
      camera.tx = +cam.tx || 0;
      camera.ty = +cam.ty || 0;
      camera.tz = +cam.tz || 0;
    }

    function setClearColor(r, g, b, a) {
      clearColor[0] = r;
      clearColor[1] = g;
      clearColor[2] = b;
      clearColor[3] = a;
    }

    function render() {
      if (disposed) return;
      var yaw = camera.yaw * Math.PI / 180;
      var pitch = camera.pitch * Math.PI / 180;
      // Faz 1: near/far and distance must scale with map bounds.
      var distance = 100;
      var target = [camera.tx, camera.ty, camera.tz];
      var eye = [
        target[0] + Math.cos(yaw) * Math.cos(pitch) * distance,
        target[1] + Math.sin(pitch) * distance,
        target[2] + Math.sin(yaw) * Math.cos(pitch) * distance
      ];
      var aspect = width / height;
      var halfH = camera.zoom / aspect;

      mat4Ortho(projection, -camera.zoom, camera.zoom, -halfH, halfH, -200, 200);
      mat4LookAt(view, eye, target, [0, 1, 0]);
      mat4Multiply(combined, projection, view);
      gl.clearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3]);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(position);
      gl.enableVertexAttribArray(color);
      // Faz 1: bind vertex attributes through a VAO for the terrain mesh.
      gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 24, 0);
      gl.vertexAttribPointer(color, 3, gl.FLOAT, false, 24, 12);
      gl.uniformMatrix4fv(viewProjection, false, combined);
      gl.drawArrays(gl.LINES, 0, vertices.length / 6);
    }

    function dispose() {
      if (disposed) return;
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      disposed = true;
    }

    mat4Identity(combined);
    return {
      resize: resize,
      setCamera: setCamera,
      setClearColor: setClearColor,
      render: render,
      dispose: dispose
    };
  }

  SM.Voxel3D = { isSupported: isSupported, create: create };
})(window.SM = window.SM || {});
