/* Night bloom for the voxel view: lava glows.
 *
 * Pipeline (only while the night factor is above zero -- the day path never
 * touches any of this, so bloom costs nothing in daylight):
 *
 *   1. SOURCE   the caller redraws the terrain into a 1/4-resolution target in
 *               "emissive only" mode: every fragment writes depth (so hills
 *               occlude a light behind them) but only lava writes colour,
 *               as AMOUNTS, not colours: R = lava, G and B = lava x (cos,
 *               sin) of its pulse phase shifted into 0..1. This
 *               replaces a luminance bright-pass: the shader knows exactly
 *               what emits, so nothing else (snow, white clouds, sunlit
 *               sand) can bloom by accident. Nothing in the source depends
 *               on time, so it is reused while the camera stands still.
 *   2. BLUR     separable Gaussian (9 taps folded into 5 linear fetches),
 *               horizontal then vertical, twice, ping-ponging two 1/4-res
 *               textures; all four channels.
 *   3. COMPOSITE additive (ONE, ONE) full-screen triangle onto the canvas,
 *               after the scene, depth test off. Colour here: lava x the
 *               lava palette colour x its pulse. The main pass pulses lava by 0.42 + 0.42 x (0.55 +
 *               0.45 sin(wt + phase)); sin(wt + phase) = sin wt cos phase +
 *               cos wt sin phase is linear in the blurred (R, G, B), so the
 *               halo of every lava tile breathes with its own tile.
 *
 * Fallback: RGBA8 is colour-renderable in every WebGL2 implementation, but if
 * a framebuffer still reports incomplete (or a program fails to link) bloom
 * turns itself off for the session and says so once in the console; the
 * window lights in the main pass are unaffected.
 *
 * Every draw and allocation goes through `acct` (src/perf.js) so the
 * performance panel counts these passes too.
 */
(function (SM) {
  'use strict';

  var DOWNSAMPLE = 4;

  // Shared by the effect layers (bloom here, wind.js). `attribs`, if given,
  // fixes attribute slots in order before linking.
  function buildProgram(gl, name, vertexSource, fragmentSource, attribs) {
    var shaders = [
      [gl.VERTEX_SHADER, vertexSource],
      [gl.FRAGMENT_SHADER, fragmentSource]
    ].map(function (pair) {
      var sh = gl.createShader(pair[0]);
      gl.shaderSource(sh, pair[1]);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        window.__glShaderErrors = window.__glShaderErrors || [];
        window.__glShaderErrors.push(name + ': ' + gl.getShaderInfoLog(sh));
        console.warn('post: ' + name + ' shader compile failed\n' + gl.getShaderInfoLog(sh));
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    });
    var program;

    if (!shaders[0] || !shaders[1]) {
      shaders.forEach(function (sh) { if (sh) gl.deleteShader(sh); });
      return null;
    }
    program = gl.createProgram();
    gl.attachShader(program, shaders[0]);
    gl.attachShader(program, shaders[1]);
    (attribs || []).forEach(function (a, slot) { gl.bindAttribLocation(program, slot, a); });
    gl.linkProgram(program);
    gl.deleteShader(shaders[0]);
    gl.deleteShader(shaders[1]);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      window.__glShaderErrors = window.__glShaderErrors || [];
      window.__glShaderErrors.push(name + ' link: ' + gl.getProgramInfoLog(program));
      console.warn('post: ' + name + ' link failed\n' + gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }

  // A full-screen triangle from gl_VertexID: no vertex buffer at all.
  var FULLSCREEN_VS = [
    '#version 300 es',
    'out vec2 vUV;',
    'void main() {',
    '  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));',
    '  vUV = p;',
    '  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  function makeBlurProgram(gl) {
    var vertexSource = FULLSCREEN_VS;
    var fragmentSource = [
      '#version 300 es',
      'precision mediump float;',
      'in vec2 vUV;',
      'uniform sampler2D uSource;',
      'uniform vec2 uStep;',          // one texel along the blur axis
      'out vec4 outColor;',
      'void main() {',
      '  // 9-tap Gaussian folded into 5 bilinear fetches (weights sum to 1).',
      '  vec4 c = texture(uSource, vUV) * 0.2270270270;',
      '  c += texture(uSource, vUV + uStep * 1.3846153846) * 0.3162162162;',
      '  c += texture(uSource, vUV - uStep * 1.3846153846) * 0.3162162162;',
      '  c += texture(uSource, vUV + uStep * 3.2307692308) * 0.0702702703;',
      '  c += texture(uSource, vUV - uStep * 3.2307692308) * 0.0702702703;',
      '  outColor = c;',
      '}'
    ].join('\n');
    return buildProgram(gl, 'bloom blur', vertexSource, fragmentSource);
  }

  function makeCompositeProgram(gl) {
    var vertexSource = FULLSCREEN_VS;
    var fragmentSource = [
      '#version 300 es',
      'precision mediump float;',
      'in vec2 vUV;',
      'uniform sampler2D uBloom;',
      'uniform float uLavaStrength;',
      'uniform vec3 uLavaColor;',
      'uniform vec2 uPulse;',            // (sin wt, cos wt)
      'out vec4 outColor;',
      'void main() {',
      '  vec4 s = texture(uBloom, vUV);',
      '  float lavaCos = 2.0 * s.g - s.r;',  // lava x cos(phase), blurred
      '  float lavaSin = 2.0 * s.b - s.r;',
      '  float lava = 0.651 * s.r + 0.189 * (lavaCos * uPulse.x + lavaSin * uPulse.y);',
      '  outColor = vec4(max(lava, 0.0) * uLavaColor * uLavaStrength, 1.0);',
      '}'
    ].join('\n');
    return buildProgram(gl, 'bloom composite', vertexSource, fragmentSource);
  }

  function create(gl, acct) {
    var blur = makeBlurProgram(gl);
    var composite = makeCompositeProgram(gl);
    var disabled = !blur || !composite;
    var vao = gl.createVertexArray();      // empty: attribute-less draws
    var targets = null;                     // { w, h, src, a, b, depth }
    var loc = disabled ? null : {
      source: gl.getUniformLocation(blur, 'uSource'),
      step: gl.getUniformLocation(blur, 'uStep'),
      bloom: gl.getUniformLocation(composite, 'uBloom'),
      lavaStrength: gl.getUniformLocation(composite, 'uLavaStrength'),
      lavaColor: gl.getUniformLocation(composite, 'uLavaColor'),
      pulse: gl.getUniformLocation(composite, 'uPulse')
    };

    function giveUp(why) {
      if (!disabled) console.warn('post: bloom disabled -- ' + why);
      disabled = true;
      freeTargets();
    }

    function makeTarget(w, h, withDepth) {
      var tex = gl.createTexture();
      var fb = gl.createFramebuffer();
      var depth = null;

      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      acct.texture(tex, w * h * 4);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (withDepth) {
        depth = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
        acct.renderbuffer(depth, w * h * 2);
        gl.bindRenderbuffer(gl.RENDERBUFFER, null);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      }
      var status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { tex: tex, fb: fb, depth: depth, ok: status === gl.FRAMEBUFFER_COMPLETE };
    }

    function freeTarget(t) {
      if (!t) return;
      gl.deleteFramebuffer(t.fb);
      gl.deleteTexture(t.tex);
      acct.forget(t.tex);
      if (t.depth) {
        gl.deleteRenderbuffer(t.depth);
        acct.forget(t.depth);
      }
    }

    function freeTargets() {
      if (!targets) return;
      freeTarget(targets.src);
      freeTarget(targets.a);
      freeTarget(targets.b);
      targets = null;
    }

    // Targets follow the canvas size; reallocated only when it changes.
    function ensureTargets(width, height) {
      var w = Math.max(1, Math.ceil(width / DOWNSAMPLE));
      var h = Math.max(1, Math.ceil(height / DOWNSAMPLE));

      if (targets && targets.w === w && targets.h === h) return true;
      freeTargets();
      targets = {
        w: w,
        h: h,
        fresh: true,        // new targets hold nothing yet
        valid: false,
        src: makeTarget(w, h, true),
        a: makeTarget(w, h, false),
        b: makeTarget(w, h, false)
      };
      if (!targets.src.ok || !targets.a.ok || !targets.b.ok) {
        giveUp('framebuffer incomplete at ' + w + 'x' + h);
        return false;
      }
      return true;
    }

    function blurPass(from, to, dx, dy) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, to.fb);
      gl.bindTexture(gl.TEXTURE_2D, from.tex);
      gl.uniform2f(loc.step, dx / targets.w, dy / targets.h);
      acct.drawArrays(gl.TRIANGLES, 0, 3);
    }

    /* `drawSource()` draws the emissive-only scene with the caller's own
     * program and VAO; this module only owns the target it lands in.
     * `sourceChanged` false = the caller vouches that the source would come
     * out identical (same camera, size, mesh): the blurred result of the last
     * frame is reused and only the composite runs.
     * `look`: { lavaStrength, lavaColor[3], time (s, for the pulse) }. */
    function render(width, height, look, drawSource, sourceChanged) {
      var fresh;

      if (disabled || look.lavaStrength <= 0.001) return false;
      fresh = !targets;
      if (!ensureTargets(width, height)) return false;
      fresh = fresh || targets.fresh;
      targets.fresh = false;
      if (fresh || sourceChanged || !targets.valid) {
        buildBlur(drawSource);
        targets.valid = true;
      }
      compositeOnto(width, height, look);
      return true;
    }

    function buildBlur(drawSource) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets.src.fb);
      gl.viewport(0, 0, targets.w, targets.h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      drawSource();

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.useProgram(blur);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(loc.source, 0);
      blurPass(targets.src, targets.a, 1, 0);
      blurPass(targets.a, targets.b, 0, 1);
      blurPass(targets.b, targets.a, 2, 0);   // second, wider round
      blurPass(targets.a, targets.b, 0, 2);
      gl.bindVertexArray(null);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
    }

    function compositeOnto(width, height, look) {
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.useProgram(composite);
      gl.bindTexture(gl.TEXTURE_2D, targets.b.tex);
      gl.uniform1i(loc.bloom, 0);
      gl.uniform1f(loc.lavaStrength, look.lavaStrength);
      gl.uniform3fv(loc.lavaColor, look.lavaColor);
      // Same angular speed as the terrain shader's lava pulse (uTime * 2.40).
      gl.uniform2f(loc.pulse, Math.sin(look.time * 2.4), Math.cos(look.time * 2.4));
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      acct.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindVertexArray(null);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
    }

    function dispose() {
      freeTargets();
      gl.deleteVertexArray(vao);
      if (blur) gl.deleteProgram(blur);
      if (composite) gl.deleteProgram(composite);
      disabled = true;
    }

    return {
      render: render,
      dispose: dispose,
      isAvailable: function () { return !disabled; },
      // Test hook: what the fallback path does when a target cannot be made.
      forceFallback: function () { giveUp('forced'); }
    };
  }

  SM.Bloom = { create: create, DOWNSAMPLE: DOWNSAMPLE };
  SM.buildGLProgram = buildProgram;
})(window.SM = window.SM || {});
