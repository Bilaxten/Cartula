/* Seasons: a render-only colour and snow-line effect over the generated map.
 *
 * Owner-approved (2026-10-06). One panel slider, *Season* (0 spring,
 * 1 summer, 2 autumn, 3 winter; continuous). Spring and summer are the map
 * as generated. It changes NOTHING in the grid: no biome, level or seed
 * moves, Random / Regenerate leave it alone (like the map size), and it is
 * a view setting in the share link like *Time of day*.
 *
 *   - autumn: deciduous forest (the `forest` biome; taiga and rainforest
 *     stay green) turns warm, each tile its own tone between the palette's
 *     savanna gold and mesa rust; it peaks at autumn, and by deep winter
 *     the leaves are gone: the forest stands bare (toward the palette's
 *     `bare` brown-grey, BARE_MIX) unless snow covers it;
 *   - winter: the snow line comes down. Every land tile has a snow NEED,
 *     the distance its height is below the generator's own snow line for
 *     its temperature (biome.js classify: the line is lower where it is
 *     colder); winter lowers the line by up to SNOW_DROP, so the peaks go
 *     white first, then the high and cold land (at full winter about 30%
 *     of the land on the default maps). Top faces are covered, walls get
 *     a little. Fresh water (rivers, lakes) colder than FREEZE_T x winter
 *     freezes: palette ice (snow toward the shallow sea), no wave shading,
 *     no shore foam, no flow. The geometric wave dip is left as it is: it
 *     is tiny on fresh water, and stopping it per tile would open slits
 *     where frozen and open water share a corner.
 *
 * Per tile, the whole column alike (blocky). `data` packs what a tile
 * needs into RGBA8 (R snow need, 255 = never; G temperature on fresh water,
 * 255 elsewhere; B autumn tone 1..255 on deciduous forest, 0 elsewhere);
 * the voxel view reads it in the vertex stage of the SEASON shader variant
 * and recolours there (compiled when the slider first leaves summer, used
 * only off summer: summer costs nothing), and the top-down view paints
 * `tileColor`, the JS twin, so the two projections agree. DOM- and GL-free apart from the GLSL
 * strings (`--season` in tools/headless.js).
 */
(function (SM) {
  'use strict';

  var SNOW_RANGE = 0.5;         // snow need encoded over 0..SNOW_RANGE (land share)
  var SNOW_DROP = 0.3;          // snow line drop at full winter (land share)
  var SNOW_SOFT = 0.03;         // the snow edge, soft over this much need
  var FREEZE_T = 0.4;           // fresh water colder than this x winter freezes
  var FREEZE_SOFT = 0.04;
  var AUTUMN_MIX = 0.8;         // the warm tone's share at full autumn
  var BARE_MIX = 0.55;          // the bare winter forest's share of `bare`
  var SNOW_TOP = 0.92;          // snow's share on a top face / on a wall
  var SNOW_WALL = 0.3;
  var SUMMER = 1;

  function smooth(a, b, x) {
    var t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  /* How much winter and how much autumn a slider value holds (0..1 each).
   * Spring and summer: none. Autumn rises from summer, peaks at 2 and is
   * gone by deep winter (the leaves fall); winter rises from autumn. */
  function amounts(s) {
    s = Math.max(0, Math.min(3, +s || 0));
    return {
      winter: smooth(2, 3, s),
      autumn: smooth(1, 2, s) * (1 - smooth(2.4, 3, s))
    };
  }

  function rgb(id) {
    var hex = SM.BIOME_LIST.find(function (b) { return b.id === id; }).color;
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // Palette colours (0..255): snow, ice, the two autumn ends.
  var COLORS = null;
  function colors() {
    if (COLORS) return COLORS;
    var snow = rgb('snow');
    var sea = rgb('shallow_water');
    COLORS = {
      snow: snow,
      ice: snow.map(function (v, k) { return v * 0.65 + sea[k] * 0.35; }),
      autumnA: rgb('savanna'),
      autumnB: rgb('mesa'),
      bare: rgb('bare')
    };
    return COLORS;
  }

  function hash(x, y) {
    var h = Math.sin(x * 41.37 + y * 289.13) * 43758.5453;
    return h - Math.floor(h);
  }

  /* The bytes of tile i (see the header): [R, G, B]. */
  function tileBytes(grid, i, out) {
    var B = SM.BIOME_IDX;
    var sea = SM.isSea ? SM.isSea(grid, i) : false;
    out = out || [0, 0, 0];
    out[0] = 255;
    out[1] = 255;
    out[2] = 0;
    // A hand-built grid without climate (tests, old callers): no season.
    if (!grid.temperature || !grid.elevation) return out;
    if (grid.water[i]) {
      if (!sea) out[1] = Math.max(0, Math.min(254, Math.round(grid.temperature[i] * 255)));
      return out;
    }
    var span = grid.landSpan || 1;
    var lf = Math.max(0, Math.min(1, (grid.elevation[i] - (grid.seaThresh || 0)) / span));
    var line = Math.max(0.28, Math.min(0.95, 0.74 - (0.5 - grid.temperature[i]) * 0.5));
    var need = Math.max(0, line - lf);
    // Lava melts any snow (a winter volcano keeps its glowing crater).
    if (need < SNOW_RANGE && !(grid.lava && grid.lava[i])) out[0] = Math.min(254, Math.round(need / SNOW_RANGE * 254));
    if (grid.biome[i] === B.forest) out[2] = 1 + Math.round(hash(i % grid.width, (i / grid.width) | 0) * 254);
    return out;
  }

  /* RGBA8 per tile for the voxel view's SEASON variant. */
  function data(grid) {
    var n = grid.width * grid.height;
    var out = new Uint8Array(n * 4);
    var b = [0, 0, 0];
    for (var i = 0; i < n; i++) {
      tileBytes(grid, i, b);
      out[i * 4] = b[0];
      out[i * 4 + 1] = b[1];
      out[i * 4 + 2] = b[2];
      out[i * 4 + 3] = 255;
    }
    return out;
  }

  /* Snow, autumn, frozen amounts (0..1) of a tile's bytes under amounts a:
   * the vertex shader's formulas. */
  function tileAmounts(b, a, out) {
    out = out || {};
    var need = b[0] / 254 * SNOW_RANGE;
    out.snow = b[0] >= 255 ? 0 : Math.max(0, Math.min(1, (a.winter * SNOW_DROP - need) / SNOW_SOFT));
    out.autumn = b[2] ? a.autumn : 0;
    out.bare = b[2] ? a.winter : 0;
    out.tone = b[2] ? (b[2] - 1) / 254 : 0;
    out.frozen = b[1] >= 255 ? 0 : Math.max(0, Math.min(1, (a.winter * FREEZE_T - b[1] / 255) / FREEZE_SOFT));
    return out;
  }

  function mix(c, d, t) {
    return [c[0] + (d[0] - c[0]) * t, c[1] + (d[1] - c[1]) * t, c[2] + (d[2] - c[2]) * t];
  }

  /* The top-down view's colour of tile i (0..255 rgb) in season s: the
   * same steps the shader takes on a top face. */
  function tileColor(grid, i, c, s) {
    var a = amounts(s);
    if (!a.winter && !a.autumn) return c;
    var t = tileAmounts(tileBytes(grid, i), a);
    var C = colors();
    if (t.autumn) c = mix(c, mix(C.autumnA, C.autumnB, t.tone), AUTUMN_MIX * t.autumn);
    if (t.bare) c = mix(c, C.bare, BARE_MIX * t.bare);
    if (t.frozen) c = mix(c, C.ice, t.frozen);
    if (t.snow) c = mix(c, C.snow, SNOW_TOP * t.snow);
    return c;
  }

  function glslFloat(value) {
    var text = String(value);
    return text.indexOf('.') < 0 ? text + '.0' : text;
  }

  // Vertex stage (SEASON variant), after vColor / vFall / vFallCoord /
  // vWaveShade are set; needs aCellUV, aNormal, aFall and `plinth`. The
  // whole season is decided per VERTEX (a tile's vertices agree, so it is
  // flat per face): the colour goes out through vColor, frozen water stops
  // its swell shading, its shore foam (vFallCoord, the foam corner value on
  // a water top) and its falls (vFall). Per fragment it cost ~10 ms a frame
  // more on SwiftShader (measured 2026-10-06); per vertex it costs a few.
  var VERTEX_GLSL = [
    '  ivec2 seasonSize = textureSize(uSeasonMap, 0);',
    '  ivec2 seasonCell = clamp(ivec2(aCellUV * vec2(seasonSize)), ivec2(0), seasonSize - 1);',
    '  vec4 sd = texelFetch(uSeasonMap, seasonCell, 0) * 255.0;',
    '  float sKeep = 1.0 - plinth;',
    '  float sNeed = sd.r / 254.0 * ' + glslFloat(SNOW_RANGE) + ';',
    '  float sSnow = sKeep * (1.0 - step(254.5, sd.r)) *',
    '    clamp((uSeason.x * ' + glslFloat(SNOW_DROP) + ' - sNeed) / ' + glslFloat(SNOW_SOFT) + ', 0.0, 1.0);',
    '  float sFrozen = sKeep * (1.0 - step(254.5, sd.g)) *',
    '    clamp((uSeason.x * ' + glslFloat(FREEZE_T) + ' - sd.g / 255.0) / ' + glslFloat(FREEZE_SOFT) + ', 0.0, 1.0);',
    '  float sForest = sKeep * step(0.5, sd.b);',
    '  float sTone = max(0.0, sd.b - 1.0) / 254.0;',
    '  vec3 sc = vColor;',
    '  // Autumn leaves, then a bare winter forest.',
    '  sc = mix(sc, mix(uAutumnA, uAutumnB, sTone), ' + glslFloat(AUTUMN_MIX) + ' * sForest * uSeason.y);',
    '  sc = mix(sc, uBare, ' + glslFloat(BARE_MIX) + ' * sForest * uSeason.x);',
    '  sc = mix(sc, uIceColor, sFrozen);',
    '  sc = mix(sc, uSnowColor, sSnow * mix(' + glslFloat(SNOW_WALL) + ', ' + glslFloat(SNOW_TOP) + ', step(0.5, aNormal.y)));',
    '  vColor = sc;',
    '  // Frozen water: no swell shading, no surf, a frozen fall.',
    '  vWaveShade *= 1.0 - sFrozen;',
    '  if (aFall < 0.5) vFallCoord *= 1.0 - sFrozen;',
    '  vFall *= 1.0 - sFrozen;',
    '#ifdef RIVER',
    '  vFrozen = sFrozen;',
    '#endif'
  ].join('\n');

  SM.Season = {
    amounts: amounts,
    data: data,
    tileBytes: tileBytes,
    tileAmounts: tileAmounts,
    tileColor: tileColor,
    colors: colors,
    VERTEX_GLSL: VERTEX_GLSL,
    SNOW_DROP: SNOW_DROP,
    SNOW_RANGE: SNOW_RANGE,
    FREEZE_T: FREEZE_T,
    AUTUMN_MIX: AUTUMN_MIX,
    SUMMER: SUMMER
  };
})(window.SM = window.SM || {});
