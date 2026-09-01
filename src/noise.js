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

  SM.mulberry32 = mulberry32;
  SM.makeNoise2D = makeNoise2D;
  SM.fbm = fbm;
})(window.SM = window.SM || {});
