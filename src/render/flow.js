/* Flowing rivers: a per-map flow map for the voxel view's fresh water.
 *
 * Owner-approved (2026-10-06): rivers, and the plunge pools at the foot of
 * waterfalls, visibly flow downhill. The classic dual-phase flow-map
 * technique: the water's pattern is advected along a velocity field, two
 * copies half a cycle apart are cross-faded so the moment one of them
 * snaps back to its start is always the moment it is invisible.
 *
 * The field is DATA (this file, DOM- and GL-free, `--flow` in
 * tools/headless.js); the pattern is a few lines of GLSL (`GLSL` below)
 * that only the river draw of the terrain runs (voxel3d.js, RIVER
 * variant), so no other fragment pays for it.
 *
 * What a river is on these maps: the generator's rivers are short runs of
 * `river` tiles AND chains of small pools (the settle pass relabels broad
 * spreads `lake`) stepping down level by level, with waterfalls between.
 * So flow is decided by GEOMETRY, per BODY (a 4-connected patch of fresh
 * water at one level):
 *   - an OUTLET is a body tile next to lower water, the sea or the map
 *     edge; an INLET one next to higher fresh water (a fall's landing, an
 *     upper step of the cascade);
 *   - a body with an outlet flows: every tile runs down the breadth-first
 *     distance to the outlet (dOut); an outlet tile runs over its edge;
 *   - through a pool the current keeps to the shortest inlet -> outlet
 *     path and dies out PATH_WIDTH tiles off it (dIn + dOut - min), and a
 *     tile labelled lake flows only within LAKE_REACH of where water
 *     enters or leaves it: a large lake with a stream through it keeps a
 *     still middle (lakes stay lakes; the sea never flows);
 *   - a body with no outlet (a river ending in a lake at its own level):
 *     its river tiles keep the generator's own downhill step (grid.flow on
 *     centrelines, copied breadth-first across the widened bed), its lake
 *     tiles are still;
 *   - a waterfall LIP (grid.waterfalls 1) runs over its drop; within
 *     POOL_REACH of a LANDING tile (2) the water spreads out from the foot
 *     of the fall, on in the direction it fell, and churns (foam; a
 *     landing boxed in by banks churns in place);
 *   then two passes of 3x3 smoothing so the field bends instead of kinking,
 *   and no current runs across an edge into a bank or up a step (that part
 *   of it is removed, so it follows the bank).
 * Speed, tiles per second, from the slope: the body's drop at its outlet
 * over its length (SPEED_FLAT + SPEED_PER_SLOPE x levels per tile, slope
 * clamped at 2) -- a steep chain of short steps runs fast, a long level
 * reach slowly; fastest over a lip and at the foot of a fall.
 *
 * Values live at GRID CORNERS (like the waves, voxel3d.js waveField), so a
 * linear texture fetch interpolates one continuous field across tile
 * seams: velocity = mean over the corner's flowing tiles, slowed against a
 * land bank and stopped where the corner touches still water (the still
 * part of a lake, the sea at a mouth), so the pattern fades out instead
 * of ending at a tile edge. Encoded RGBA8: R, G velocity (128 = 0, +-127 =
 * +-VMAX tiles/s), B foam, A 255 where any flowing tile meets the corner.
 */
(function (SM) {
  'use strict';

  var VMAX = 2.0;              // tiles per second at a byte of +-127
  var POOL_REACH = 2;          // plunge pool radius, breadth-first steps
  var PATH_WIDTH = 3;          // tiles off the inlet -> outlet path to still water
  var LAKE_REACH = 3;          // a lake tile flows this close to an inlet/outlet
  var SPEED_FLAT = 0.5;
  var SPEED_PER_SLOPE = 0.6;   // per level of drop per tile of run
  var SPEED_LIP = 1.7;         // water going over a fall
  var SPEED_POOL = 1.6;        // at a landing tile, easing out over the pool
  var BANK = 0.7;              // speed kept at a corner on a land bank
  var MIN_SPEED = 0.05;        // below this a tile is still
  // E=1 SE=2 S=3 SW=4 W=5 NW=6 N=7 NE=8 (generate.js DIR), as grid x/y.
  var DIR_X = [0, 1, 1, 0, -1, -1, -1, 0, 1];
  var DIR_Y = [0, 0, 1, 1, 1, 0, -1, -1, -1];
  var N4X = [-1, 1, 0, 0];
  var N4Y = [0, 0, -1, 1];

  function biomeIndex(id) {
    return SM.BIOME_LIST.findIndex(function (b) { return b.id === id; });
  }

  /* Breadth-first distance inside each body from the tiles flagged in
   * `seeds` into `dist` (-1 unreached). */
  function bodyDistance(W, H, body, seeds, dist, queue) {
    var head = 0;
    var tail = 0;
    var n = W * H;
    var i;

    dist.fill(-1);
    for (i = 0; i < n; i++) if (seeds[i]) { dist[i] = 0; queue[tail++] = i; }
    while (head < tail) {
      var c = queue[head++];
      var x = c % W;
      var y = (c / W) | 0;
      for (var k = 0; k < 4; k++) {
        var px = x + N4X[k];
        var py = y + N4Y[k];
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        var pi = py * W + px;
        if (body[pi] !== body[c] || dist[pi] >= 0) continue;
        dist[pi] = dist[c] + 1;
        queue[tail++] = pi;
      }
    }
  }

  /* The flow of one map. Returns per tile: `tile` (0 still, 1 flowing
   * river, 2 other flowing fresh water: a pool, the current through a
   * lake), unit direction `dx`/`dy`, `speed` (tiles/s), `foam` (0..1),
   * `body` (id, -1 not fresh water); per corner, `corner` (RGBA8, see the
   * header), (W+1) x (H+1). */
  function field(grid) {
    var W = grid.width;
    var H = grid.height;
    var n = W * H;
    var level = grid.level;
    var water = grid.water;
    var biome = grid.biome;
    var falls = grid.waterfalls || new Uint8Array(n);
    var gflow = grid.flow || new Int8Array(n);
    var MIN_DROP = SM.WATERFALL_MIN_DROP || 3;
    var RIVER = biomeIndex('river');
    var tile = new Uint8Array(n);
    var dx = new Float32Array(n);
    var dy = new Float32Array(n);
    var speed = new Float32Array(n);
    var foam = new Float32Array(n);
    var fixed = new Uint8Array(n);       // lips keep their direction
    var fallX = new Float32Array(n);     // a landing: the way the water fell
    var fallY = new Float32Array(n);
    var fresh = new Uint8Array(n);
    var body = new Int32Array(n).fill(-1);
    var isOut = new Uint8Array(n);
    var isIn = new Uint8Array(n);
    var outX = new Float32Array(n);
    var outY = new Float32Array(n);
    var dropAt = new Int16Array(n);
    var dOut = new Int32Array(n);
    var dIn = new Int32Array(n);
    var poolDist = new Int32Array(n);
    var queue = new Int32Array(n);
    var bodies = [];
    var head;
    var tail;
    var b;
    var i;
    var k;
    var x;
    var y;
    var px;
    var py;
    var pi;
    var c;
    var ox;
    var oy;
    var lx;
    var ly;
    var lj;

    for (i = 0; i < n; i++) fresh[i] = water[i] && !(SM.isSea && SM.isSea(grid, i)) ? 1 : 0;

    // 1. Bodies: fresh water, 4-connected, one level.
    for (i = 0; i < n; i++) {
      if (!fresh[i] || body[i] >= 0) continue;
      b = { out: false, inl: false, drop: 0, dmin: 1e9, dmaxOut: 0 };
      bodies.push(b);
      head = 0;
      tail = 0;
      body[i] = bodies.length - 1;
      queue[tail++] = i;
      while (head < tail) {
        c = queue[head++];
        x = c % W;
        y = (c / W) | 0;
        for (k = 0; k < 4; k++) {
          px = x + N4X[k];
          py = y + N4Y[k];
          if (px < 0 || py < 0 || px >= W || py >= H) continue;
          pi = py * W + px;
          if (!fresh[pi] || body[pi] >= 0 || level[pi] !== level[c]) continue;
          body[pi] = body[c];
          queue[tail++] = pi;
        }
      }
    }

    // 2. Outlets (lower water, the sea, the map edge) and inlets (higher
    //    fresh water) of every fresh tile.
    for (i = 0; i < n; i++) {
      if (!fresh[i]) continue;
      x = i % W;
      y = (i / W) | 0;
      for (k = 0; k < 4; k++) {
        var drop = -1;
        px = x + N4X[k];
        py = y + N4Y[k];
        if (px < 0 || py < 0 || px >= W || py >= H) {
          drop = 1;
        } else {
          pi = py * W + px;
          if (water[pi] && (!fresh[pi] || level[pi] < level[i])) drop = Math.max(0, level[i] - level[pi]);
          if (fresh[pi] && level[pi] > level[i]) isIn[i] = 1;
        }
        if (drop < 0) continue;
        isOut[i] = 1;
        outX[i] += N4X[k];
        outY[i] += N4Y[k];
        if (drop > dropAt[i]) dropAt[i] = drop;
      }
    }
    bodyDistance(W, H, body, isOut, dOut, queue);
    bodyDistance(W, H, body, isIn, dIn, queue);
    for (i = 0; i < n; i++) {
      if (!fresh[i]) continue;
      b = bodies[body[i]];
      if (isOut[i]) { b.out = true; b.drop = Math.max(b.drop, dropAt[i]); }
      if (isIn[i]) b.inl = true;
      if (dOut[i] > b.dmaxOut) b.dmaxOut = dOut[i];
      if (dIn[i] >= 0 && dOut[i] >= 0 && dIn[i] + dOut[i] < b.dmin) b.dmin = dIn[i] + dOut[i];
    }

    // 3. Bodies with an outlet: down dOut, along the inlet -> outlet path.
    for (i = 0; i < n; i++) {
      if (!fresh[i]) continue;
      b = bodies[body[i]];
      if (!b.out) continue;
      var sx = 0;
      var sy = 0;
      x = i % W;
      y = (i / W) | 0;
      if (isOut[i]) {
        sx = outX[i];
        sy = outY[i];
      } else {
        for (k = 0; k < 4; k++) {
          px = x + N4X[k];
          py = y + N4Y[k];
          if (px < 0 || py < 0 || px >= W || py >= H) continue;
          pi = py * W + px;
          if (body[pi] === body[i] && dOut[pi] >= 0 && dOut[pi] < dOut[i]) { sx += N4X[k]; sy += N4Y[k]; }
        }
      }
      var sl = Math.sqrt(sx * sx + sy * sy);
      if (sl < 1e-6) continue;
      var run = (b.inl ? b.dmin : b.dmaxOut) + 1;
      var slope = Math.min(2, b.drop / run);
      var w;
      if (b.inl && dIn[i] >= 0) w = Math.max(0, 1 - (dIn[i] + dOut[i] - b.dmin) / PATH_WIDTH);
      else w = biome[i] === RIVER ? 1 : Math.max(0, 1 - dOut[i] / (PATH_WIDTH + 2));
      if (biome[i] !== RIVER) {
        var near = Math.min(dOut[i], b.inl && dIn[i] >= 0 ? dIn[i] : 1e9);
        w *= Math.max(0, Math.min(1, 1 - (near - LAKE_REACH) / 2));
      }
      var s = (SPEED_FLAT + SPEED_PER_SLOPE * slope) * w;
      if (s < MIN_SPEED) continue;
      dx[i] = sx / sl;
      dy[i] = sy / sl;
      speed[i] = s;
      tile[i] = biome[i] === RIVER ? 1 : 2;
    }

    // 4. Bodies with no outlet: their river tiles keep the generator's own
    //    downhill step (centrelines), copied across the widened bed.
    head = 0;
    tail = 0;
    for (i = 0; i < n; i++) {
      if (!fresh[i] || bodies[body[i]].out || biome[i] !== RIVER || !gflow[i]) continue;
      var gl = Math.sqrt(DIR_X[gflow[i]] * DIR_X[gflow[i]] + DIR_Y[gflow[i]] * DIR_Y[gflow[i]]);
      dx[i] = DIR_X[gflow[i]] / gl;
      dy[i] = DIR_Y[gflow[i]] / gl;
      speed[i] = SPEED_FLAT;
      tile[i] = 1;
      queue[tail++] = i;
    }
    while (head < tail) {
      c = queue[head++];
      x = c % W;
      y = (c / W) | 0;
      for (k = 0; k < 4; k++) {
        px = x + N4X[k];
        py = y + N4Y[k];
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        pi = py * W + px;
        if (tile[pi] || biome[pi] !== RIVER || body[pi] !== body[c]) continue;
        dx[pi] = dx[c];
        dy[pi] = dy[c];
        speed[pi] = SPEED_FLAT;
        tile[pi] = 1;
        queue[tail++] = pi;
      }
    }

    // 5. Lips run over their drop; the landing below remembers the push.
    for (i = 0; i < n; i++) {
      if (falls[i] !== 1 || !fresh[i]) continue;
      x = i % W;
      y = (i / W) | 0;
      var best = -1;
      var bestDrop = MIN_DROP - 1;
      for (k = 0; k < 4; k++) {
        px = x + N4X[k];
        py = y + N4Y[k];
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        pi = py * W + px;
        if (!water[pi] || level[i] - level[pi] <= bestDrop) continue;
        bestDrop = level[i] - level[pi];
        best = k;
      }
      if (best < 0) continue;
      dx[i] = N4X[best];
      dy[i] = N4Y[best];
      speed[i] = SPEED_LIP;
      tile[i] = tile[i] || (biome[i] === RIVER ? 1 : 2);
      fixed[i] = 1;
      var li = (y + N4Y[best]) * W + x + N4X[best];
      fallX[li] += N4X[best];
      fallY[li] += N4Y[best];
    }

    // 6. Plunge pools: water of the landing's body within POOL_REACH of
    //    it spreads out from the foot of the fall and churns.
    poolDist.fill(-1);
    head = 0;
    tail = 0;
    for (i = 0; i < n; i++) if (falls[i] === 2 && fresh[i]) { poolDist[i] = 0; queue[tail++] = i; }
    while (head < tail) {
      c = queue[head++];
      if (poolDist[c] >= POOL_REACH) continue;
      x = c % W;
      y = (c / W) | 0;
      for (k = 0; k < 4; k++) {
        px = x + N4X[k];
        py = y + N4Y[k];
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        pi = py * W + px;
        if (poolDist[pi] >= 0 || body[pi] !== body[c]) continue;
        poolDist[pi] = poolDist[c] + 1;
        queue[tail++] = pi;
      }
    }
    for (i = 0; i < n; i++) {
      if (poolDist[i] < 0) continue;
      var reach = 1 - poolDist[i] / (POOL_REACH + 1);
      foam[i] = reach;
      if (!fixed[i] && poolDist[i] === 0) {
        // The landing: its body's current plus the push of the fall.
        var lvx = dx[i] * speed[i] + fallX[i] * 0.8;
        var lvy = dy[i] * speed[i] + fallY[i] * 0.8;
        var lvl = Math.sqrt(lvx * lvx + lvy * lvy);
        if (lvl > 1e-6) { dx[i] = lvx / lvl; dy[i] = lvy / lvl; }
      } else if (!fixed[i]) {
        // Away from the nearest landing, on in the direction it fell, and
        // with whatever current already runs here.
        x = i % W;
        y = (i / W) | 0;
        var rx = 0;
        var ry = 0;
        var fx = 0;
        var fy = 0;
        var bestD = 1e9;
        for (oy = -POOL_REACH; oy <= POOL_REACH; oy++) {
          for (ox = -POOL_REACH; ox <= POOL_REACH; ox++) {
            lx = x + ox;
            ly = y + oy;
            if (lx < 0 || ly < 0 || lx >= W || ly >= H) continue;
            lj = ly * W + lx;
            if (poolDist[lj] !== 0 || body[lj] !== body[i]) continue;
            var d2 = ox * ox + oy * oy;
            if (d2 < bestD) { bestD = d2; rx = -ox; ry = -oy; fx = fallX[lj]; fy = fallY[lj]; }
          }
        }
        var rl = Math.sqrt(rx * rx + ry * ry) || 1;
        var vx0 = rx / rl + fx * 0.6 + dx[i] * speed[i];
        var vy0 = ry / rl + fy * 0.6 + dy[i] * speed[i];
        var vl = Math.sqrt(vx0 * vx0 + vy0 * vy0);
        if (vl > 1e-6) { dx[i] = vx0 / vl; dy[i] = vy0 / vl; }
      }
      if (dx[i] || dy[i]) {
        speed[i] = Math.max(speed[i], SPEED_POOL * reach);
        tile[i] = tile[i] || (biome[i] === RIVER ? 1 : 2);
      }
    }

    // 7. Two passes of 3x3 smoothing within each body (fixed tiles stay).
    var baseX = Float32Array.from(dx);
    var baseY = Float32Array.from(dy);
    var tx = new Float32Array(n);
    var ty = new Float32Array(n);
    for (var pass = 0; pass < 2; pass++) {
      tx.set(dx);
      ty.set(dy);
      for (i = 0; i < n; i++) {
        if (!tile[i] || fixed[i]) continue;
        x = i % W;
        y = (i / W) | 0;
        var ax = dx[i];
        var ay = dy[i];
        for (oy = -1; oy <= 1; oy++) {
          for (ox = -1; ox <= 1; ox++) {
            lx = x + ox;
            ly = y + oy;
            if ((!ox && !oy) || lx < 0 || ly < 0 || lx >= W || ly >= H) continue;
            lj = ly * W + lx;
            if (!tile[lj] || body[lj] !== body[i]) continue;
            ax += dx[lj] * 0.5;
            ay += dy[lj] * 0.5;
          }
        }
        var al = Math.sqrt(ax * ax + ay * ay);
        if (al > 1e-6) { tx[i] = ax / al; ty[i] = ay / al; }
      }
      dx.set(tx);
      dy.set(ty);
    }

    // 7b. Never into a bank or up a step: the part of the current that runs
    //     at land or at higher water across an edge is removed (it follows
    //     the bank instead). If too little is left, the unsmoothed direction
    //     gets the same treatment; if that fails too, the tile is still.
    function intoWall(j, vx, vy, out) {
      var jx = j % W;
      var jy = (j / W) | 0;
      out[0] = vx;
      out[1] = vy;
      for (var q = 0; q < 4; q++) {
        var nx = jx + N4X[q];
        var ny = jy + N4Y[q];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        var nj = ny * W + nx;
        if (water[nj] && level[nj] <= level[j]) continue;
        var dot = out[0] * N4X[q] + out[1] * N4Y[q];
        if (dot > 0) { out[0] -= N4X[q] * dot; out[1] -= N4Y[q] * dot; }
      }
      return Math.sqrt(out[0] * out[0] + out[1] * out[1]);
    }
    var pv = [0, 0];
    for (i = 0; i < n; i++) {
      if (!tile[i] || fixed[i]) continue;
      var pl = intoWall(i, dx[i], dy[i], pv);
      if (pl < 0.3) pl = intoWall(i, baseX[i], baseY[i], pv);
      if (pl < 0.3) {
        // Boxed in. Under a fall it still churns in place (the two pattern
        // layers cross-fade without moving); elsewhere it is still water.
        if (!foam[i]) tile[i] = 0;
        speed[i] = 0;
        dx[i] = dy[i] = 0;
        continue;
      }
      dx[i] = pv[0] / pl;
      dy[i] = pv[1] / pl;
    }

    // 8. Corners.
    var CW = W + 1;
    var corner = new Uint8Array(CW * (H + 1) * 4);
    for (y = 0; y <= H; y++) {
      for (x = 0; x <= W; x++) {
        var cvx = 0;
        var cvy = 0;
        var cnt = 0;
        var cfoam = 0;
        var still = false;
        var bank = false;
        for (k = 0; k < 4; k++) {
          var cx = x - 1 + (k & 1);
          var cy = y - 1 + (k >> 1);
          if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
          var cj = cy * W + cx;
          if (tile[cj]) {
            cvx += dx[cj] * speed[cj];
            cvy += dy[cj] * speed[cj];
            cfoam = Math.max(cfoam, foam[cj]);
            cnt++;
          } else if (water[cj]) {
            still = true;
          } else {
            bank = true;
          }
        }
        var o = (y * CW + x) * 4;
        if (!cnt) {
          corner[o] = corner[o + 1] = 128;
          continue;
        }
        var f = still ? 0 : (bank ? BANK : 1) / cnt;
        corner[o] = encode(cvx * f);
        corner[o + 1] = encode(cvy * f);
        corner[o + 2] = Math.round(Math.min(1, cfoam) * 255);
        corner[o + 3] = 255;
      }
    }

    return {
      width: W,
      height: H,
      tile: tile,
      dx: dx,
      dy: dy,
      speed: speed,
      foam: foam,
      body: body,
      corner: corner
    };
  }

  function encode(v) {
    return Math.max(1, Math.min(255, Math.round(128 + 127 * v / VMAX)));
  }

  function decode(b) {
    return (b - 128) / 127 * VMAX;
  }

  /* Fragment GLSL for the RIVER variant of the terrain shader
   * (voxel3d.js). Needs `vRiverPos` (world x/z, highp), `uTime`,
   * `uFlowMap` (the corner texture, linear), `uFlowMapSize` ((W+1, H+1)),
   * `uFoamColor`. `riverFlow(base)` returns the water colour with the
   * advected pattern: quarter-tile specks of foam (more where it runs fast
   * or churns under a fall) and half-tile ripples a few percent lighter or
   * darker, two layers half a cycle apart, cross-faded. Blocky like the
   * voxels; specks slide, they are never split from the voxel grid by
   * geometry. A tile with no velocity shows its plain colour. */
  var PERIOD = 1.2;            // seconds per flow-map cycle
  var GLSL = [
    'float flowHash(highp vec2 p) {',
    '  highp vec3 p3 = fract(vec3(p.xyx) * 0.1031);',
    '  p3 += dot(p3, p3.yzx + 33.33);',
    '  return fract((p3.x + p3.y) * p3.z);',
    '}',
    'vec3 riverFlow(vec3 base) {',
    '  // Corner coordinates: the mesh is centred, corners are integers.',
    '  highp vec2 rp = vRiverPos + (uFlowMapSize - 1.0) * 0.5;',
    '  // One velocity per quarter-tile block of the surface: inside a block',
    '  // the pattern slides rigidly, so its specks stay square (a per-',
    '  // fragment velocity shears them into slivers wherever the current',
    '  // speeds up or turns), and block edges stay on the voxel grid.',
    '  highp vec2 blockPos = (floor(rp * 4.0) + 0.5) / 4.0;',
    '  vec4 fm = texture(uFlowMap, (blockPos + 0.5) / uFlowMapSize);',
    '  highp vec2 vel = (fm.xy * 255.0 - 128.0) / 127.0 * ' + glslFloat(VMAX) + ';',
    '  float spd = clamp(length(vel) / ' + glslFloat(VMAX) + ', 0.0, 1.0);',
    '  highp float cyc = uTime / ' + glslFloat(PERIOD) + ';',
    '  highp float ph0 = fract(cyc);',
    '  highp float ph1 = fract(cyc + 0.5);',
    '  // Layer A is invisible exactly when it snaps back (ph0 = 0), B the',
    '  // same half a cycle later.',
    '  float wA = 1.0 - abs(1.0 - 2.0 * ph0);',
    '  // The travel is rounded to whole quarter tiles: the pattern steps from',
    '  // block to block (a hand-animated look, like the wind lines), so a',
    '  // speck always fills exactly one block and is never cut into slivers.',
    '  highp vec2 uvA = rp - floor(vel * (ph0 * ' + glslFloat(PERIOD * 4) + ') + 0.5) / 4.0;',
    '  highp vec2 uvB = rp - floor(vel * (ph1 * ' + glslFloat(PERIOD * 4) + ') + 0.5) / 4.0 + vec2(0.25, 0.5);',
    '  float thr = mix(1.01, 0.80, spd) - 0.42 * fm.z;',
    '  float speck = mix(step(thr, flowHash(floor(uvB * 4.0) + 19.0)),',
    '    step(thr, flowHash(floor(uvA * 4.0))), wA);',
    '  float ripple = mix(flowHash(floor(uvB * 2.0) + 53.0),',
    '    flowHash(floor(uvA * 2.0) + 7.0), wA) - 0.5;',
    '  vec3 c = base * (1.0 + 0.16 * ripple * min(1.0, spd * 2.5));',
    '  return mix(c, uFoamColor, 0.62 * speck);',
    '}'
  ].join('\n');

  function glslFloat(value) {
    var text = String(value);
    return text.indexOf('.') < 0 ? text + '.0' : text;
  }

  SM.RiverFlow = {
    field: field,
    encode: encode,
    decode: decode,
    GLSL: GLSL,
    VMAX: VMAX,
    PERIOD: PERIOD,
    POOL_REACH: POOL_REACH,
    PATH_WIDTH: PATH_WIDTH,
    LAKE_REACH: LAKE_REACH,
    SPEED_FLAT: SPEED_FLAT,
    SPEED_LIP: SPEED_LIP,
    SPEED_POOL: SPEED_POOL,
    MIN_SPEED: MIN_SPEED
  };
})(window.SM = window.SM || {});
