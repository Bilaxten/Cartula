/* WebGL2 voxel terrain renderer. Mesh construction stays data-only so the
 * generation pipeline can verify it under Node without a browser or GL. */
(function (SM) {
  'use strict';

  // A neutral rim makes the generated island read as a finished diorama.
  var BORD = [70, 80, 92];

  /* How far an animated water surface sinks below its rest level, in voxel
   * levels (before uVScale). The wave only ever DIPS: its crest is the rest
   * level every other face is built against. Every wall that meets a water
   * surface reaches this far below it (a skirt), so the surface can never
   * drop out from under a neighbour and open a see-through slit -- the slit
   * showed the clear colour as a black sliver at cliff bases (2026-10-05).
   * The vertex shader and the --mesh harness read this same number.
   * 0.072 until 2026-10-05, when the owner found the waves hard to read. */
  var WAVE_DIP = 0.15;
  // Brightness swing of a water tile between trough and crest (+-). Each
  // tile takes ONE value, from the wave at its centre, so the swell reads as
  // calm stepped bands of whole tiles rolling across the water.
  var WAVE_SHADE = 0.07;
  // Shore foam: corner-value threshold at the wave trough and at the crest
  // (lower = reaches further from the shore), and how opaque it is.
  var FOAM_REACH = [0.75, 0.5];
  var FOAM_OPACITY = 0.8;

  // Mean of the window pattern (makeProgram windowLight): 45% of windows lit
  // x pane area 0.56 x 0.5 x mean intensity 0.875.
  var WINDOW_MEAN = 0.45 * 0.56 * 0.5 * 0.875;
  // Bloom: how bright a settlement face is in the glow source (a flat level,
  // not the window pattern, so the 1/4-res source cannot sparkle), and the
  // strength of the additive composite at full night. Tuned by eye in
  // headless Edge at 22:00, seed 1337 (2026-10-05).
  var BLOOM_SOURCE = 0.55;
  var BLOOM_STRENGTH = 1.6;

  /* Warm window light, from the biome palette rather than a new colour:
   * desert sand warmed a quarter toward lava, pushed above 1 so it survives
   * the night wash (index.html #daynight multiplies the canvas). */
  function windowLightColor() {
    var desert = hexToRgb(SM.BIOME_LIST.find(function (b) { return b.id === 'desert'; }).color);
    var lava = hexToRgb(SM.BIOME_LIST.find(function (b) { return b.id === 'lava'; }).color);
    return [0, 1, 2].map(function (k) {
      return (desert[k] * 0.75 + lava[k] * 0.25) / 255 * 1.3;
    });
  }

  function wrapYaw(yaw) {
    // A compact 0..359 range keeps camera state and shared links canonical.
    return ((+yaw % 360) + 360) % 360;
  }

  function clampPitch(pitch) {
    // Near-horizontal views are unstable, while 90 degrees loses the horizon.
    return Math.max(10, Math.min(89, +pitch));
  }

  function snapYaw(yaw) {
    var angle = wrapYaw(yaw);

    /* Nearest cardinal stop. 360 is the same pose as zero, so the last half
     * sector (315..360) wraps to 0. It used to be clamped to 270 instead,
     * which made Q/E lopsided there: from 316 degrees E turned 44 and Q turned
     * 136, while the mirror pose at 44 degrees turned 136 and 44. */
    return wrapYaw(Math.round(angle / 90) * 90);
  }

  function panVector(yaw, pitch, zoom, screenWidth, deltaX, deltaY) {
    var yawRad = wrapYaw(yaw) * Math.PI / 180;
    var pitchRad = clampPitch(pitch) * Math.PI / 180;
    var worldPerPixel = 2 * Math.max(0.01, +zoom) /
      Math.max(1, +screenWidth);
    var rightX = Math.sin(yawRad);
    var rightZ = -Math.cos(yawRad);
    // The ground plane is foreshortened by sin(pitch) on screen, so a vertical
    // drag of one pixel is 1 / sin(pitch) world units along the ground. This
    // used to MULTIPLY by sin(pitch): the terrain then moved sin²(pitch) of
    // the cursor (45% at pitch 42). Pitch is clamped to 10..89, so the
    // divisor never drops below 0.17.
    var downX = Math.cos(yawRad) / Math.sin(pitchRad);
    var downZ = Math.sin(yawRad) / Math.sin(pitchRad);

    /* Moving the target opposite the drag makes the terrain follow the cursor.
     * Vertical screen motion is un-projected from the camera plane to the ground. */
    return {
      x: -(deltaX * rightX + deltaY * downX) * worldPerPixel,
      z: -(deltaX * rightZ + deltaY * downZ) * worldPerPixel
    };
  }

  /* Terrain-following waves (Uğur 2026-10-05: "terraine uyumlu şekilde
   * dalgalanıp sönümlenecek"). Until then every wave ran in one direction
   * across the whole map. Now, per map:
   *   - d   = distance from each water cell to the nearest land cell
   *           (two-pass chamfer, weights 1 and sqrt 2),
   *   - phase = WAVE_K * d + a little seeded noise, so sin(wt + phase) puts
   *           crests on rings that run in toward every coast and around
   *           every island,
   *   - amp = 0 where the water touches land (the swell settles instead of
   *           slamming), full in a band just off the shore, decaying to a
   *           calm floor out at sea.
   * Values live at GRID CORNERS: every vertex at a corner -- the four water
   * tops that share it, a water tile's wall rim -- reads the same number,
   * so shared edges keep moving together (no slits, --mesh). The value at a
   * tile's centre drives the per-tile crest shading and the shore foam, so
   * both stay in step with the swell. */
  var WAVE_K = 0.9;          // radians per tile of distance (~7-tile wavelength)
  var WAVE_NOISE = 1.3;      // radians of seeded phase noise
  var WAVE_FLOOR = 0.12;     // open-sea amplitude, as a share of the full swell

  function smoothstep01(e0, e1, x) {
    var t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }

  function waveAmplitude(d) {
    return smoothstep01(0, 0.9, d) *
      (WAVE_FLOOR + (1 - WAVE_FLOOR) * (1 - smoothstep01(2.5, 14, d)));
  }

  function waveField(grid) {
    var W = grid.width;
    var H = grid.height;
    var n = W * H;
    var dist = new Float32Array(n);
    var CW = W + 1;
    var cornerDist = new Float32Array(CW * (H + 1));
    var cornerPhase = new Float32Array(CW * (H + 1));
    var cornerAmp = new Float32Array(CW * (H + 1));
    var tilePhase = new Float32Array(n);
    var tileAmp = new Float32Array(n);
    var seed = grid.config && grid.config.seed != null ? grid.config.seed | 0 : 0;
    var noise = SM.makeNoise2D ? SM.makeNoise2D((seed ^ 0xa7e) >>> 0) : function () { return 0; };
    var BIG = 1e9;
    var D = Math.SQRT2;
    var x;
    var y;
    var i;

    for (i = 0; i < n; i++) dist[i] = grid.water[i] ? BIG : 0;
    function relax(x0, y0, dx, dy, w) {
      var xx = x0 + dx;
      var yy = y0 + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) return;
      var c = dist[yy * W + xx] + w;
      if (c < dist[y0 * W + x0]) dist[y0 * W + x0] = c;
    }
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        relax(x, y, -1, 0, 1);
        relax(x, y, 0, -1, 1);
        relax(x, y, -1, -1, D);
        relax(x, y, 1, -1, D);
      }
    }
    for (y = H - 1; y >= 0; y--) {
      for (x = W - 1; x >= 0; x--) {
        relax(x, y, 1, 0, 1);
        relax(x, y, 0, 1, 1);
        relax(x, y, 1, 1, D);
        relax(x, y, -1, 1, D);
      }
    }
    // A map with no land at all: everything is open sea.
    for (i = 0; i < n; i++) if (dist[i] >= BIG) dist[i] = 64;

    for (y = 0; y <= H; y++) {
      for (x = 0; x <= W; x++) {
        var sum = 0;
        var cnt = 0;
        var land = false;
        for (var k = 0; k < 4; k++) {
          var cx = x - 1 + (k & 1);
          var cy = y - 1 + (k >> 1);
          if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
          if (!grid.water[cy * W + cx]) land = true;
          sum += dist[cy * W + cx];
          cnt++;
        }
        var d = land ? 0 : Math.max(0, sum / Math.max(1, cnt) - 0.5);
        var c = y * CW + x;
        cornerDist[c] = d;
        cornerPhase[c] = WAVE_K * d + WAVE_NOISE * noise(x * 0.09, y * 0.09);
        cornerAmp[c] = waveAmplitude(d);
      }
    }
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        i = y * W + x;
        var td = grid.water[i] ? Math.max(0, dist[i] - 0.5) : 0;
        tilePhase[i] = WAVE_K * td + WAVE_NOISE * noise((x + 0.5) * 0.09, (y + 0.5) * 0.09);
        tileAmp[i] = grid.water[i] ? waveAmplitude(td + 0.5) : 0;
      }
    }
    return {
      width: W,
      height: H,
      dist: dist,
      cornerDist: cornerDist,
      cornerPhase: cornerPhase,
      cornerAmp: cornerAmp,
      tilePhase: tilePhase,
      tileAmp: tileAmp
    };
  }

  // Phase in radians -> one byte (2 pi wraps to 0); amplitude 0..1 -> byte.
  function phaseByte(ph) {
    var t = ph / (Math.PI * 2);
    return Math.round((t - Math.floor(t)) * 256) & 255;
  }

  function hexToRgb(hex) {
    // CSS palette strings are converted before entering the GPU's float range.
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function shouldFlipVoxelQuad(a00, a01, a11, a10) {
    /* AO is non-linear across a quad. Select the diagonal with the smaller
     * opposing contrast so its two triangle interpolants meet without a seam. */
    return a00 + a11 > a01 + a10;
  }

  function buildShadowMap(grid, sun) {
    // `sun.dx/dy` is the horizontal direction the light TRAVELS (grid x east,
    // y south). The renderer's `setSun` lights faces from (-dx, -dy) and the
    // cloud shadow slides along (+dx, +dy), so the occluder of a shaded cell
    // lies UP-light, at s - (dx, dy) * step. Until 2026-10-05 this marched
    // s + (dx, dy) * step (a port of the deleted canvas iso pre-pass, which
    // read the vector the other way), so cast shadows fell on the SAME side
    // as the lit walls and opposite to the cloud shadows.
    var W = grid.width;
    var H = grid.height;
    var level = grid.level;
    var waterDepth = (grid.config && grid.config.waterDepth) || 3;
    var floorLevel = -waterDepth - 1;
    var s = sun || {};
    var SUN_DX = +s.dx || 0;
    var SUN_DY = +s.dy || 0;
    var SUN_RISE = Math.max(0.12, +s.rise || 0);
    var SUN_STEPS = 12;
    var shadow = new Uint8Array(W * H);

    function levelAt(x, y) {
      if (x < 0 || y < 0 || x >= W || y >= H) return floorLevel;
      return level[y * W + x];
    }

    for (var sy = 0; sy < H; sy++) {
      for (var sx = 0; sx < W; sx++) {
        var si = sy * W + sx;
        var base;
        var sh = 0;

        if (level[si] <= floorLevel) continue;
        base = level[si];
        for (var st = 1; st <= SUN_STEPS; st++) {
          var ol = levelAt(
            Math.round(sx - SUN_DX * st),
            Math.round(sy - SUN_DY * st)
          );
          var over = ol - (base + SUN_RISE * st);

          if (over > 0) {
            var contrib = Math.min(1, over / 2.2) *
              (1 - (st - 1) / SUN_STEPS);
            if (contrib > sh) sh = contrib;
          }
        }
        shadow[si] = Math.round(sh * 255);
      }
    }
    return shadow;
  }

  /* Build independent quad vertices. Keeping faces independent permits a
   * material, normal, and depth discontinuity on every voxel edge. */
  function buildVoxelMesh(grid) {
    // This function deliberately receives no GL object: headless checks can
    // compare its deterministic typed arrays without browser state.
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
    var cellUV = [];
    var emissive = [];
    var water = [];
    var shore = [];
    var ao = [];
    var fall = [];
    // 1 on every vertex of a settlement cell's faces (top and walls): the
    // only geometry that may carry night window lights (--mesh checks it).
    var town = [];
    var cellTown = 0;
    // Shore foam (per vertex, 0/1): on top faces of sea and lake tiles, 1 at
    // a corner that touches a land tile. Corners are shared by neighbouring
    // water tiles, so the interpolated value runs on across tile seams and
    // the foam line stays continuous. Rivers get none (a one-tile river
    // touches land at every corner and would turn white bank to bank).
    var foam = [];
    var quadFoam = null;            // set by addTop for one quad, else null
    // Wave bytes per vertex: corner phase, corner amplitude, tile phase,
    // tile amplitude (see waveField). Zero on anything that does not ride
    // the water surface.
    var waves = waveField(grid);
    var wave = [];
    var NO_FOAM = [0, 0, 0, 0];
    var LAKE = SM.BIOME_LIST.findIndex(function (b) { return b.id === 'lake'; });
    var TOWN = SM.BIOME_LIST.findIndex(function (b) { return b.id === 'town'; });
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
    var lava = grid.lava || [];
    // Owner-designed feature (see module header): SM.tagWaterfalls (grid.js,
    // a separate lane) marks grid.waterfalls[i] 1 on the LIP (the fresh-water
    // tile the water falls FROM) and 2 on the LANDING tile it falls INTO.
    // Absent on older grids -- must not crash (module header contract).
    var waterfalls = grid.waterfalls;
    // After bed grading, every river water-water edge is <=1 or >=MIN_DROP;
    // the one remaining 2-step (a lake sill sitting above a river) is left
    // untagged on purpose and must draw as an ordinary cliff, not a fall.
    // Read from the shared constant when the other lane's grid.js is present
    // so the two stay in lockstep; default 3 keeps this file correct alone.
    var WATERFALL_MIN_DROP = SM.WATERFALL_MIN_DROP || 3;
    // 0.9 sits well above any shoreline-derived shore weight (max ~0.55, see
    // terrainColor) so a plunge pool always reads as the strongest foam on
    // the map rather than blending with ordinary shoreline foam.
    var FALL_FOAM_SHORE = 0.9;

    function isFallFace(i, x, y, L, dx, dy, NL) {
      // Direction is derived from GEOMETRY, not grid.flow: flow is empty on
      // ~75% of river tiles (see module header), but "this LIP tile sits
      // MIN_DROP+ levels above that orthogonal water tile" is always
      // computable straight from level + the LIP tag.
      var nx = x + dx;
      var ny = y + dy;
      var ni;

      if (!waterfalls || waterfalls[i] !== 1 || !grid.water[i]) return false;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) return false;
      ni = ny * W + nx;
      if (!grid.water[ni]) return false;
      return (L - NL) >= WATERFALL_MIN_DROP;
    }

    function addVertex(
      x, y, z, nx, ny, nz, c, d, cellX, cellY, glow, waterTop, shoreWeight,
      vertexAo, fallFlag
    ) {
      // Positions preserve the raw integer level. uVScale later exaggerates Y
      // without invalidating the mesh topology.
      pos.push(x, y, z);
      norm.push(nx, ny, nz);
      color.push(Math.max(0, Math.min(1, c[0] / 255)));
      color.push(Math.max(0, Math.min(1, c[1] / 255)));
      color.push(Math.max(0, Math.min(1, c[2] / 255)));
      // Depth is a shader-only tonal cue, not geometry or baked lighting.
      depth.push(d);
      cellUV.push((Math.max(0, Math.min(W - 1, cellX)) + 0.5) / W);
      cellUV.push((Math.max(0, Math.min(H - 1, cellY)) + 0.5) / H);
      // A scalar keeps lava emission independent from daylight in the shader.
      emissive.push(glow);
      // 1 = this vertex rides the water surface: every vertex of a water top
      // face, and the UPPER edge of a water tile's own walls so the wall's
      // rim follows the surface instead of poking above it.
      water.push(waterTop);
      shore.push(shoreWeight);
      // AO remains a discrete 0..3 visibility count until fragment lighting.
      ao.push(vertexAo);
      // 0/1: a falling-water face swaps its cliff material for an animated
      // cascade in the fragment shader (see makeProgram's vFall handling).
      fall.push(fallFlag ? 1 : 0);
      town.push(cellTown);
      if (waterTop) {
        // The vertex's grid corner (positions are integers there) and tile.
        var wc = Math.round(z + H / 2) * (W + 1) + Math.round(x + W / 2);
        var wt = Math.max(0, Math.min(H - 1, cellY)) * W + Math.max(0, Math.min(W - 1, cellX));
        wave.push(phaseByte(waves.cornerPhase[wc]), Math.round(waves.cornerAmp[wc] * 255),
          phaseByte(waves.tilePhase[wt]), Math.round(waves.tileAmp[wt] * 255));
      } else {
        wave.push(0, 0, 0, 0);
      }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    /* Each quad is CCW from its outward-facing side. CULL_FACE can therefore
     * discard its back face without exposing the terrain interior. */
    function addQuad(
      vertices,
      normal,
      faceColor,
      sideDepth,
      cellX,
      cellY,
      glow,
      waterTop,
      shoreWeight,
      vertexAo,
      fallFlag
    ) {
      var base = pos.length / 3;
      var f = quadFoam || NO_FOAM;

      foam.push(f[0], f[1], f[2], f[3]);
      // Duplicating the four vertices lets adjacent faces retain hard normals.
      // waterTop is per vertex (a wall rides the surface only at its rim).
      addVertex(
        vertices[0], vertices[1], vertices[2],
        normal[0], normal[1], normal[2], faceColor, sideDepth[0],
        cellX, cellY, glow, waterTop[0], shoreWeight, vertexAo[0], fallFlag
      );
      addVertex(
        vertices[3], vertices[4], vertices[5],
        normal[0], normal[1], normal[2], faceColor, sideDepth[1],
        cellX, cellY, glow, waterTop[1], shoreWeight, vertexAo[1], fallFlag
      );
      addVertex(
        vertices[6], vertices[7], vertices[8],
        normal[0], normal[1], normal[2], faceColor, sideDepth[2],
        cellX, cellY, glow, waterTop[2], shoreWeight, vertexAo[2], fallFlag
      );
      addVertex(
        vertices[9], vertices[10], vertices[11],
        normal[0], normal[1], normal[2], faceColor, sideDepth[3],
        cellX, cellY, glow, waterTop[3], shoreWeight, vertexAo[3], fallFlag
      );
      if (shouldFlipVoxelQuad(vertexAo[0], vertexAo[1], vertexAo[2], vertexAo[3])) {
        indices.push(base, base + 1, base + 3);
        indices.push(base + 1, base + 2, base + 3);
      } else {
        indices.push(base, base + 1, base + 2);
        indices.push(base, base + 2, base + 3);
      }
    }

    function levelAt(x, y) {
      // The terrain's outside is its floor, exposing an honest outer shell.
      if (x < 0 || y < 0 || x >= W || y >= H) return floorLevel;
      return level[y * W + x];
    }

    function solidAt(x, y, L) {
      // AO treats out-of-bounds columns as air, not as the display plinth.
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      return level[y * W + x] > L;
    }

    function vertexAO(side1, side2, corner) {
      // Two closed edges bury their shared corner regardless of the diagonal.
      if (side1 && side2) return 0;
      return 3 - Number(side1) - Number(side2) - Number(corner);
    }

    function topAO(x, y, L) {
      /* Vertices are NW, SW, SE, NE. Each checks the two edge columns and
       * the diagonal column that meet at the same top-face corner. */
      return [
        vertexAO(solidAt(x - 1, y, L), solidAt(x, y - 1, L),
          solidAt(x - 1, y - 1, L)),
        vertexAO(solidAt(x - 1, y, L), solidAt(x, y + 1, L),
          solidAt(x - 1, y + 1, L)),
        vertexAO(solidAt(x + 1, y, L), solidAt(x, y + 1, L),
          solidAt(x + 1, y + 1, L)),
        vertexAO(solidAt(x + 1, y, L), solidAt(x, y - 1, L),
          solidAt(x + 1, y - 1, L))
      ];
    }

    function sideVertexAO(x, y, L, outX, outY, tangentX, tangentY) {
      /* A heightmap collapses a wall's voxel stack into one quad. At its upper
       * seam, the outward, tangent, and outer-diagonal columns are the useful
       * analogue of voxel neighbours; lower wall vertices remain open. */
      return vertexAO(
        solidAt(x + outX, y + outY, L),
        solidAt(x + tangentX, y + tangentY, L),
        solidAt(x + outX + tangentX, y + outY + tangentY, L)
      );
    }

    function sideAO(x, y, L, dir) {
      var open = 3;

      // The array follows each branch's CCW vertex order: upper, lower, lower, upper.
      if (dir === 0) {
        return [
          sideVertexAO(x, y, L, -1, 0, 0, -1), open, open,
          sideVertexAO(x, y, L, -1, 0, 0, 1)
        ];
      }
      if (dir === 1) {
        return [
          sideVertexAO(x, y, L, 1, 0, 0, 1), open, open,
          sideVertexAO(x, y, L, 1, 0, 0, -1)
        ];
      }
      if (dir === 2) {
        return [
          sideVertexAO(x, y, L, 0, -1, 1, 0), open, open,
          sideVertexAO(x, y, L, 0, -1, -1, 0)
        ];
      }
      return [
        sideVertexAO(x, y, L, 0, 1, -1, 0), open, open,
        sideVertexAO(x, y, L, 0, 1, 1, 0)
      ];
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
      var wt = 0;
      var sv;
      var topF;

      // Sea depth is COLOUR now (flat surface at level 0), from the shared
      // definition in biome.js -- same tones as the top-down bake.
      if (SM.isSea(grid, i)) {
        topC = SM.seaColor(grid, i);
        c = topC;
        wt = SM.seaShoreWeight(grid, i);
      }

      sv = SM.biomeShade(grid, i);
      topF = grid.water[i] ? 1 : (0.90 + 0.15 * (L / maxLevel));
      return {
        top: [
          topC[0] * topF * sv,
          topC[1] * topF * sv,
          topC[2] * topF * sv
        ],
        side: [c[0] * sv, c[1] * sv, c[2] * sv],
        shore: wt
      };
    }

    function landAt(x, y) {
      return x >= 0 && y >= 0 && x < W && y < H && !grid.water[y * W + x];
    }

    // A grid corner (cx, cy) touches land when any of its four tiles is land.
    function cornerFoam(cx, cy) {
      return landAt(cx - 1, cy - 1) || landAt(cx, cy - 1) ||
        landAt(cx - 1, cy) || landAt(cx, cy) ? 1 : 0;
    }

    function addTop(x, y, L, c, glow, waterTop, shoreWeight) {
      var x0 = x - W / 2;
      var i = y * W + x;

      // Same corner order as the quad below: NW, SW, SE, NE.
      quadFoam = waterTop && x >= 0 && y >= 0 && x < W && y < H &&
        (SM.isSea(grid, i) || grid.biome[i] === LAKE) ? [
          cornerFoam(x, y), cornerFoam(x, y + 1),
          cornerFoam(x + 1, y + 1), cornerFoam(x + 1, y)
        ] : null;
      var x1 = x0 + 1;
      var z0 = y - H / 2;
      var z1 = z0 + 1;

      // The vertex order looks down on the face from outside, hence CCW.
      addQuad(
        [x0, L, z0, x0, L, z1, x1, L, z1, x1, L, z0],
        [0, 1, 0],
        c,
        [0, 0, 0, 0],
        x,
        y,
        glow,
        [waterTop, waterTop, waterTop, waterTop],
        shoreWeight,
        topAO(x, y, L)
      );
      quadFoam = null;
    }

    /* `surface` 1: this is a water tile's own wall, so its upper edge rides
     * the animated surface (vertex order is upper, lower, lower, upper in
     * every branch). `NL` is already the wall's bottom, skirt included. */
    function addSide(x, y, L, NL, dir, c, glow, fall, surface) {
      var x0 = x - W / 2;
      var x1 = x0 + 1;
      var z0 = y - H / 2;
      var z1 = z0 + 1;
      // The gradient follows the visible drop instead of the absolute altitude.
      var d = L - NL;
      var vertexAo = sideAO(x, y, L, dir);
      var rim = surface ? 1 : 0;
      var ride = [rim, 0, 0, rim];

      // Each branch preserves the outward normal and matching CCW winding.
      if (dir === 0) {
        addQuad(
          [x0, L, z0, x0, NL, z0, x0, NL, z1, x0, L, z1],
          [-1, 0, 0],
          c,
          [0, d, d, 0],
          x,
          y,
          glow,
          ride,
          0,
          vertexAo,
          fall
        );
      } else if (dir === 1) {
        addQuad(
          [x1, L, z1, x1, NL, z1, x1, NL, z0, x1, L, z0],
          [1, 0, 0],
          c,
          [0, d, d, 0],
          x,
          y,
          glow,
          ride,
          0,
          vertexAo,
          fall
        );
      } else if (dir === 2) {
        addQuad(
          [x1, L, z0, x1, NL, z0, x0, NL, z0, x0, L, z0],
          [0, 0, -1],
          c,
          [0, d, d, 0],
          x,
          y,
          glow,
          ride,
          0,
          vertexAo,
          fall
        );
      } else {
        addQuad(
          [x0, L, z1, x0, NL, z1, x1, NL, z1, x1, L, z1],
          [0, 0, 1],
          c,
          [0, d, d, 0],
          x,
          y,
          glow,
          ride,
          0,
          vertexAo,
          fall
        );
      }
    }

    function wetAt(x, y) {
      return x >= 0 && y >= 0 && x < W && y < H && !!grid.water[y * W + x];
    }

    /* One wall of cell i toward its neighbour (dx, dy). It reaches down to the
     * neighbour's top, because every exposed step between two columns needs a
     * face; when NL >= L the neighbour hides the whole side and no quad exists.
     * When the neighbour's top is a water SURFACE the wall reaches WAVE_DIP
     * further (a skirt), so the dipping wave still meets a face of this column
     * and never opens a slit into its hollow interior. A land column exactly
     * level with the water therefore gets a skirt alone. Water beside water at
     * one level needs none: both surfaces follow the same continuous wave. */
    function addWall(i, x, y, L, dx, dy, dir, material, glow, surface) {
      var NL = levelAt(x + dx, y + dy);
      var wet = wetAt(x + dx, y + dy);
      var fallFace;

      if (!(NL < L || (wet && !surface && NL === L))) return;
      // A falling-water face is drawn in the water's OWN colour (material.top,
      // the same tone its top surface uses), not the cliff's material.side --
      // requirement is "rendered as WATER, not terrain".
      fallFace = isFallFace(i, x, y, L, dx, dy, NL);
      addSide(x, y, L, wet ? NL - WAVE_DIP : NL, dir,
        fallFace ? material.top : material.side, glow, fallFace, surface);
    }

    function addRingSkirt(x, y, L, dx, dy, dir) {
      // The plinth meets an edge water tile flush, so the dipping surface needs
      // the ring's inner wall below it too.
      var nx = x + dx;
      var ny = y + dy;

      if (!wetAt(nx, ny) || level[ny * W + nx] > L) return;
      addSide(x, y, L, level[ny * W + nx] - WAVE_DIP, dir, BORD, 0);
    }

    /* A cell's top is always visible; addWall decides each of its four walls. */
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var i = y * W + x;
        var L = level[i];
        var material = terrainColor(x, y, i, L);
        var surface = grid.water[i] ? 1 : 0;
        var glow = lava[i] ? 1 : 0;

        cellTown = grid.biome[i] === TOWN && !grid.water[i] ? 1 : 0;
        // A plunge pool churns even though its own biome/neighbours give it
        // no shoreline weight of its own (terrainColor only computes shore
        // tint for the shallow_water biome). LANDING (tag 2) is set by the
        // generator on the tile a fall drops INTO, independent of geometry.
        if (waterfalls && waterfalls[i] === 2) {
          material.shore = Math.max(material.shore, FALL_FOAM_SHORE);
        }

        // Top and sides share one material decision so biome seams stay sharp.
        addTop(x, y, L, material.top, glow, surface, material.shore);
        addWall(i, x, y, L, -1, 0, 0, material, glow, surface);
        addWall(i, x, y, L, 1, 0, 1, material, glow, surface);
        addWall(i, x, y, L, 0, -1, 2, material, glow, surface);
        addWall(i, x, y, L, 0, 1, 3, material, glow, surface);
      }
    }
    cellTown = 0;

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
        addTop(x, y, L, BORD, 0, 0, 0);
        edgeWest = x === -1;
        edgeEast = x === W;
        edgeNorth = y === -1;
        edgeSouth = y === H;
        if (edgeWest) addSide(x, y, L, floorLevel, 0, BORD, 0);
        if (edgeEast) addSide(x, y, L, floorLevel, 1, BORD, 0);
        if (edgeNorth) addSide(x, y, L, floorLevel, 2, BORD, 0);
        if (edgeSouth) addSide(x, y, L, floorLevel, 3, BORD, 0);
        if (!edgeWest && borderTop(x - 1, y) < L) {
          addSide(x, y, L, borderTop(x - 1, y), 0, BORD, 0);
        }
        if (!edgeEast && borderTop(x + 1, y) < L) {
          addSide(x, y, L, borderTop(x + 1, y), 1, BORD, 0);
        }
        if (!edgeNorth && borderTop(x, y - 1) < L) {
          addSide(x, y, L, borderTop(x, y - 1), 2, BORD, 0);
        }
        if (!edgeSouth && borderTop(x, y + 1) < L) {
          addSide(x, y, L, borderTop(x, y + 1), 3, BORD, 0);
        }
        if (edgeWest) addRingSkirt(x, y, L, 1, 0, 1);
        if (edgeEast) addRingSkirt(x, y, L, -1, 0, 0);
        if (edgeNorth) addRingSkirt(x, y, L, 0, 1, 3);
        if (edgeSouth) addRingSkirt(x, y, L, 0, -1, 2);
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
      [0, 0, 0, 0],
      0,
      0,
      0,
      [0, 0, 0, 0],
      0,
      [3, 3, 3, 3]
    );
    return {
      positions: new Float32Array(pos),
      normals: new Float32Array(norm),
      colors: new Float32Array(color),
      sideDepth: new Float32Array(depth),
      cellUV: new Float32Array(cellUV),
      emissive: new Float32Array(emissive),
      water: new Uint8Array(water),
      shore: new Float32Array(shore),
      ao: new Uint8Array(ao),
      fall: new Uint8Array(fall),
      town: new Uint8Array(town),
      foam: new Uint8Array(foam),
      wave: new Uint8Array(wave),
      indices: new Uint32Array(indices),
      // The vertex shader turns aCellUV back into a tile centre with this.
      gridSize: [W, H],
      // The map's seed: the sky (SM.Sky.cloudInstances) is derived from it.
      seed: grid.config && grid.config.seed != null ? grid.config.seed | 0 : null,
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

  /* Same triangles, settlement ones last (a triangle is a settlement one when
   * its first vertex carries the flag: every vertex of a face shares it).
   * Order within each group is kept; with depth testing and no coplanar
   * overlaps in the terrain, the picture is unchanged. */
  function settlementLast(indices, town) {
    var n = indices.length;
    var out;
    var head = 0;
    var tail;
    var t;

    if (!town) return { indices: indices, townStart: n };
    out = new Uint32Array(n);
    for (t = 0; t < n; t += 3) {
      if (!town[indices[t]]) {
        out[head++] = indices[t];
        out[head++] = indices[t + 1];
        out[head++] = indices[t + 2];
      }
    }
    tail = head;
    for (t = 0; t < n; t += 3) {
      if (town[indices[t]]) {
        out[tail++] = indices[t];
        out[tail++] = indices[t + 1];
        out[tail++] = indices[t + 2];
      }
    }
    return { indices: out, townStart: head };
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

  // General 4x4 inverse (column-major, same layout as mat4Multiply).
  function mat4Invert(out, m) {
    var a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
    var a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    var a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
    var a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    var b00 = a00 * a11 - a01 * a10;
    var b01 = a00 * a12 - a02 * a10;
    var b02 = a00 * a13 - a03 * a10;
    var b03 = a01 * a12 - a02 * a11;
    var b04 = a01 * a13 - a03 * a11;
    var b05 = a02 * a13 - a03 * a12;
    var b06 = a20 * a31 - a21 * a30;
    var b07 = a20 * a32 - a22 * a30;
    var b08 = a20 * a33 - a23 * a30;
    var b09 = a21 * a32 - a22 * a31;
    var b10 = a21 * a33 - a23 * a31;
    var b11 = a22 * a33 - a23 * a32;
    var det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;

    if (!det) return null;
    det = 1 / det;
    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
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

    // Return null on failure so the optional voxel route can fail closed --
    // but NEVER silently. A GLSL error that only removes a layer looks like
    // "the feature was not implemented" from the outside; the log is the
    // difference between a five-minute fix and an afternoon (AGENTS.md: a
    // swallowed failure must still be visible).
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      // Recorded on `window` as well as logged: a compile error that happens
      // during page load is gone by the time a console reader attaches, and
      // then the only symptom is a layer that never appears.
      window.__glShaderErrors = window.__glShaderErrors || [];
      window.__glShaderErrors.push(gl.getShaderInfoLog(shader));
      console.warn('voxel3d: shader compile failed\n' + gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function glslFloat(value) {
    // A JS number spliced into GLSL must keep its decimal point (0 -> 0.0).
    var text = String(value);
    return text.indexOf('.') < 0 ? text + '.0' : text;
  }

  /* The day/night colour grade (main.js sunModel), in GLSL: CSS
   * brightness(), then saturate() with its sRGB luminance matrix, each
   * clamped like the CSS filter, then the multiply wash. Identity by default.
   * Spliced into every program that draws the world, so the voxel view looks
   * as it did under the CSS filter -- and light sources can be added AFTER
   * it. Fragment-only uniforms (no cross-stage precision pair). */
  var GRADE_GLSL = [
    'uniform vec3 uGradeTint;',
    'uniform vec2 uGradeBS;',
    'uniform float uGradeOn;',
    'vec3 grade(vec3 c) {',
    '  if (uGradeOn < 0.5) return c;',   // uniform branch: by day, no cost
    '  float s = uGradeBS.y;',
    '  mat3 m = mat3(',
    '    0.213 + 0.787 * s, 0.213 - 0.213 * s, 0.213 - 0.213 * s,',
    '    0.715 - 0.715 * s, 0.715 + 0.285 * s, 0.715 - 0.715 * s,',
    '    0.072 - 0.072 * s, 0.072 - 0.072 * s, 0.072 + 0.928 * s);',
    '  c = clamp(c * uGradeBS.x, 0.0, 1.0);',
    '  return clamp(m * c, 0.0, 1.0) * uGradeTint;',
    '}'
  ].join('\n');

  // The same grade in JS, for the clear colour (and the headless check that
  // the two agree).
  function gradeColor(rgb, g) {
    var s = g.saturate;
    var b = g.brightness;
    var c = rgb.map(function (v) { return Math.max(0, Math.min(1, v * b)); });
    var out = [
      (0.213 + 0.787 * s) * c[0] + (0.715 - 0.715 * s) * c[1] + (0.072 - 0.072 * s) * c[2],
      (0.213 - 0.213 * s) * c[0] + (0.715 + 0.285 * s) * c[1] + (0.072 - 0.072 * s) * c[2],
      (0.213 - 0.213 * s) * c[0] + (0.715 - 0.715 * s) * c[1] + (0.072 + 0.928 * s) * c[2]
    ];
    return out.map(function (v, k) { return Math.max(0, Math.min(1, v)) * g.tint[k]; });
  }

  // Fixed attribute slots, bound before linking, so the three terrain
  // program variants share one VAO.
  var TERRAIN_ATTRIBS = ['aPosition', 'aNormal', 'aColor', 'aSideDepth', 'aCellUV',
    'aEmissive', 'aWater', 'aShore', 'aAO', 'aFall', 'aTown', 'aFoam', 'aWave'];

  /* `variant`: '' = day (exactly the lighting it always had), 'NIGHT' =
   * plus the in-shader colour grade, 'NIGHT WINDOWS' = that plus the
   * settlement window lights (drawn over settlement triangles only), 'GLOW' =
   * the bloom source (depth for everything, colour from settlement faces
   * only). Separate COMPILED variants rather than uniform branches: on
   * SwiftShader both sides of a branch are executed with lane masks, and the
   * never-taken night code cost ~18 ms per frame by day (measured
   * 2026-10-05). On a GPU it is also simply less code per fragment. */
  function terrainShaderSources(variant) {
    // Space-separated defines, e.g. 'NIGHT WINDOWS'.
    var define = (variant || '').split(' ').filter(Boolean).map(function (d) {
      return '#define ' + d + ' 1';
    }).join('\n');
    // Arrays preserve GLSL's own line structure without a template dependency.
    var vertexSource = [
      '#version 300 es',
      'in vec3 aPosition;',
      'in vec3 aNormal;',
      'in vec3 aColor;',
      'in float aSideDepth;',
      'in vec2 aCellUV;',
      'in float aEmissive;',
      'in float aWater;',
      'in float aShore;',
      'in float aAO;',
      'in float aFall;',
      'in float aTown;',
      'in float aFoam;',
      // Corner phase, corner amplitude, tile phase, tile amplitude (normalised
      // bytes, waveField in this file).
      'in vec4 aWave;',
      'uniform mat4 uViewProjection;',
      'uniform float uVScale;',
      'uniform highp float uTime;',
      'out vec3 vNormal;',
      'out vec3 vColor;',
      'out float vSideDepth;',
      'out vec2 vCellUV;',
      'out float vEmissive;',
      'out float vShore;',
      'out float vAO;',
      'out float vHeight;',
      'out float vFall;',
      'out float vFallCoord;',
      'out float vWaveShade;',
      '',
      'void main() {',
      '  vNormal = aNormal;',
      '  vColor = aColor;',
      '  vSideDepth = aSideDepth;',
      '  vCellUV = aCellUV;',
      '  vEmissive = aEmissive;',
      '  vShore = aShore;',
      '  // The settlement flag rides in the AO varying (+4): it is constant',
      '  // over a face, so the fragment decodes both exactly, and the day path',
      '  // interpolates no extra component (SwiftShader pays per component).',
      '  vAO = aAO + 4.0 * aTown;',
      '  vHeight = aPosition.y; // raw voxel level, before uVScale',
      '  vFall = aFall;',
      '  // Falling-water faces have no per-vertex horizontal attribute of their',
      '  // own; the wall already varies in exactly one of x/z (the other is the',
      '  // wall plane, held constant), so their sum is a free per-vertex coordinate',
      '  // along the face width, used only to offset the streak pattern below.',
      '  // vFallCoord carries TWO things, never on the same face: on a',
      '  // waterfall wall the face-width coordinate below, on a water top the',
      '  // shore-foam corner value (aFoam), interpolated across the tile. Sharing',
      '  // one varying keeps the shore foam free for every other fragment.',
      '  vFallCoord = aFall > 0.5 ? aPosition.x + aPosition.z : aFoam;',
      '  // Keep Y raw in the mesh so isoexag changes need no mesh rebuild.',
      '  // Axis-aligned faces keep their normals valid under this Y-only scale.',
      '  // The surface only DIPS, from its rest level (crest) down to',
      '  // WAVE_DIP (trough): every wall meeting water reaches that far below',
      '  // it (buildVoxelMesh skirts), so no trough opens a slit to the clear',
      '  // colour. Phase and amplitude come per GRID CORNER (aWave.xy), so',
      '  // every vertex at a corner moves identically and shared edges stay',
      '  // closed. Rings of crests run in toward the coast (phase grows with',
      '  // the distance to land) and die out at the water line (amplitude 0).',
      '  const float TAU = 6.2831853;',
      '  float wave = -' + glslFloat(WAVE_DIP) + ' * aWater * aWave.y *',
      '    (0.5 - 0.5 * sin(uTime * 1.40 + aWave.x * (255.0 / 256.0) * TAU));',
      '  // Per-tile shade: the swell at the TILE CENTRE (aWave.zw, the same',
      '  // for the four corners of a tile, so flat across it). Crest tiles',
      '  // lighten, trough tiles darken; top faces only. The shore foam',
      '  // reads the same value.',
      '  vWaveShade = aWater * step(0.5, aNormal.y) * aWave.w *',
      '    sin(uTime * 1.40 + aWave.z * (255.0 / 256.0) * TAU);',
      '  gl_Position = uViewProjection * vec4(',
      '    aPosition.x,',
      '    (aPosition.y + wave) * uVScale,',
      '    aPosition.z,',
      '    1.0',
      '  );',
      '}'
    ].join('\n');
    var fragmentSource = [
      '#version 300 es',
      define,
      'precision mediump float;',
      'in vec3 vNormal;',
      'in vec3 vColor;',
      'in float vSideDepth;',
      'in vec2 vCellUV;',
      'in float vEmissive;',
      'in float vShore;',
      'in float vAO;',
      'in float vHeight;',
      'in float vFall;',
      'in float vFallCoord;',
      'in float vWaveShade;',
      'uniform vec3 uSunDirection;',
      'uniform float uSunStrength;',
      'uniform highp float uTime;',
      'uniform sampler2D uShadowMap;',
      // Cloud shadow rides in cell-UV space because this shader has no world
      // position. One soft ellipse per cloud LOBE (u, v, radiusU, radiusV), the
      // same lobes the cloud voxels fill, so the shadow has the cloud's shape.
      // Fixed-size array: GLSL uniform arrays cannot be dynamic, and
      // `SM.Sky.MAX_SHADOW_LOBES` (6 clouds x 3 lobes) is the JS half of the
      // same contract.
      'uniform vec4 uCloudLobes[18];',
      'uniform float uCloudLobeFade[18];',  // the shadow fades with its cloud
      'uniform int uCloudLobeCount;',
      'uniform float uCloudShadow;',
      // Render debug view (0 = lit). Fragment-only on purpose: a uniform
      // declared in both stages must match precision exactly or the program
      // silently fails to link (uTime, uMode) -- one stage, no risk.
      'uniform float uDebugView;',
      // Shore foam colour (snow, from the biome palette).
      'uniform vec3 uFoamColor;',
      // Night window lights on settlement faces (flag decoded from vAO), 0 by
      // day. The window pattern needs the fragment's position inside its
      // tile; rather than interpolating it for every fragment of the map, it
      // is rebuilt from gl_FragCoord for settlement fragments only:
      // uInvLevelVP maps (ndc) back to (x, raw level, z), uGridHalf moves
      // that into cell space, uViewport/uPixelWorld give the pixel footprint.
      // All fragment-only (no cross-stage precision pair).
      '#if defined(NIGHT) || defined(GLOW)',
      'uniform vec3 uLightColor;',
      '#endif',
      '#ifdef NIGHT',
      'uniform float uNightLight;',
      'uniform highp mat4 uInvLevelVP;',
      'uniform highp vec2 uGridHalf;',
      'uniform highp vec2 uViewport;',
      'uniform float uPixelWorld;',
      'uniform vec3 uViewDir;',
      GRADE_GLSL,
      '#define GRADE(c) grade(c)',
      '#else',
      '#define GRADE(c) (c)',
      '#endif',
      'out vec4 outColor;',
      '',
      '#ifdef WINDOWS',
      // Average of windowLight() over a face: lit share x window area x mean
      // intensity. Used when a window is smaller than a pixel and by the
      // bloom source, so neither can sparkle.
      'const float WINDOW_MEAN = ' + glslFloat(WINDOW_MEAN) + ';',
      '',
      '// Stylized lit windows: a 3x3 grid per tile top, 3 per tile width and',
      '// 2 per level on walls; a hash per window and tile decides which are',
      '// lit. Blocky on purpose (voxel look); fades to its mean once a window',
      '// gets smaller than about a pixel.',
      '// Called for settlement fragments at night only.',
      'float windowLight(float top, vec3 n) {',
      '  highp vec4 ndc = vec4(gl_FragCoord.xy / uViewport * 2.0 - 1.0,',
      '    gl_FragCoord.z * 2.0 - 1.0, 1.0);',
      '  highp vec4 w = uInvLevelVP * ndc;',
      '  highp vec3 cell = w.xyz / w.w + vec3(uGridHalf.x, 0.0, uGridHalf.y);',
      '  // Tops: x/z inside the tile. Walls: the coordinate along the wall',
      '  // (the other one is the wall plane) and the level up the wall.',
      '  vec2 p = top > 0.5 ? fract(cell.xz) * 3.0 : vec2(',
      '    fract(abs(n.x) > 0.5 ? cell.z : cell.x) * 3.0, fract(cell.y) * 2.0);',
      '  // Window size in pixels from the orthographic pixel footprint,',
      '  // foreshortened by the angle between face and view (no derivative:',
      '  // this runs in non-uniform control flow).',
      '  float size = 3.0 * uPixelWorld / max(0.15, abs(dot(n, uViewDir)));',
      '  vec2 id = floor(p);',
      '  vec2 f = fract(p);',
      '  float h = fract(sin(dot(id + vCellUV * 157.0, vec2(12.9898, 78.233))) *',
      '    43758.5453);',
      '  float pane = step(0.22, f.x) * step(f.x, 0.78) * step(0.25, f.y) *',
      '    step(f.y, 0.75);',
      '  float win = step(h, 0.45) * pane * (0.75 + 0.25 * fract(h * 7.31));',
      '  return mix(win, WINDOW_MEAN, smoothstep(0.35, 0.9, size));',
      '}',
      '#endif',
      '',
      'void main() {',
      '  float town = step(3.5, vAO);',
      '  float aoCount = vAO - 4.0 * town;',
      '#ifdef GLOW',
      '  // Bloom source. Independent of the hour (the composite scales by',
      '  // it), so the blurred source can be reused while the camera stands',
      '  // still.',
      '  outColor = vec4(uLightColor * (town * ' + glslFloat(BLOOM_SOURCE) + '), 1.0);',
      '  return;',
      '#endif',
      '  vec3 light = normalize(uSunDirection);',
      '  float ndl = max(0.0, dot(normalize(vNormal), light));',
      '  // True Lambert plus daylight-scaled ambient keeps low sun directional.',
      '  float daylight = clamp(uSunStrength / 0.42, 0.0, 1.0);',
      '  float ambient = mix(0.38, 0.47, daylight);',
      '  float lambert = ambient + 0.61 * daylight * ndl;',
      '  float topFace = step(0.5, vNormal.y);',
      '  float shadow = texture(uShadowMap, vCellUV).r;',
      '  // AO reaches 0.60 at a buried corner: distinct form without black pits.',
      '  const float AO_STRENGTH = 0.40;',
      '  float aoFactor = mix(1.0 - AO_STRENGTH, 1.0, aoCount / 3.0);',
      '  // AO now carries local form, so 1.14 keeps cast shadows directional.',
      '  const float SHADOW_GAIN = 1.14;',
      '  // 0.70 gives side faces more shade while retaining readable Lambert form.',
      '  float shadowHit = mix(0.70, 1.0, topFace);',
      '  float shadowFactor = 1.0 - uSunStrength * SHADOW_GAIN * shadowHit * shadow;',
      '  float gradient = 1.0 - 0.28 * min(1.0, vSideDepth / 2.6);',
      '  // Cell UV offsets lava so an entire volcano never pulses in lockstep.',
      '  float lavaPhase = dot(vCellUV, vec2(113.0, 173.0));',
      '  float lavaPulse = 0.55 + 0.45 * sin(uTime * 2.40 + lavaPhase);',
      '  vec3 emission = vColor * vEmissive * (0.42 + 0.42 * lavaPulse);',
      '  // Foam is a narrow, moving shoreline highlight rather than new geometry.',
      '  float foamPhase = sin(uTime * 1.60 + vCellUV.x * 47.0 +',
      '    vCellUV.y * 31.0);',
      '  float foam = topFace * vShore * smoothstep(0.15, 0.78,',
      '    0.5 + 0.5 * foamPhase);',
      '  vec3 foamColor = vec3(0.22, 0.31, 0.33) * foam;',
      '  // Falling water: a >=3-level drop (SM.WATERFALL_MIN_DROP) is drawn',
      '  // as a moving cascade instead of the static cliff addSide() would',
      '  // otherwise emit. vSideDepth already interpolates 0 at the lip to the',
      '  // full drop height at the plunge, so it doubles as the fall\'s local',
      '  // flow coordinate with no extra per-vertex data; only vFallCoord (the',
      '  // face-width position) is new. Subtracting uTime slides the streaks',
      '  // DOWN the face as time advances.',
      '  // Streaks run in COLUMNS: each 1/5-tile column gets its own hashed',
      '  // phase. A phase that is linear in vFallCoord (first version) tilts',
      '  // every band into one diagonal and the face reads as zebra hatching,',
      '  // not falling water (seen in the browser, 2026-09-22).',
      '  float fallCol = floor(vFallCoord * 5.0);',
      '  float fallPhase = fract(sin(fallCol * 12.9898) * 43758.5453);',
      '  float fallFlow = fract(vSideDepth * 0.9 - uTime * 1.6 + fallPhase);',
      '  float fallStreak = smoothstep(0.0, 0.08, fallFlow) *',
      '    (1.0 - smoothstep(0.30, 0.60, fallFlow));',
      '  // White water: the face is lifted toward foam everywhere, streaks',
      '  // brighter still, so a fall reads apart from the dark pool it feeds.',
      '  vec3 fallColor = mix(vColor, vec3(0.80, 0.90, 0.94),',
      '    0.30 + 0.45 * fallStreak);',
      '  vec3 baseColor = mix(vColor, fallColor, vFall);',
      '  // Shore foam: where a water top touches land (vFallCoord = interpolated',
      '  // corner flag, 1 at the shore). Quantised into quarter steps so the',
      '  // line is blocky like the voxels; its reach follows the SAME per-tile',
      '  // wave value as the crest shading (vWaveShade, +1 at the crest), so',
      '  // foam runs further out as a crest arrives and draws back in the',
      '  // trough. The threshold moves slowly with the wave: no flicker.',
      '  float shoreFoam = topFace * (1.0 - vFall) * step(',
      '    mix(' + glslFloat(FOAM_REACH[0]) + ', ' + glslFloat(FOAM_REACH[1]) + ', 0.5 + 0.5 * vWaveShade),',
      '    floor(vFallCoord * 4.0 + 0.5) / 4.0);',
      '  baseColor = mix(baseColor, uFoamColor, ' + glslFloat(FOAM_OPACITY) + ' * shoreFoam);',
      '  // Cloud shadow: soft-edged ellipses (one per cloud lobe) sliding over',
      '  // the map; overlapping lobes of one cloud merge with max(). Side faces',
      '  // take less of it, the same split the sun shadow uses -- a wall in',
      '  // shade from a passing cloud should not read darker than the ground.',
      '  float cloudCover = 0.0;',
      '  for (int c = 0; c < 18; c++) {',
      '    if (c >= uCloudLobeCount) break;',
      '    vec2 delta = (vCellUV - uCloudLobes[c].xy) /',
      '      max(vec2(1e-4), uCloudLobes[c].zw);',
      '    cloudCover = max(cloudCover, uCloudLobeFade[c] *',
      '      (1.0 - smoothstep(0.45, 1.0, length(delta))));',
      '  }',
      '  // `daylight`, not raw uSunStrength: the raw value is ~0.34 at noon and',
      '  // multiplying by it left the shadow at ~12% -- present in the numbers,',
      '  // invisible on screen. Daylight is the same 0..1 factor the rest of',
      '  // the lighting uses, so the shadow still fades out at dusk.',
      '  float cloudFactor = 1.0 - uCloudShadow * cloudCover *',
      '    mix(0.55, 1.0, topFace) * daylight;',
      '  // Debug views isolate ONE term of the lighting above, so each can be',
      '  // judged on its own: 1 AO, 2 normals, 3 height, 4 albedo (unlit),',
      '  // 5 sun shadow, 6 waterfall faces over dimmed albedo.',
      '  if (uDebugView > 0.5) {',
      '    vec3 dbg;',
      '    if (uDebugView < 1.5) dbg = vec3(aoFactor);',
      '    else if (uDebugView < 2.5) dbg = normalize(vNormal) * 0.5 + 0.5;',
      '    else if (uDebugView < 3.5) dbg = vec3(clamp(vHeight / 12.0, 0.0, 1.0));',
      '    else if (uDebugView < 4.5) dbg = baseColor;',
      '    else if (uDebugView < 5.5) dbg = vec3(1.0 - SHADOW_GAIN * shadowHit * shadow * 0.8);',
      '    else dbg = mix(vColor * 0.35, vec3(1.0, 0.55, 0.15), vFall);',
      '    outColor = vec4(GRADE(dbg), 1.0);',
      '    return;',
      '  }',
      '  // Graded like the rest of the world; window lights are light sources,',
      '  // added after the grade so the night wash cannot grey them out.',
      '  vec3 color = GRADE(',
      '    baseColor * lambert * gradient * shadowFactor * aoFactor * cloudFactor *',
      '      (1.0 + ' + glslFloat(WAVE_SHADE) + ' * vWaveShade) +',
      '      emission + foamColor);',
      '#ifdef WINDOWS',
      '  // Settlement faces only (this variant only ever draws their',
      '  // triangles); light added after the grade.',
      '  if (uNightLight > 0.0 && town > 0.5) {',
      '    color += uLightColor * (town * uNightLight *',
      '      windowLight(topFace, normalize(vNormal)));',
      '  }',
      '#endif',
      '  outColor = vec4(color, 1.0);',
      '}'
    ].join('\n');
    return { vertex: vertexSource, fragment: fragmentSource };
  }

  function makeProgram(gl, variant) {
    var src = terrainShaderSources(variant);
    // Vertex scale and fragment lighting are uniforms, not baked attributes.
    var vertex = compileShader(gl, gl.VERTEX_SHADER, src.vertex);
    var fragment = compileShader(gl, gl.FRAGMENT_SHADER, src.fragment);
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
    TERRAIN_ATTRIBS.forEach(function (name, slot) {
      gl.bindAttribLocation(program, slot, name);
    });
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      window.__glShaderErrors = window.__glShaderErrors || [];
      window.__glShaderErrors.push('link ' + (variant || 'day') + ': ' +
        gl.getProgramInfoLog(program));
      console.warn('voxel3d: terrain program (' + (variant || 'day') + ') link failed\n' +
        gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }


  /* Sky program: clouds and birds share one shader.
   *
   * They are drawn together because they want the same thing — flat unlit
   * geometry above the terrain, depth-tested against it so a hill can occlude a
   * low bird. `uMode` picks the placement rule: clouds are moved by a JS-driven
   * uniform (the terrain shader needs the same numbers for the shadow), birds
   * derive their entire path in the shader from their index (nothing else in the
   * scene cares where a bird is). */
  function makeSkyProgram(gl) {
    var vertexSource = [
      '#version 300 es',
      'in vec3 aPosition;',
      'in vec3 aNormal;',
      'in float aCloudIndex;',
      'in float aWing;',
      'uniform mat4 uViewProjection;',
      'uniform highp float uTime;',
      'uniform vec3 uCloudPos[6];',
      // Per-cloud opacity (SM.Sky.cloudFade). Vertex-only, so no cross-stage
      // precision question; the fragment gets it through vFade.
      'uniform float uCloudFade[6];',
      // ⚠️ EXPLICIT PRECISION ON BOTH STAGES. `int` defaults to highp in the
      // vertex shader and mediump in the fragment shader, and a uniform of the
      // same name with different precision is a LINK ERROR -- silent, because
      // the program simply comes back null. This repo has already been bitten
      // once by exactly this (`uTime precision mismatch broke WebGL2 link on
      // Firefox`); leave the qualifier in.
      'uniform highp int uMode;',      // 0 = cloud, 1 = bird
      'uniform vec3 uFlockCenter;',
      'uniform vec2 uFlockSpan;',      // orbit radius, height above terrain
      'out vec3 vNormal;',
      'out float vShade;',
      'out float vFade;',
      '',
      'float birdHash(float i, float salt) {',
      '  return fract(sin(i * 12.9898 + salt * 78.233) * 43758.5453);',
      '}',
      '',
      'void main() {',
      '  vec3 world;',
      '  if (uMode == 0) {',
      '    world = aPosition + uCloudPos[int(aCloudIndex)];',
      '    vShade = 1.0;',
      '    vFade = uCloudFade[int(aCloudIndex)];',
      '    // A fully faded cloud is not drawn at all: without this it would',
      '    // still write depth in the prepass and hide birds behind nothing.',
      '    if (vFade < 0.004) {',
      '      vNormal = aNormal;',
      '      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);',
      '      return;',
      '    }',
      '  } else {',
      '    float id = aCloudIndex;',
      '    // Each bird keeps its own orbit radius, height and phase, so the',
      '    // flock spreads instead of flying as one rigid ring.',
      '    float radius = uFlockSpan.x * (0.55 + birdHash(id, 1.0) * 0.5);',
      '    float lift = uFlockSpan.y * (0.75 + birdHash(id, 2.0) * 0.7);',
      '    float speed = 0.16 + birdHash(id, 3.0) * 0.10;',
      '    float phase = birdHash(id, 4.0) * 6.2831853;',
      '    float angle = uTime * speed + phase;',
      '    // Flap first, in the local frame: wing tips rotate around the',
      '    // body axis, body vertices (aWing == 0) stay put.',
      '    float flap = sin(uTime * 7.5 + phase) * 0.55 * abs(aWing);',
      '    vec3 local = vec3(aPosition.x, aPosition.y + flap * abs(aPosition.z),',
      '      aPosition.z * cos(flap));',
      '    // Then face along the tangent of the orbit.',
      '    float heading = angle + 1.5707963;',
      '    vec3 turned = vec3(',
      '      local.x * cos(heading) - local.z * sin(heading),',
      '      local.y,',
      '      local.x * sin(heading) + local.z * cos(heading)',
      '    );',
      '    // A slow bob keeps the ring from looking like a turntable.',
      '    float bob = sin(uTime * 0.9 + phase) * uFlockSpan.y * 0.06;',
      '    world = uFlockCenter + turned + vec3(',
      '      cos(angle) * radius, lift + bob, sin(angle) * radius);',
      '    vShade = 1.0;',
      '    vFade = 1.0;',
      '  }',
      '  vNormal = aNormal;',
      '  gl_Position = uViewProjection * vec4(world, 1.0);',
      '}'
    ].join('\n');
    var fragmentSource = [
      '#version 300 es',
      'precision mediump float;',
      'in vec3 vNormal;',
      'in float vShade;',
      'in float vFade;',
      'uniform vec3 uColor;',
      'uniform vec3 uSunDirection;',
      'uniform float uSunStrength;',
      'uniform highp int uMode;',      // see the vertex shader note
      GRADE_GLSL,
      'out vec4 outColor;',
      '',
      'void main() {',
      '  float daylight = clamp(uSunStrength / 0.42, 0.0, 1.0);',
      '  vec3 tint;',
      '  if (uMode == 0) {',
      '    // Clouds are lit like the terrain so they darken at dusk with it,',
      '    // otherwise they glow as white cut-outs against a night map.',
      '    float ndl = max(0.0, dot(normalize(vNormal), normalize(uSunDirection)));',
      '    float lambert = mix(0.62, 0.80, daylight) + 0.26 * daylight * ndl;',
      '    tint = uColor * lambert;',
      '  } else {',
      '    // Birds read as silhouettes: shape carries them, not shading.',
      '    tint = uColor * mix(0.45, 1.0, daylight);',
      '  }',
      '  outColor = vec4(grade(tint * vShade), vFade);',
      '}'
    ].join('\n');
    var vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    var fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
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
      // The sky is optional, so a failed link only removes clouds and birds.
      // That is exactly the failure that reads as "never implemented" (the
      // `uMode` precision mismatch, 2026-09-06), so it must leave a trace.
      window.__glShaderErrors = window.__glShaderErrors || [];
      window.__glShaderErrors.push('sky link: ' + gl.getProgramInfoLog(program));
      console.warn('voxel3d: sky program link failed\n' +
        gl.getProgramInfoLog(program));
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

    var program = makeProgram(gl, '');
    if (!program) return null;
    // Optional: without them the map still renders, without night lights.
    var nightProgram = makeProgram(gl, 'NIGHT');
    var windowsProgram = makeProgram(gl, 'NIGHT WINDOWS');
    var glowProgram = makeProgram(gl, 'GLOW');

    // Every draw call and buffer/texture allocation below goes through this
    // counter (src/perf.js), so the performance panel reports what the
    // renderer actually did. `--perf` fails on a raw gl.draw*/gl.bufferData.
    var acct = SM.Perf.createGLCounter(gl);
    // GPU timer (EXT_disjoint_timer_query_webgl2): looked up only when the
    // panel is first opened; results are read a few frames later so a query
    // never stalls the pipeline. Absent on many configurations (SwiftShader
    // included) -- the panel then says so instead of inventing a number.
    var timer = { ext: undefined, pending: [], results: [] };

    // The sky is OPTIONAL: if its program fails to link the terrain must
    // still render. Same contract the renderer follows one level up -- a
    // missing WebGL2 context leaves the 2D path untouched.
    var skyProgram = makeSkyProgram(gl);
    var sky = null;

    // A VAO fixes the mesh layout once; render only needs to bind and draw it.
    var vao = gl.createVertexArray();
    var positionBuffer = gl.createBuffer();
    var normalBuffer = gl.createBuffer();
    var colorBuffer = gl.createBuffer();
    var sideDepthBuffer = gl.createBuffer();
    var cellUVBuffer = gl.createBuffer();
    var emissiveBuffer = gl.createBuffer();
    var waterBuffer = gl.createBuffer();
    var shoreBuffer = gl.createBuffer();
    var aoBuffer = gl.createBuffer();
    var fallBuffer = gl.createBuffer();
    var townBuffer = gl.createBuffer();
    var foamBuffer = gl.createBuffer();
    var waveBuffer = gl.createBuffer();
    var indexBuffer = gl.createBuffer();
    var shadowTexture = gl.createTexture();
    // Separate buffers make each data channel inspectable in headless output.
    var position = TERRAIN_ATTRIBS.indexOf('aPosition');
    var normal = TERRAIN_ATTRIBS.indexOf('aNormal');
    var color = TERRAIN_ATTRIBS.indexOf('aColor');
    var sideDepth = TERRAIN_ATTRIBS.indexOf('aSideDepth');
    var cellUV = TERRAIN_ATTRIBS.indexOf('aCellUV');
    var emission = TERRAIN_ATTRIBS.indexOf('aEmissive');
    var water = TERRAIN_ATTRIBS.indexOf('aWater');
    var shore = TERRAIN_ATTRIBS.indexOf('aShore');
    var ambientOcclusion = TERRAIN_ATTRIBS.indexOf('aAO');
    var fall = TERRAIN_ATTRIBS.indexOf('aFall');
    var townAttr = TERRAIN_ATTRIBS.indexOf('aTown');
    var foamAttr = TERRAIN_ATTRIBS.indexOf('aFoam');
    var waveAttr = TERRAIN_ATTRIBS.indexOf('aWave');
    var foamColor = hexToRgb(SM.BIOME_LIST.find(function (b) { return b.id === 'snow'; }).color)
      .map(function (v) { return v / 255; });
    var levelVP = new Float32Array(16);
    var invLevelVP = new Float32Array(16);
    var viewDir = [0, 1, 0];          // towards the camera, set per frame
    // Off (CSS does the grade) until main.js hands one over (setGrade).
    var grade = null;
    var NO_GRADE = { tint: [1, 1, 1], brightness: 1, saturate: 1 };
    var lightColor = windowLightColor();
    // Uniform locations per program variant (a location belongs to one
    // program). Absent uniforms come back null, which GL ignores.
    function terrainUniforms(prog) {
      var names = {
        cloudLobes: 'uCloudLobes',
        cloudLobeFade: 'uCloudLobeFade',
        cloudLobeCount: 'uCloudLobeCount',
        cloudShadow: 'uCloudShadow',
        debugView: 'uDebugView',
        nightLight: 'uNightLight',
        lightColor: 'uLightColor',
        invLevelVP: 'uInvLevelVP',
        gridHalf: 'uGridHalf',
        viewport: 'uViewport',
        pixelWorld: 'uPixelWorld',
        viewDir: 'uViewDir',
        gradeTint: 'uGradeTint',
        gradeBS: 'uGradeBS',
        gradeOn: 'uGradeOn',
        viewProjection: 'uViewProjection',
        verticalScale: 'uVScale',
        foamColor: 'uFoamColor',
        sunDirection: 'uSunDirection',
        sunStrength: 'uSunStrength',
        time: 'uTime',
        shadowMap: 'uShadowMap'
      };
      var out = { program: prog };
      if (!prog) return null;
      Object.keys(names).forEach(function (key) {
        out[key] = gl.getUniformLocation(prog, names[key]);
      });
      return out;
    }
    var dayU = terrainUniforms(program);
    var nightU = terrainUniforms(nightProgram);
    var windowsU = terrainUniforms(windowsProgram);
    var glowU = terrainUniforms(glowProgram);
    var nightLight = 0;
    // Optional: without it the window lights still draw, just without glow.
    var bloom = SM.Bloom ? SM.Bloom.create(gl, acct) : null;
    var bloomOn = true;
    // Wind lines (src/render/wind.js): optional like the bloom; the field
    // arrives from main.js per map (setWindField).
    var wind = SM.Wind ? SM.Wind.createLayer(gl, acct, GRADE_GLSL) : null;
    var showWind = true;
    // Rain and snow (src/render/weather.js): static per map, falls in the
    // vertex shader; optional like the wind.
    var weather = SM.Weather ? SM.Weather.createLayer(gl, acct, GRADE_GLSL) : null;
    var showWeather = true;
    var weatherDraw = { combined: null, view: null, vScale: 1, time: 0, pixelWorld: 1, setGrade: null };
    // Light enough to read over grass by day and over the graded map at
    // night: the snow entry of the biome palette.
    var windColor = hexToRgb(SM.BIOME_LIST.find(function (b) { return b.id === 'snow'; }).color)
      .map(function (v) { return v / 255; });
    var WIND_OPACITY = 0.75;
    var windDraw = {
      combined: null, vScale: 1, time: 0, eye: viewDir, color: windColor,
      opacity: WIND_OPACITY, setGrade: null
    };
    // What the bloom source depends on: view-projection, height scale, the
    // mesh and the canvas size. Unchanged -> post.js reuses last frame's blur.
    var bloomKey = new Float32Array(20);
    var meshVersion = 0;
    var projection = new Float32Array(16);
    var view = new Float32Array(16);
    var combined = new Float32Array(16);
    var camera = { yaw: 35, pitch: 42, zoom: 10, tx: 0, ty: 0, tz: 0 };
    var fit = { distance: 100, near: 0.1, far: 300 };
    var vScale = 1.6;
    var gridSize = [1, 1];
    var sun = [0.5, 1.0, 0.74];
    var strength = 0.34;
    var elapsedTime = 0;
    var indexCount = 0;
    // Settlement triangles are moved to the END of the index buffer at upload
    // (setMesh), so at night the window variant draws only them.
    var townIndexStart = 0;
    var clearColor = [0.055, 0.075, 0.11, 1];
    var width = 1;
    var height = 1;
    var disposed = false;
    // Sky state. `cloudInstances` is the immutable per-map layout; `cloudNow`
    // is this frame's resolved position, shared by BOTH programs so the shadow
    // can never drift away from the cloud that casts it.
    var cloudInstances = [];
    var cloudNow = [];
    var skySeed = 1337;               // map seed, from mesh.seed
    // Shadow lobes for the terrain shader (vec4 each) and their opacity.
    var cloudShadowData = new Float32Array(SM.Sky.MAX_SHADOW_LOBES * 4);
    var cloudLobeFadeData = new Float32Array(SM.Sky.MAX_SHADOW_LOBES);
    var cloudLobeCount = 0;
    // Reused every frame. These two used to be allocated inside the render loop
    // and that is exactly the kind of quiet GC pressure this project bans in a
    // per-frame path -- three small arrays a frame is 180 allocations a second
    // for numbers that never change shape.
    var cloudWorldData = new Float32Array(SM.Sky.MAX_CLOUDS * 3);
    // Per-cloud opacity for both programs; zero-padded, reused every frame.
    var cloudFadeData = new Float32Array(SM.Sky.MAX_CLOUDS);
    var meshBounds = null;
    var showSky = true;
    var debugView = 0;
    // Tuned by eye against the map: below ~0.4 the shadow reads as a smudge,
    // above ~0.6 it competes with the sun shadow and the terrain goes muddy.
    var cloudShadowStrength = 0.5;

    /* Faces were emitted CCW in addQuad, so back-face culling removes only
     * hidden interior faces and keeps the outward terrain shell. */
    gl.enable(gl.CULL_FACE);
    gl.frontFace(gl.CCW);
    gl.enable(gl.DEPTH_TEST);
    gl.bindVertexArray(vao);

    function setupAttrib(buffer, location, size, type, normalized) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, type || gl.FLOAT, !!normalized, 0, 0);
    }

    setupAttrib(positionBuffer, position, 3);
    setupAttrib(normalBuffer, normal, 3);
    setupAttrib(colorBuffer, color, 3);
    setupAttrib(sideDepthBuffer, sideDepth, 1);
    setupAttrib(cellUVBuffer, cellUV, 2);
    setupAttrib(emissiveBuffer, emission, 1);
    setupAttrib(waterBuffer, water, 1, gl.UNSIGNED_BYTE);
    setupAttrib(shoreBuffer, shore, 1);
    setupAttrib(aoBuffer, ambientOcclusion, 1, gl.UNSIGNED_BYTE);
    setupAttrib(fallBuffer, fall, 1, gl.UNSIGNED_BYTE);
    setupAttrib(townBuffer, townAttr, 1, gl.UNSIGNED_BYTE);
    setupAttrib(foamBuffer, foamAttr, 1, gl.UNSIGNED_BYTE);
    setupAttrib(waveBuffer, waveAttr, 4, gl.UNSIGNED_BYTE, true);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, shadowTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      1,
      1,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0])
    );
    acct.texture(shadowTexture, 1);
    gl.bindTexture(gl.TEXTURE_2D, null);

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
      camera.yaw = wrapYaw(cam.yaw);
      camera.pitch = clampPitch(cam.pitch);
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

    /* Build the sky buffers for a map. Called from setMesh, because cloud size
     * and flock radius are derived from the map footprint -- a 64² sky on a 192²
     * map would read as a handful of specks. */
    function buildSky(bounds) {
      var clouds;
      var birds;

      if (!skyProgram || !bounds) return;
      if (!sky) {
        sky = {
          cloudVao: gl.createVertexArray(),
          cloudPos: gl.createBuffer(),
          cloudNormal: gl.createBuffer(),
          cloudIdx: gl.createBuffer(),
          cloudIndex: gl.createBuffer(),
          cloudCount: 0,
          birdVao: gl.createVertexArray(),
          birdPos: gl.createBuffer(),
          birdIdx: gl.createBuffer(),
          birdWing: gl.createBuffer(),
          birdIndex: gl.createBuffer(),
          birdCount: 0,
          viewProjection: gl.getUniformLocation(skyProgram, 'uViewProjection'),
          time: gl.getUniformLocation(skyProgram, 'uTime'),
          cloudPosUniform: gl.getUniformLocation(skyProgram, 'uCloudPos'),
          cloudFadeUniform: gl.getUniformLocation(skyProgram, 'uCloudFade'),
          mode: gl.getUniformLocation(skyProgram, 'uMode'),
          color: gl.getUniformLocation(skyProgram, 'uColor'),
          sunDirection: gl.getUniformLocation(skyProgram, 'uSunDirection'),
          sunStrength: gl.getUniformLocation(skyProgram, 'uSunStrength'),
          flockCenter: gl.getUniformLocation(skyProgram, 'uFlockCenter'),
          flockSpan: gl.getUniformLocation(skyProgram, 'uFlockSpan'),
          gradeTint: gl.getUniformLocation(skyProgram, 'uGradeTint'),
          gradeBS: gl.getUniformLocation(skyProgram, 'uGradeBS'),
          gradeOn: gl.getUniformLocation(skyProgram, 'uGradeOn')
        };
      }

      // The sky follows the map's seed (setMesh hands it over), so a map
      // always gets the same clouds and another map gets other ones.
      cloudInstances = SM.Sky.cloudInstances(bounds, SM.Sky.cloudCount(skySeed), skySeed);
      cloudLobeCount = SM.Sky.shadowLobeCount(cloudInstances);
      clouds = SM.Sky.buildCloudMesh(cloudInstances);
      birds = SM.Sky.buildBirdMesh(16, 4242);

      gl.bindVertexArray(sky.cloudVao);
      uploadSkyAttrib(sky.cloudPos, 'aPosition', clouds.positions, 3);
      uploadSkyAttrib(sky.cloudNormal, 'aNormal', clouds.normals, 3);
      uploadSkyAttrib(sky.cloudIdx, 'aCloudIndex', clouds.cloudIndex, 1);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sky.cloudIndex);
      acct.bufferData(gl.ELEMENT_ARRAY_BUFFER, sky.cloudIndex, clouds.indices, gl.STATIC_DRAW);
      sky.cloudCount = clouds.indices.length;

      gl.bindVertexArray(sky.birdVao);
      uploadSkyAttrib(sky.birdPos, 'aPosition', birds.positions, 3);
      uploadSkyAttrib(sky.birdIdx, 'aCloudIndex', birds.birdIndex, 1);
      uploadSkyAttrib(sky.birdWing, 'aWing', birds.wing, 1);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sky.birdIndex);
      acct.bufferData(gl.ELEMENT_ARRAY_BUFFER, sky.birdIndex, birds.indices, gl.STATIC_DRAW);
      sky.birdCount = birds.indices.length;

      gl.bindVertexArray(null);
    }

    function uploadSkyAttrib(buffer, name, data, size) {
      var location = gl.getAttribLocation(skyProgram, name);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      acct.bufferData(gl.ARRAY_BUFFER, buffer, data, gl.STATIC_DRAW);
      // An unused attribute reports -1; binding it would raise a GL error.
      if (location < 0) return;
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    }

    /* Resolve this frame's cloud positions once, for both programs. */
    function updateClouds() {
      if (!meshBounds || !cloudInstances.length) {
        cloudNow = [];
        return;
      }
      // Both calls write into buffers this renderer owns, so a frame costs no
      // allocation at all.
      SM.Sky.driftClouds(cloudInstances, elapsedTime, meshBounds, vScale, cloudNow);
      SM.Sky.cloudShadowUniforms(cloudNow, meshBounds, sun, cloudShadowData, cloudLobeFadeData);
      cloudFadeData.fill(0);
      for (var f = 0; f < cloudNow.length && f < SM.Sky.MAX_CLOUDS; f++) {
        cloudFadeData[f] = cloudNow[f].fade;
      }
    }

    function drawSky() {
      var flat;
      var i;
      var spanX;

      // Debug views show the terrain terms alone: clouds would only hide them.
      if (!skyProgram || !sky || !showSky || debugView || !meshBounds) return;
      spanX = meshBounds.maxX - meshBounds.minX;
      gl.useProgram(skyProgram);
      gl.uniformMatrix4fv(sky.viewProjection, false, combined);
      gl.uniform1f(sky.time, elapsedTime);
      gl.uniform3fv(sky.sunDirection, sun);
      gl.uniform1f(sky.sunStrength, strength);
      setGradeUniforms(sky.gradeTint, sky.gradeBS, sky.gradeOn);

      if (sky.cloudCount && cloudNow.length) {
        flat = cloudWorldData;
        for (i = 0; i < cloudNow.length && i < SM.Sky.MAX_CLOUDS; i++) {
          flat[i * 3] = cloudNow[i].x;
          flat[i * 3 + 1] = cloudNow[i].y;
          flat[i * 3 + 2] = cloudNow[i].z;
        }
        gl.uniform3fv(sky.cloudPosUniform, flat);
        gl.uniform1fv(sky.cloudFadeUniform, cloudFadeData);
        gl.uniform1i(sky.mode, 0);
        gl.uniform3f(sky.color, 0.93, 0.95, 0.99);
        gl.bindVertexArray(sky.cloudVao);
        // Fading clouds are translucent, and a voxel cloud is many touching
        // boxes: plain alpha would show every inner face through the others.
        // Pass 1 writes depth only, pass 2 colours only the front-most
        // surface (LEQUAL) with blending -- each pixel is blended once.
        gl.colorMask(false, false, false, false);
        acct.drawElements(gl.TRIANGLES, sky.cloudCount, gl.UNSIGNED_INT, 0);
        gl.colorMask(true, true, true, true);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(false);
        acct.drawElements(gl.TRIANGLES, sky.cloudCount, gl.UNSIGNED_INT, 0);
        gl.depthMask(true);
        gl.depthFunc(gl.LESS);
        gl.disable(gl.BLEND);
      }

      if (sky.birdCount) {
        gl.uniform1i(sky.mode, 1);
        gl.uniform3f(sky.color, 0.10, 0.12, 0.16);
        gl.uniform3f(
          sky.flockCenter,
          (meshBounds.minX + meshBounds.maxX) * 0.5,
          meshBounds.maxY * vScale,
          (meshBounds.minZ + meshBounds.maxZ) * 0.5
        );
        // Height must match what `SM.Sky.ceiling` assumes, otherwise the flock
        // drifts back outside the frustum.
        gl.uniform2f(sky.flockSpan, spanX * 0.34, spanX * 0.09);
        // Birds are thin double-sided triangles: culling would drop half of
        // every wing as it swings through the back-facing side.
        gl.disable(gl.CULL_FACE);
        gl.bindVertexArray(sky.birdVao);
        acct.drawElements(gl.TRIANGLES, sky.birdCount, gl.UNSIGNED_INT, 0);
        gl.enable(gl.CULL_FACE);
      }
      gl.bindVertexArray(null);
    }

    function setSky(enabled) {
      showSky = enabled !== false;
    }

    // 0 = lit; 1 AO, 2 normals, 3 height, 4 albedo, 5 sun shadow, 6 waterfalls
    function setDebugView(mode) {
      debugView = Math.max(0, Math.min(6, mode | 0));
    }

    function setSun(nextSun) {
      var s = nextSun || {};

      // `dx/dy` is the direction the light travels; Lambert needs the vector
      // TOWARDS the light, hence the flip. `buildShadowMap` and
      // `SM.Sky.cloudShadowUniforms` follow the same convention.
      sun[0] = -(+s.dx || 0);
      sun[1] = Math.max(0.12, +s.rise || 0.12);
      sun[2] = -(+s.dy || 0);
      strength = Math.max(0, Math.min(1, +s.strength || 0));
      // 0 by day .. 1 at full night (SM.nightAmount in time.js).
      nightLight = Math.max(0, Math.min(1, +s.night || 0));
    }

    function setGradeUniforms(tintLoc, bsLoc, onLoc) {
      var g = grade || NO_GRADE;
      gl.uniform3fv(tintLoc, g.tint);
      gl.uniform2f(bsLoc, g.brightness, g.saturate);
      gl.uniform1f(onLoc, grade ? 1 : 0);
    }

    /* The day/night colour grade in the shaders, or null to leave it to the
     * CSS filter + wash (main.js applyDayNight decides; it hands one over
     * only while the night lights are on). */
    function setGrade(g) {
      if (!g || !g.tint) {
        grade = null;
        return;
      }
      grade = {
        tint: [+g.tint[0], +g.tint[1], +g.tint[2]],
        brightness: +g.brightness,
        saturate: +g.saturate
      };
    }

    function setTime(seconds) {
      // Time is render state, so mesh buffers remain immutable between frames.
      elapsedTime = Math.max(0, +seconds || 0);
    }

    function setShadowMap(data, mapWidth, mapHeight) {
      if (!data || !mapWidth || !mapHeight || disposed) return;
      // Only this R8 texture changes when the day-cycle slider moves.
      gl.bindTexture(gl.TEXTURE_2D, shadowTexture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R8,
        mapWidth,
        mapHeight,
        0,
        gl.RED,
        gl.UNSIGNED_BYTE,
        data
      );
      acct.texture(shadowTexture, mapWidth * mapHeight);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }

    function setMesh(mesh) {
      // disposed KONTROLÜ buildSky'dan ÖNCE: eskiden sonra kontrol ediliyordu,
      // disposed bir renderer'da bile yeni VAO/buffer/program yaratılıp asla
      // serbest bırakılmıyordu — sessiz GL kaynak sızıntısı (kod taraması
      // 2026-09-15, bulgu 4).
      if (disposed) return;
      // Sky geometry scales with the map footprint, so it is rebuilt whenever a
      // new mesh arrives (new map, or a brush edit that changed the extent).
      meshBounds = mesh && mesh.bounds ? mesh.bounds : meshBounds;
      if (mesh && mesh.seed != null) skySeed = mesh.seed | 0;
      buildSky(meshBounds);
      if (!mesh) return;
      // Static buffers are replaced only when generation produces a new grid.
      // Bind the VAO during upload so element-buffer ownership stays attached.
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      acct.bufferData(gl.ARRAY_BUFFER, positionBuffer, mesh.positions, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
      acct.bufferData(gl.ARRAY_BUFFER, normalBuffer, mesh.normals, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
      acct.bufferData(gl.ARRAY_BUFFER, colorBuffer, mesh.colors, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, sideDepthBuffer);
      acct.bufferData(gl.ARRAY_BUFFER, sideDepthBuffer, mesh.sideDepth, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, cellUVBuffer);
      acct.bufferData(gl.ARRAY_BUFFER, cellUVBuffer, mesh.cellUV, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, emissiveBuffer);
      acct.bufferData(gl.ARRAY_BUFFER, emissiveBuffer, mesh.emissive, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, waterBuffer);
      acct.bufferData(gl.ARRAY_BUFFER, waterBuffer, mesh.water, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, shoreBuffer);
      acct.bufferData(gl.ARRAY_BUFFER, shoreBuffer, mesh.shore, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, aoBuffer);
      acct.bufferData(gl.ARRAY_BUFFER, aoBuffer, mesh.ao, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, fallBuffer);
      // mesh.fall is optional in principle (older callers), but buildVoxelMesh
      // always returns it now -- guard anyway so a hand-built mesh without it
      // does not throw here.
      acct.bufferData(gl.ARRAY_BUFFER, fallBuffer,
        mesh.fall || new Uint8Array(mesh.vertexCount),
        gl.STATIC_DRAW
      );
      gl.bindBuffer(gl.ARRAY_BUFFER, townBuffer);
      acct.bufferData(gl.ARRAY_BUFFER, townBuffer,
        mesh.town || new Uint8Array(mesh.vertexCount), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, foamBuffer);
      acct.bufferData(gl.ARRAY_BUFFER, foamBuffer,
        mesh.foam || new Uint8Array(mesh.vertexCount), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, waveBuffer);
      acct.bufferData(gl.ARRAY_BUFFER, waveBuffer,
        mesh.wave || new Uint8Array(mesh.vertexCount * 4), gl.STATIC_DRAW);
      var ordered = settlementLast(mesh.indices, mesh.town);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      acct.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexBuffer, ordered.indices, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      indexCount = mesh.indices.length;
      townIndexStart = ordered.townStart;
      gridSize = mesh.gridSize || gridSize;
      meshVersion++;
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
      //
      // ⚠️ THE SKY IS PART OF THE FRAME. Clouds and birds live above the terrain
      // and the ortho box is the frustum -- fitting to the terrain alone clipped
      // the entire sky away silently (no GL error, nothing in the console, just
      // an empty sky). `SM.Sky.ceiling` is the single place that knows how high
      // the sky reaches.
      var skyTop = SM.Sky
        ? SM.Sky.ceiling(bounds, vScale, (bounds.maxX - bounds.minX) * 0.09)
        : bounds.maxY * vScale;
      var top = Math.max(bounds.maxY * vScale, skyTop);
      var tx = (bounds.minX + bounds.maxX) / 2;
      var ty = (bounds.minY * vScale + top) / 2;
      var tz = (bounds.minZ + bounds.maxZ) / 2;
      var halfX = (bounds.maxX - bounds.minX) / 2;
      var halfY = (top - bounds.minY * vScale) / 2;
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
      if (disposed) return;
      acct.beginFrame();
      beginGpuTimer();
      renderScene();
      endGpuTimer();
      acct.endFrame();
    }

    function renderScene() {
      var yaw;
      var pitch;
      var target;
      var eye;
      var aspect;
      var halfH;

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
      viewDir[0] = eye[0] - target[0];
      viewDir[1] = eye[1] - target[1];
      viewDir[2] = eye[2] - target[2];
      mat4Multiply(combined, projection, view);
      // The stage colour behind the map takes the day/night grade too (it
      // was under the CSS wash before the grade moved into the shaders).
      var bg = grade ? gradeColor(clearColor, grade) : clearColor;
      gl.clearColor(bg[0], bg[1], bg[2], clearColor[3]);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!indexCount) return;
      // Cloud positions are resolved BEFORE the terrain draw: the ground needs
      // this frame's shadow, and the sky pass below reuses the same numbers.
      updateClouds();
      gl.bindVertexArray(vao);
      if (nightLight > 0.001 && nightU && windowsU) {
        // Night: the colour grade in the shader; window lights only on the
        // settlement triangles at the end of the buffer (one extra draw).
        setTerrainUniforms(nightU);
        acct.drawElements(gl.TRIANGLES, townIndexStart, gl.UNSIGNED_INT, 0);
        if (townIndexStart < indexCount) {
          setTerrainUniforms(windowsU);
          acct.drawElements(gl.TRIANGLES, indexCount - townIndexStart,
            gl.UNSIGNED_INT, townIndexStart * 4);
        }
      } else {
        setTerrainUniforms(dayU);
        acct.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0);
      }
      gl.bindVertexArray(null);
      // Wind lines: after the terrain (depth-tested against it, so a ridge
      // hides them), before the sky (clouds pass over them).
      if (wind && showWind && !debugView) {
        windDraw.combined = combined;
        windDraw.vScale = vScale;
        windDraw.time = elapsedTime;
        windDraw.pixelWorld = 2 * camera.zoom / width;
        windDraw.setGrade = setGradeUniforms;
        wind.draw(windDraw);
      }
      if (weather && showWeather && !debugView) {
        weatherDraw.combined = combined;
        weatherDraw.view = view;
        weatherDraw.vScale = vScale;
        weatherDraw.time = elapsedTime;
        weatherDraw.pixelWorld = 2 * camera.zoom / width;
        weatherDraw.setGrade = setGradeUniforms;
        weather.draw(weatherDraw);
      }
      drawSky();
      // Night only: the bloom passes do not run at all while nightLight is 0.
      if (bloom && glowU && bloomOn && !debugView && nightLight > 0.001) {
        bloom.render(width, height, BLOOM_STRENGTH * nightLight, drawBloomSource,
          bloomSourceChanged());
      }
    }

    function setTerrainUniforms(U) {
      gl.useProgram(U.program);
      gl.uniformMatrix4fv(U.viewProjection, false, combined);
      gl.uniform1f(U.verticalScale, vScale);
      gl.uniform3fv(U.sunDirection, sun);
      gl.uniform1f(U.sunStrength, strength);
      gl.uniform1f(U.debugView, debugView);
      gl.uniform1f(U.time, elapsedTime);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, shadowTexture);
      gl.uniform1i(U.shadowMap, 0);
      gl.uniform4fv(U.cloudLobes, cloudShadowData);
      gl.uniform1fv(U.cloudLobeFade, cloudLobeFadeData);
      gl.uniform1i(U.cloudLobeCount,
        showSky && !debugView && cloudNow.length ? cloudLobeCount : 0);
      gl.uniform1f(U.cloudShadow, cloudShadowStrength);
      gl.uniform1f(U.nightLight, debugView ? 0 : nightLight);
      gl.uniform3fv(U.lightColor, lightColor);
      gl.uniform3fv(U.foamColor, foamColor);
      if (nightLight > 0.001) {
        // (x, raw level, z) -> clip is view-projection after the vertex
        // shader's Y scale; its inverse brings a fragment back to cells.
        levelVP.set(combined);
        levelVP[4] *= vScale;
        levelVP[5] *= vScale;
        levelVP[6] *= vScale;
        levelVP[7] *= vScale;
        mat4Invert(invLevelVP, levelVP);
        gl.uniformMatrix4fv(U.invLevelVP, false, invLevelVP);
        gl.uniform2f(U.gridHalf, gridSize[0] / 2, gridSize[1] / 2);
        gl.uniform2f(U.viewport, width, height);
        gl.uniform1f(U.pixelWorld, 2 * camera.zoom / width);
        gl.uniform3f(U.viewDir, viewDir[0], viewDir[1], viewDir[2]);
      }
      setGradeUniforms(U.gradeTint, U.gradeBS, U.gradeOn);
    }

    function bloomSourceChanged() {
      var changed = false;
      var k;

      for (k = 0; k < 16; k++) {
        if (bloomKey[k] !== combined[k]) { bloomKey[k] = combined[k]; changed = true; }
      }
      if (bloomKey[16] !== Math.fround(vScale)) { bloomKey[16] = vScale; changed = true; }
      if (bloomKey[17] !== meshVersion) { bloomKey[17] = meshVersion; changed = true; }
      if (bloomKey[18] !== width || bloomKey[19] !== height) {
        bloomKey[18] = width;
        bloomKey[19] = height;
        changed = true;
      }
      return changed;
    }

    function setWindField(f) {
      if (wind) wind.setField(f);
    }

    function setWind(on) {
      showWind = on !== false;
    }

    function setWeatherData(built, prevailing) {
      if (weather && !disposed) weather.setData(built, prevailing);
    }

    function setWeather(on) {
      showWeather = on !== false;
    }

    // Measurement / comparison hook: lights stay, only the glow is skipped.
    function setBloom(on) {
      bloomOn = on !== false;
    }

    // Bloom source: the same terrain, GLOW variant, into post.js's
    // 1/4-resolution target (post.js set the viewport). The wave needs the
    // same time and scale so water depth matches the main pass.
    function drawBloomSource() {
      gl.useProgram(glowU.program);
      gl.uniformMatrix4fv(glowU.viewProjection, false, combined);
      gl.uniform1f(glowU.verticalScale, vScale);
      gl.uniform1f(glowU.time, elapsedTime);
      gl.uniform3fv(glowU.lightColor, lightColor);
      gl.bindVertexArray(vao);
      acct.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);
    }

    /* A PNG of the current frame.
     *
     * ⚠️ `glCanvas.toDataURL()` DOES NOT WORK here: the context is created
     * without `preserveDrawingBuffer`, so by the time anything outside the draw
     * call asks for pixels the buffer is already gone and the result is blank.
     * Turning that flag on would cost every frame for a button pressed once, so
     * instead this renders and reads back in the SAME tick.
     *
     * GL reads bottom-up while a canvas is top-down, hence the row flip.
     */
    /* GPU time of whole frames, only while the panel is open. One query per
     * frame, at most four in flight; a result is collected once available
     * and dropped if the GPU reports a disjoint (unreliable) interval. */
    function beginGpuTimer() {
      var q;

      if (!acct.isEnabled()) return;
      if (timer.ext === undefined) {
        timer.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') || null;
      }
      if (!timer.ext) return;
      while (timer.pending.length) {
        q = timer.pending[0];
        if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
        if (!gl.getParameter(timer.ext.GPU_DISJOINT_EXT)) {
          timer.results.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        }
        gl.deleteQuery(q);
        timer.pending.shift();
      }
      if (timer.pending.length >= 4) return;
      timer.active = gl.createQuery();
      gl.beginQuery(timer.ext.TIME_ELAPSED_EXT, timer.active);
    }

    function endGpuTimer() {
      if (!timer.active) return;
      gl.endQuery(timer.ext.TIME_ELAPSED_EXT);
      timer.pending.push(timer.active);
      timer.active = null;
    }

    function setStatsEnabled(on) {
      acct.setEnabled(on);
    }

    // Per-frame path of the panel: only the GPU timer results, nothing that
    // queries GL state.
    function drainGpuTimes() {
      var out = timer.results;
      timer.results = [];
      return out;
    }

    /* Numbers for the performance panel. `gpuMs` drains the timer results
     * collected since the last call (empty when no timer is available). */
    function stats() {
      var gpuMs = timer.results;
      timer.results = [];
      return {
        frame: acct.lastFrame(),
        memory: acct.memory(),
        canvasBytes: SM.Perf.drawingBufferBytes(
          gl.drawingBufferWidth, gl.drawingBufferHeight, gl.getParameter(gl.SAMPLES)),
        gpuTimer: timer.ext === undefined ? 'unknown' : (timer.ext ? 'yes' : 'no'),
        gpuMs: gpuMs
      };
    }

    function capture() {
      var pixels;
      var flipped;
      var row;
      var out;
      var image;
      var y;

      if (disposed || !width || !height) return null;
      render();
      pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      flipped = new Uint8ClampedArray(pixels.length);
      row = width * 4;
      for (y = 0; y < height; y++) {
        flipped.set(pixels.subarray(y * row, y * row + row),
          (height - 1 - y) * row);
      }
      out = document.createElement('canvas');
      out.width = width;
      out.height = height;
      image = new ImageData(flipped, width, height);
      out.getContext('2d').putImageData(image, 0, 0);
      return out;
    }

    function dispose() {
      if (disposed) return;
      // Explicitly release GPU allocations because renderer switches are opt-in.
      gl.deleteBuffer(positionBuffer);
      gl.deleteBuffer(normalBuffer);
      gl.deleteBuffer(colorBuffer);
      gl.deleteBuffer(sideDepthBuffer);
      gl.deleteBuffer(cellUVBuffer);
      gl.deleteBuffer(emissiveBuffer);
      gl.deleteBuffer(waterBuffer);
      gl.deleteBuffer(shoreBuffer);
      gl.deleteBuffer(aoBuffer);
      gl.deleteBuffer(fallBuffer);
      gl.deleteBuffer(townBuffer);
      gl.deleteBuffer(foamBuffer);
      gl.deleteBuffer(waveBuffer);
      if (bloom) bloom.dispose();
      if (wind) wind.dispose();
      if (weather) weather.dispose();
      gl.deleteBuffer(indexBuffer);
      gl.deleteTexture(shadowTexture);
      acct.forget(shadowTexture);
      timer.pending.forEach(function (q) { gl.deleteQuery(q); });
      timer.pending = [];
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      if (nightProgram) gl.deleteProgram(nightProgram);
      if (windowsProgram) gl.deleteProgram(windowsProgram);
      if (glowProgram) gl.deleteProgram(glowProgram);
      if (sky) {
        gl.deleteBuffer(sky.cloudPos);
        gl.deleteBuffer(sky.cloudNormal);
        gl.deleteBuffer(sky.cloudIdx);
        gl.deleteBuffer(sky.cloudIndex);
        gl.deleteBuffer(sky.birdPos);
        gl.deleteBuffer(sky.birdIdx);
        gl.deleteBuffer(sky.birdWing);
        gl.deleteBuffer(sky.birdIndex);
        gl.deleteVertexArray(sky.cloudVao);
        gl.deleteVertexArray(sky.birdVao);
        sky = null;
      }
      if (skyProgram) gl.deleteProgram(skyProgram);
      // buildSky'ın kendi koruması `if (!skyProgram || !bounds) return` —
      // silinmiş bir program'ı null'lamazsak bu koruma disposed sonrası bile
      // geçer görünür (kod taraması 2026-09-15, bulgu 4, savunma katmanı;
      // asıl kapatma setMesh'in artık en başta disposed kontrol etmesi).
      skyProgram = null;
      disposed = true;
    }

    return {
      resize: resize,
      setCamera: setCamera,
      setClearColor: setClearColor,
      setMesh: setMesh,
      setVerticalScale: setVerticalScale,
      setSun: setSun,
      setTime: setTime,
      setGrade: setGrade,
      setBloom: setBloom,
      setWindField: setWindField,
      setWind: setWind,
      setWeatherData: setWeatherData,
      setWeather: setWeather,
      setShadowMap: setShadowMap,
      setSky: setSky,
      setDebugView: setDebugView,
      capture: capture,
      fitCamera: fitCamera,
      render: render,
      setStatsEnabled: setStatsEnabled,
      stats: stats,
      drainGpuTimes: drainGpuTimes,
      dispose: dispose
    };
  }

  SM.buildVoxelMesh = buildVoxelMesh;
  SM.VOXEL_WAVE_DIP = WAVE_DIP;
  SM.voxelGradeColor = gradeColor;
  SM.voxelWaveField = waveField;
  SM.voxelWaveAmplitude = waveAmplitude;
  SM.VOXEL_WAVE_K = WAVE_K;
  SM.mat4Invert = mat4Invert;
  SM.voxelSettlementLast = settlementLast;
  SM.voxelTerrainShaderSources = terrainShaderSources;
  SM.mat4Multiply = mat4Multiply;
  SM.buildShadowMap = buildShadowMap;
  SM.shouldFlipVoxelQuad = shouldFlipVoxelQuad;
  SM.VoxelCamera = {
    wrapYaw: wrapYaw,
    clampPitch: clampPitch,
    snapYaw: snapYaw,
    panVector: panVector
  };
  SM.Voxel3D = { isSupported: isSupported, create: create };
})(window.SM = window.SM || {});
