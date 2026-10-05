/* Performance accounting for the voxel view: "I measure what I build".
 *
 * Two parts, both honest about what they can and cannot see:
 *
 *  - `createFrameStats`: a rolling window of the last N frames (frame interval
 *    from requestAnimationFrame, plus the CPU time spent inside render()).
 *    The interval is what the user experiences; on a fast GPU it is pinned to
 *    the display refresh, which is why the CPU and (when the browser exposes a
 *    timer) GPU times are reported next to it.
 *
 *  - `createGLCounter`: the renderer routes EVERY draw call and EVERY buffer /
 *    texture / renderbuffer allocation through this object, so draw calls and
 *    triangles are counted at the source (no vendor extension, no guessing)
 *    and GPU memory is the sum of the bytes this app asked for. It is an
 *    ESTIMATE: drivers pad, align, and keep their own copies; the canvas's
 *    own drawing buffer is estimated separately from its size and MSAA count.
 *    `--perf` in tools/headless.js fails if voxel3d.js calls gl.draw* or
 *    gl.bufferData directly, so a new pass cannot silently escape the count.
 *
 * Cost when the panel is hidden: per-frame counting is gated on `enabled`
 * (one boolean test per draw call); allocations are recorded either way
 * because they happen once per map, not per frame, and the panel must show
 * the right total the moment it is opened.
 */
(function (SM) {
  'use strict';

  function createFrameStats(capacity) {
    var size = Math.max(2, capacity | 0 || 120);
    var interval = new Float64Array(size);
    var cpu = new Float64Array(size);
    var gpu = new Float64Array(size);
    var count = 0;
    var head = 0;
    var gpuCount = 0;
    var gpuHead = 0;

    // One rendered frame: the rAF-to-rAF interval (ms) and the time spent
    // inside render() on the main thread (ms). A non-finite or non-positive
    // interval (first frame after idle) records CPU time only.
    function push(intervalMs, cpuMs) {
      interval[head] = intervalMs > 0 && isFinite(intervalMs) ? intervalMs : NaN;
      cpu[head] = cpuMs;
      head = (head + 1) % size;
      if (count < size) count++;
    }

    // GPU timings arrive a few frames late (async query), so they have their
    // own ring.
    function pushGpu(ms) {
      gpu[gpuHead] = ms;
      gpuHead = (gpuHead + 1) % size;
      if (gpuCount < size) gpuCount++;
    }

    function summary() {
      var n = 0;
      var sum = 0;
      var worst = 0;
      var cpuSum = 0;
      var cpuWorst = 0;
      var gpuSum = 0;
      var i;

      for (i = 0; i < count; i++) {
        cpuSum += cpu[i];
        if (cpu[i] > cpuWorst) cpuWorst = cpu[i];
        if (!(interval[i] > 0)) continue;
        n++;
        sum += interval[i];
        if (interval[i] > worst) worst = interval[i];
      }
      for (i = 0; i < gpuCount; i++) gpuSum += gpu[i];
      return {
        frames: count,
        intervals: n,
        avgMs: n ? sum / n : null,
        worstMs: n ? worst : null,
        fps: n ? 1000 / (sum / n) : null,
        cpuAvgMs: count ? cpuSum / count : null,
        cpuWorstMs: count ? cpuWorst : null,
        gpuAvgMs: gpuCount ? gpuSum / gpuCount : null,
        gpuFrames: gpuCount
      };
    }

    function reset() {
      count = 0;
      head = 0;
      gpuCount = 0;
      gpuHead = 0;
    }

    return { push: push, pushGpu: pushGpu, summary: summary, reset: reset, capacity: size };
  }

  // Primitive count of one draw call, by mode. Triangles are what the panel
  // reports; lines and points are counted separately so they are not hidden.
  function primitives(gl, mode, count) {
    if (mode === gl.TRIANGLES) return { tris: Math.floor(count / 3), other: 0 };
    if (mode === gl.TRIANGLE_STRIP || mode === gl.TRIANGLE_FAN) {
      return { tris: Math.max(0, count - 2), other: 0 };
    }
    return { tris: 0, other: count };
  }

  function createGLCounter(gl) {
    var enabled = false;
    var bytes = new Map();      // GL object -> { kind, bytes }
    var draws = 0;
    var tris = 0;
    var other = 0;
    var last = { draws: 0, tris: 0, other: 0 };

    function record(obj, kind, n) {
      if (obj) bytes.set(obj, { kind: kind, bytes: n });
    }

    var api = {
      setEnabled: function (on) { enabled = !!on; },
      isEnabled: function () { return enabled; },

      beginFrame: function () {
        draws = 0;
        tris = 0;
        other = 0;
      },
      endFrame: function () {
        if (!enabled) return;
        last = { draws: draws, tris: tris, other: other };
      },
      lastFrame: function () { return last; },

      drawElements: function (mode, count, type, offset) {
        gl.drawElements(mode, count, type, offset);
        if (enabled) {
          var p = primitives(gl, mode, count);
          draws++;
          tris += p.tris;
          other += p.other;
        }
      },
      drawArrays: function (mode, first, count) {
        gl.drawArrays(mode, first, count);
        if (enabled) {
          var p = primitives(gl, mode, count);
          draws++;
          tris += p.tris;
          other += p.other;
        }
      },

      // `buffer` must be the object currently bound to `target`.
      bufferData: function (target, buffer, data, usage) {
        gl.bufferData(target, data, usage);
        record(buffer, 'buffer', typeof data === 'number' ? data : data.byteLength);
      },
      // Textures and renderbuffers: the caller knows width x height x bytes
      // per texel; mip chains are not used in this renderer.
      texture: function (tex, n) { record(tex, 'texture', n); },
      renderbuffer: function (rb, n) { record(rb, 'renderbuffer', n); },
      forget: function (obj) { bytes.delete(obj); },

      memory: function () {
        var out = { buffer: 0, texture: 0, renderbuffer: 0, total: 0 };
        bytes.forEach(function (v) {
          out[v.kind] += v.bytes;
          out.total += v.bytes;
        });
        return out;
      }
    };
    return api;
  }

  /* The canvas's own drawing buffer, which no app call allocates: a resolved
   * RGBA8 front and back buffer, plus (with MSAA) a multisampled colour and a
   * depth-stencil buffer of `samples` each, or a single-sample depth-stencil
   * without MSAA. An estimate: the browser may keep more (or fewer) copies. */
  function drawingBufferBytes(width, height, samples) {
    var px = Math.max(0, width) * Math.max(0, height);
    var s = Math.max(0, samples | 0);
    return px * 4 * 2 + (s > 0 ? px * s * (4 + 4) : px * 4);
  }

  SM.Perf = {
    createFrameStats: createFrameStats,
    createGLCounter: createGLCounter,
    drawingBufferBytes: drawingBufferBytes
  };
})(window.SM = window.SM || {});
