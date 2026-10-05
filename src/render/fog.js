/* Valley fog: low mist pooling in valleys and low ground in the morning.
 *
 * Owner-approved (2026-10-06). Driven by *Time of day* alone (`amount`):
 * thickest at dawn, thinning through the morning, gone by late morning and
 * all afternoon, faint again at dusk, gone again by 22:00, rising from
 * 2:30 toward the next dawn. Never a property of the map: the slider
 * changes nothing but this one number. The dark hours are fog-free on
 * purpose: fog there is invisible under the night grade and its shader
 * variant cost ~5 ms a frame on SwiftShader (measured 2026-10-06).
 *
 * Where (`field`, per map, data only): a fog SURFACE per tile -- the
 * terrain around it (a wide box blur, sea counted at its surface 0) less
 * a little. A tile below its surroundings (a valley floor, low ground at
 * a mountain's foot, a river valley) sits under its fog surface; a ridge
 * or a flat plain sits above it. The tile's fog is
 *   DENSITY x clamp((surface - level) / THICKNESS, 0, 1),
 * so a deep valley is thick with it and a shallow one only mists over;
 * the clock's amount(hour) scales it all. The sea never fogs.
 *
 * Per TILE, the whole column alike (its top and its walls): blocky, like
 * the voxels. A first version fogged by vertex height, so every wall
 * faded from clear at its top to fogged at its foot -- every coastal
 * cliff grew a white curtain down to an unfogged sea (seen 2026-10-06).
 *
 * How (voxel3d.js, FOG variant of the terrain shader, compiled only while
 * the fog is on, so the afternoon costs nothing): the vertex shader reads
 * the tile's fog from a small R8 texture. The colour is the palette's
 * snow, dimmed with the daylight -- and then graded like everything else
 * (the golden morning wash, the night blue), so no new colour.
 *
 * `field` and `amount` are DOM- and GL-free (`--fog` in tools/headless.js).
 */
(function (SM) {
  'use strict';

  var RADIUS = 6;               // box blur radius, twice: ~25 tiles across
  var LIFT = 0.3;               // fog surface this far below the surroundings
  var THICKNESS = 1.6;          // levels from the fog surface to full fog
  var DENSITY = 0.72;           // fog's share of the colour at its thickest
  var DUSK = 0.3;               // evening fog, as a share of the dawn fog

  function smooth(a, b, x) {
    var t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  /* 0..1 by the clock (any hour, wraps at 24). Continuous everywhere, so
   * dragging the slider never pops the fog in or out. */
  function amount(hour) {
    var h = ((+hour % 24) + 24) % 24;
    if (h < 6) return smooth(2.5, 5.5, h);                        // rises toward dawn
    if (h < 8) return 1;                                          // dawn
    if (h < 12) return 1 - smooth(8, 11, h);                      // burns off
    if (h < 16.5) return 0;                                       // afternoon: none
    if (h < 19.5) return DUSK * smooth(16.5, 19.5, h);            // dusk
    return DUSK * (1 - smooth(19.5, 22, h));                      // gone by 22:00
  }

  function blur(src, W, H, r) {
    var tmp = new Float32Array(W * H);
    var out = new Float32Array(W * H);
    var x;
    var y;
    var k;
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        var s = 0;
        var n = 0;
        for (k = -r; k <= r; k++) {
          if (x + k < 0 || x + k >= W) continue;
          s += src[y * W + x + k];
          n++;
        }
        tmp[y * W + x] = s / n;
      }
    }
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        var s2 = 0;
        var n2 = 0;
        for (k = -r; k <= r; k++) {
          if (y + k < 0 || y + k >= H) continue;
          s2 += tmp[(y + k) * W + x];
          n2++;
        }
        out[y * W + x] = s2 / n2;
      }
    }
    return out;
  }

  /* Fog of every tile at full amount, 0..1 as bytes 0..255: Uint8Array
   * W x H. Sea tiles hold 0. */
  function field(grid) {
    var W = grid.width;
    var H = grid.height;
    var n = W * H;
    var ground = new Float32Array(n);
    var out = new Uint8Array(n);
    var i;

    for (i = 0; i < n; i++) ground[i] = Math.max(0, grid.level[i]);
    var wide = blur(blur(ground, W, H, RADIUS), W, H, RADIUS);
    for (i = 0; i < n; i++) {
      if (SM.isSea && SM.isSea(grid, i)) continue;
      out[i] = Math.round(255 * at(wide[i] - LIFT, grid.level[i]));
    }
    return out;
  }

  /* Fog of a tile at `level` under a fog surface `surface` (levels), at
   * full amount. */
  function at(surface, level) {
    return DENSITY * Math.max(0, Math.min(1, (surface - Math.max(level, 0)) / THICKNESS));
  }

  SM.Fog = {
    amount: amount,
    field: field,
    at: at,
    RADIUS: RADIUS,
    LIFT: LIFT,
    THICKNESS: THICKNESS,
    DENSITY: DENSITY,
    DUSK: DUSK
  };
})(window.SM = window.SM || {});
