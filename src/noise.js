/* Seedable 2D simplex noise + fBm helper. No dependencies.
 * Simplex algorithm after Stefan Gustavson's public-domain reference. */
(function (SM) {
  'use strict';

  var F2 = 0.5 * (Math.sqrt(3) - 1);
  var G2 = (3 - Math.sqrt(3)) / 6;

  // 8-direction gradient set (unit axes + diagonals), 2 floats each.
  var GRAD2 = new Float32Array([
    1, 0, -1, 0, 0, 1, 0, -1,
    1, 1, -1, 1, 1, -1, -1, -1
  ]);

  function mulberry32(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Returns a noise2D(x, y) function in roughly [-1, 1].
  function makeNoise2D(seed) {
    var rand = mulberry32(seed);
    var p = new Uint8Array(256);
    var i;
    for (i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    var perm = new Uint8Array(512);
    for (i = 0; i < 512; i++) perm[i] = p[i & 255];

    return function noise2D(xin, yin) {
      var s = (xin + yin) * F2;
      var i0 = Math.floor(xin + s);
      var j0 = Math.floor(yin + s);
      var t = (i0 + j0) * G2;
      var x0 = xin - (i0 - t);
      var y0 = yin - (j0 - t);

      var i1 = x0 > y0 ? 1 : 0;
      var j1 = x0 > y0 ? 0 : 1;

      var x1 = x0 - i1 + G2;
      var y1 = y0 - j1 + G2;
      var x2 = x0 - 1 + 2 * G2;
      var y2 = y0 - 1 + 2 * G2;

      var ii = i0 & 255;
      var jj = j0 & 255;
      var n0 = 0, n1 = 0, n2 = 0;

      var t0 = 0.5 - x0 * x0 - y0 * y0;
      if (t0 > 0) {
        var g0 = (perm[ii + perm[jj]] & 7) * 2;
        t0 *= t0;
        n0 = t0 * t0 * (GRAD2[g0] * x0 + GRAD2[g0 + 1] * y0);
      }
      var t1 = 0.5 - x1 * x1 - y1 * y1;
      if (t1 > 0) {
        var g1 = (perm[ii + i1 + perm[jj + j1]] & 7) * 2;
        t1 *= t1;
        n1 = t1 * t1 * (GRAD2[g1] * x1 + GRAD2[g1 + 1] * y1);
      }
      var t2 = 0.5 - x2 * x2 - y2 * y2;
      if (t2 > 0) {
        var g2 = (perm[ii + 1 + perm[jj + 1]] & 7) * 2;
        t2 *= t2;
        n2 = t2 * t2 * (GRAD2[g2] * x2 + GRAD2[g2 + 1] * y2);
      }
      return 70 * (n0 + n1 + n2);
    };
  }

  // Fractal Brownian motion. Returns roughly [-1, 1].
  function fbm(noise, x, y, octaves, lacunarity, gain) {
    var amp = 1, freq = 1, sum = 0, norm = 0;
    for (var o = 0; o < octaves; o++) {
      sum += amp * noise(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  // Ridged fBm: folds noise around zero so ridges form where it crosses zero.
  // Each octave is already in [0, 1], so the weighted sum stays in [0, 1] —
  // no min/max normalization needed downstream.
  function fbmRidged(noise, x, y, octaves, lacunarity, gain) {
    var amp = 1, freq = 1, sum = 0, norm = 0;
    for (var o = 0; o < octaves; o++) {
      var n = 1 - Math.abs(noise(x * freq, y * freq));
      n = n * n;
      sum += amp * n;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  // Deterministic math (2026-10-19, seed = whole map). ECMAScript only
  // guarantees +, -, *, / and sqrt to be correctly rounded; Math.sin, cos,
  // pow, exp and log may differ in the last bit between V8, JavaScriptCore
  // and SpiderMonkey, which can flip one cell's level. Everything that feeds
  // the grid goes through these instead: series built from + - * / only, so
  // the same input gives the same bits in every engine.
  var LN2 = 0.6931471805599453, TWO_PI = 6.283185307179586;
  var SIN_C = [], COS_C = [];
  (function () {
    var f = 1, k;
    for (k = 1; k <= 33; k++) {
      f *= k;
      if (k % 2 === 1) SIN_C.push((((k - 1) / 2) % 2 ? -1 : 1) / f);
      else COS_C.push(((k / 2) % 2 ? -1 : 1) / f);
    }
  })();
  var f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
  var LITTLE = (function () { f64[0] = 1; return u32[1] === 0x3ff00000; })();
  var HI = LITTLE ? 1 : 0, LO = LITTLE ? 0 : 1;

  function reduce(x) { return x - Math.round(x / TWO_PI) * TWO_PI; } // (-pi, pi]
  function sin(x) {
    var r = reduce(x), r2 = r * r, s = 0, i;
    for (i = SIN_C.length - 1; i >= 0; i--) s = s * r2 + SIN_C[i];
    return s * r;
  }
  function cos(x) {
    var r = reduce(x), r2 = r * r, s = 0, i;
    for (i = COS_C.length - 1; i >= 0; i--) s = s * r2 + COS_C[i];
    return s * r2 + 1;
  }
  // log for x > 0: x = m * 2^e with m in [sqrt(.5), sqrt(2)), atanh series.
  function log(x) {
    if (!(x > 0)) return x === 0 ? -Infinity : NaN;
    f64[0] = x;
    var e = ((u32[HI] >>> 20) & 0x7ff) - 1023;
    if (e === -1023) { f64[0] = x * 18014398509481984; e = ((u32[HI] >>> 20) & 0x7ff) - 1023 - 54; }
    u32[HI] = (u32[HI] & 0x000fffff) | 0x3ff00000; // mantissa in [1, 2)
    var m = f64[0];
    if (m > 1.4142135623730951) { m = m / 2; e += 1; }
    var s = (m - 1) / (m + 1), s2 = s * s, t = 0, i;
    for (i = 29; i >= 1; i -= 2) t = t * s2 + 1 / i;
    return 2 * s * t + e * LN2;
  }
  function exp(x) {
    if (x > 709) return Infinity;
    if (x < -745) return 0;
    var k = Math.round(x / LN2), r = x - k * LN2, t = 1, i;
    for (i = 17; i >= 1; i--) t = 1 + t * r / i;
    var p = k < 0 ? 0.5 : 2, n = k < 0 ? -k : k, c = 1;
    while (n > 0) { if (n & 1) c *= p; p *= p; n >>= 1; }
    return t * c;
  }
  // x^y for x >= 0. Half-integer exponents ride on sqrt (exact), the rest on exp/log.
  function pow(x, y) {
    if (x <= 0) return y === 0 ? 1 : 0;
    if (y === 1.5) return x * Math.sqrt(x);
    if (y === 0.5) return Math.sqrt(x);
    return exp(y * log(x));
  }

  SM.mulberry32 = mulberry32;
  SM.dmath = { sin: sin, cos: cos, log: log, exp: exp, pow: pow };
  SM.makeNoise2D = makeNoise2D;
  SM.fbm = fbm;
  SM.fbmRidged = fbmRidged;
})(window.SM = window.SM || {});
