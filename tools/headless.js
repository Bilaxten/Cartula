/* Headless harness — loads the browser SM modules under a fake `window` so the
 * generation pipeline can be exercised from node (Codex has no browser/canvas).
 *
 *   node tools/headless.js [seed] [size] [seaLevel]
 *   node tools/headless.js --sweep      # sea-level sweep, island-count check
 *   node tools/headless.js --mesh       # voxel mesh integrity and determinism
 *   node tools/headless.js --river      # river brush channel planning (M3)
 *   node tools/headless.js --edit       # brush re-derivation: fresh water, levels
 *   node tools/headless.js --export     # Unity bundle: r16 heightmap, json, zip
 *   node tools/headless.js --sky        # cloud drift, cloud shadow, flock (M4)
 *   node tools/headless.js --shaders    # GLSL cross-stage declaration lint
 *   node tools/headless.js --falls      # voxel waterfall face tagging/rendering
 *   node tools/headless.js --worldtypes # world type preset validity + effect
 *   node tools/headless.js --i18n       # UI language: tr/en key parity, index.html hooks
 *   node tools/headless.js --perf       # perf panel: stats math, GL counter, no uncounted draws
 *   node tools/headless.js --night      # night lights: settlement-only flag, night curve, grade
 *   node tools/headless.js --wind       # wind lines: terrain-steered field, bounded stateless streaks
 *   node tools/headless.js --weather    # rain/snow: biome rules, bounded, deterministic per seed
 *   node tools/headless.js --layout     # side panel toggle, phone layout, touch pinch/pan math
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'src');
const win = {};
global.window = win;
global.performance = { now: () => Number(process.hrtime.bigint()) / 1e6 };

for (const f of ['noise.js', 'grid.js', 'biome.js', 'huts.js', 'generate.js',
                 'perf.js', 'render/topdown.js', 'render/sky.js', 'render/post.js', 'render/wind.js', 'render/weather.js',
                 'render/voxel3d.js', 'time.js', 'worldtypes.js', 'export.js', 'i18n.js', 'touch.js']) {
  const code = fs.readFileSync(path.join(root, f), 'utf8');
  // Stripping the canvas renderer of its getContext calls is unnecessary --
  // we simply never call renderTopDown here.
  (0, eval)(code + '\n//# sourceURL=' + f);
}
const SM = win.SM;

function countIslands(grid) {
  const w = grid.width, h = grid.height, n = w * h;
  const seen = new Uint8Array(n);
  const sizes = [];
  for (let i = 0; i < n; i++) {
    if (seen[i] || grid.water[i]) continue;
    let q = [i], head = 0, size = 0;
    seen[i] = 1;
    while (head < q.length) {
      const c = q[head++]; size++;
      const x = c % w, y = (c / w) | 0;
      const nb = [x > 0 ? c - 1 : -1, x < w - 1 ? c + 1 : -1,
                  y > 0 ? c - w : -1, y < h - 1 ? c + w : -1];
      for (const ni of nb) if (ni >= 0 && !seen[ni] && !grid.water[ni]) { seen[ni] = 1; q.push(ni); }
    }
    sizes.push(size);
  }
  sizes.sort((a, b) => b - a);
  return sizes;
}

function biomeHistogram(grid) {
  const c = {};
  for (let i = 0; i < grid.biome.length; i++) {
    const id = SM.BIOME_LIST[grid.biome[i]].id;
    c[id] = (c[id] || 0) + 1;
  }
  return c;
}

function towers(grid) {
  const w = grid.width, h = grid.height;
  let t = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, L = grid.level[i];
    if (grid.water[i] || L <= 1) continue;
    let mN = -9;
    if (x > 0) mN = Math.max(mN, grid.level[i - 1]);
    if (x < w - 1) mN = Math.max(mN, grid.level[i + 1]);
    if (y > 0) mN = Math.max(mN, grid.level[i - w]);
    if (y < h - 1) mN = Math.max(mN, grid.level[i + w]);
    if (L > mN + 1) t++;
  }
  return t;
}

function run(seed, size, sea) {
  const t0 = performance.now();
  const grid = SM.generate({ seed, width: size, height: size, seaLevel: sea });
  const dt = performance.now() - t0;
  const s = SM.summarize(grid);
  const isl = countIslands(grid);
  const hist = biomeHistogram(grid);
  let water = 0, roadTiles = 0, bridges = 0, builtup = 0;
  let waterfallTiles = 0, waterfallDrops = 0;
  for (let i = 0; i < grid.water.length; i++) {
    if (grid.water[i]) water++;
    if (grid.roads && grid.roads[i]) roadTiles++;
    if (grid.roads && grid.roads[i] === 2) bridges++;
    if (grid.builtup && grid.builtup[i]) builtup++;
    if (grid.waterfalls && grid.waterfalls[i]) waterfallTiles++;
    if (grid.waterfallDrop && grid.waterfallDrop[i] > 0) waterfallDrops++;
  }
  return {
    seed, size, sea, dt: +dt.toFixed(1),
    landPct: s.landPct, waterPct: Math.round(water / grid.biome.length * 100),
    islands: isl.length, islandTop5: isl.slice(0, 5),
    towers: towers(grid),
    settlements: (grid.settlements || []).length,
    settlementSizes: (grid.settlements || []).map(s => s.size),
    builtup, roadTiles, bridges,
    labels: (grid.labels || []).length,
    waterfallTiles, waterfallDrops,
    fluidSpread: grid.fluidSpread || { water: 0, lava: 0, pooled: 0 },
    biomes: hist, grid
  };
}

function typedEqual(a, b) {
  return a.byteLength === b.byteLength &&
    Buffer.from(a.buffer, a.byteOffset, a.byteLength)
      .equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
}

function flatMeshCheck() {
  const W = 5, H = 4, n = W * H;
  const level = new Int8Array(n);
  const water = new Uint8Array(n);
  const biome = new Uint8Array(n);
  const moisture = new Float32Array(n);
  const elevation = new Float32Array(n);
  level.fill(2);
  biome.fill(SM.BIOME_IDX.grassland);
  moisture.fill(0.5);
  elevation.fill(0.5);
  const mesh = SM.buildVoxelMesh({
    width: W, height: H, level, water, biome, moisture, elevation,
    config: { waterDepth: 3, levels: 10 }
  });
  // Terrain: WH tops + its perimeter walls. Border: its top ring + exterior
  // base walls. The flat interior consequently contributes no side quads.
  const expectedQuads = W * H + (2 * W + 2 * H) +
    (2 * W + 2 * H + 4) + (2 * W + 2 * H + 8) + 1;
  return mesh.triangleCount === expectedQuads * 2;
}

function makeFlatGrid(W, H, fill) {
  const n = W * H;
  const level = new Int8Array(n);
  const water = new Uint8Array(n);
  const biome = new Uint8Array(n);
  const moisture = new Float32Array(n);
  const elevation = new Float32Array(n);
  level.fill(fill);
  biome.fill(SM.BIOME_IDX.grassland);
  moisture.fill(0.5);
  elevation.fill(0.5);
  return {
    width: W, height: H, level, water, biome, moisture, elevation,
    config: { waterDepth: 3, levels: 10 }
  };
}

function runShadowChecks() {
  const sun = { dx: 1, dy: 0, rise: 0.12, strength: 0.42 };
  const flat = makeFlatGrid(9, 9, 2);
  const a = SM.buildShadowMap(flat, sun);
  const b = SM.buildShadowMap(flat, sun);
  const high = makeFlatGrid(9, 9, 2);
  high.level[4 * high.width + 4] = 8;
  const cast = SM.buildShadowMap(high, sun);
  const typeAndLength = a instanceof Uint8Array && a.length === flat.width * flat.height;
  const range = Array.prototype.every.call(a, v => v >= 0 && v <= 255);
  const deterministic = typedEqual(a, b);
  const flatClear = Array.prototype.every.call(a, v => v === 0);
  const castShadow = Array.prototype.some.call(cast, v => v > 0);
  // Direction. `sun.dx = 1` is light travelling east: the renderer lights the
  // WEST faces (setSun hands Lambert the vector towards the light, -dx), so
  // the column's shadow must lie EAST of it, and a cloud's shadow must slide
  // east too. Before 2026-10-05 the shadow map marched the other way and the
  // terrain shadow fell under the lit face, against the cloud shadows.
  let east = 0, west = 0;
  for (let i = 0; i < cast.length; i++) {
    if (!cast[i]) continue;
    if (i % high.width > 4) east++; else west++;
  }
  const bounds = { minX: -4.5, maxX: 4.5, minY: 0, maxY: 8, minZ: -4.5, maxZ: 4.5 };
  const towardsLight = [-sun.dx, 0.5, -sun.dy];
  const cloud = SM.Sky.cloudShadowUniforms(
    [{ x: 0, y: 4, z: 0, radius: 1 }], bounds, towardsLight);
  const downLight = east > 0 && west === 0 && cloud[0] > 0.5;
  return [
    ['cast shadow falls down-light, the same way as the cloud shadow', downLight],
    ['shadow map type, length, and range', typeAndLength && range],
    ['shadow determinism', deterministic],
    ['flat grid has no cast shadow', flatClear],
    ['high column casts a shadow', castShadow]
  ];
}

function raisedColumnAffectsNeighbourAO() {
  const W = 7, H = 7, lowLevel = 2, highX = 3, highY = 3;
  const high = makeFlatGrid(W, H, lowLevel);
  const westEdge = highX - W / 2;
  const eastEdge = highX + 1 - W / 2;
  const northEdge = highY - H / 2;
  const southEdge = highY + 1 - H / 2;
  const edges = [
    [0, westEdge], [0, eastEdge], [2, northEdge], [2, southEdge]
  ];

  high.level[highY * W + highX] = 6;
  const raisedMesh = SM.buildVoxelMesh(high);
  for (const edge of edges) {
    let found = false;
    for (let i = 0; i < raisedMesh.vertexCount; i++) {
      const p = i * 3;
      if (raisedMesh.normals[p + 1] !== 1 ||
          raisedMesh.positions[p + 1] !== lowLevel) continue;
      if (raisedMesh.positions[p + edge[0]] !== edge[1]) continue;
      if (raisedMesh.ao[i] < 3) found = true;
    }
    if (!found) return false;
  }
  return true;
}

// Animated water only DIPS below its rest level, by up to SM.VOXEL_WAVE_DIP
// (vertex shader). Every edge of a water surface must therefore stay closed
// down to the trough, or the trough opens a slit through which the clear
// colour shows as a black sliver (owner report 2026-10-05: cliff bases).
// Per water tile and side:
//   - neighbour top at or above the surface (land, higher water, the plinth
//     ring): that neighbour's wall facing this tile reaches the trough;
//   - neighbour below: this tile's own wall exists and its rim vertices ride
//     the surface (water flag 1), so the rim never pokes above the water;
//   - water at the same level: nothing -- one continuous wave moves both.
/* Terrain-following waves (2026-10-05): the swell is a per-corner field, so
 * (1) every vertex at one position reads the same corner bytes (shared edges
 * move together), (2) the amplitude is 0 where water touches land, (3) the
 * phase is k * distance + bounded noise (crests run toward the coast), (4)
 * open sea is calm and the band just off the shore is not, (5) a tile's
 * centre value (shading, foam) is flat across its top. */
function terrainWaveChecks(grid, mesh) {
  const W = grid.width, H = grid.height, CW = W + 1;
  const f = SM.voxelWaveField(grid);
  const out = [];
  const byPos = new Map();
  let shared = 0, sharedBad = 0, shoreBad = 0, flatBad = 0;
  for (let v = 0; v < mesh.vertexCount; v++) {
    if (!mesh.water[v]) continue;
    const key = mesh.positions[v * 3] + ',' + mesh.positions[v * 3 + 1] + ',' + mesh.positions[v * 3 + 2];
    const val = mesh.wave[v * 4] * 256 + mesh.wave[v * 4 + 1];
    if (byPos.has(key)) { shared++; if (byPos.get(key) !== val) sharedBad++; } else byPos.set(key, val);
    const cx = Math.round(mesh.positions[v * 3] + W / 2), cy = Math.round(mesh.positions[v * 3 + 2] + H / 2);
    let land = false;
    for (let k = 0; k < 4; k++) {
      const x = cx - 1 + (k & 1), y = cy - 1 + (k >> 1);
      if (x >= 0 && y >= 0 && x < W && y < H && !grid.water[y * W + x]) land = true;
    }
    if (land && mesh.wave[v * 4 + 1] !== 0) shoreBad++;
  }
  for (let q = 0; q < mesh.vertexCount; q += 4) {
    if (!mesh.water[q] || mesh.normals[q * 3 + 1] !== 1) continue;
    for (let k = 1; k < 4; k++) {
      if (mesh.wave[(q + k) * 4 + 2] !== mesh.wave[q * 4 + 2] || mesh.wave[(q + k) * 4 + 3] !== mesh.wave[q * 4 + 3]) flatBad++;
    }
  }
  out.push([`waves: ${shared} shared water vertices read identical corner phase+amplitude (${sharedBad} differ)`,
    shared > 1000 && sharedBad === 0]);
  out.push([`waves: amplitude 0 wherever the water touches land (${shoreBad} exceptions)`, shoreBad === 0]);
  out.push([`waves: tile shade/foam value is flat across each water top (${flatBad} exceptions)`, flatBad === 0]);
  let noiseMax = 0, lip = 0, nearSum = 0, nearN = 0, farSum = 0, farN = 0;
  for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) {
    const c = y * CW + x, d = f.cornerDist[c];
    noiseMax = Math.max(noiseMax, Math.abs(f.cornerPhase[c] - SM.VOXEL_WAVE_K * d));
    if (x < W) lip = Math.max(lip, Math.abs(d - f.cornerDist[c + 1]));
    if (y < H) lip = Math.max(lip, Math.abs(d - f.cornerDist[c + CW]));
    if (d > 1.2 && d < 2.5) { nearSum += f.cornerAmp[c]; nearN++; }
    if (d > 16) { farSum += f.cornerAmp[c]; farN++; }
  }
  out.push([`waves: phase = k * distance to land + noise within ${noiseMax.toFixed(2)} rad (crests run shoreward); ` +
    `distance changes <= ${lip.toFixed(2)} per corner step`, noiseMax <= 1.31 && lip <= 1.5]);
  out.push([`waves: swell near the shore (mean amplitude ${(nearSum / nearN).toFixed(2)}, ${nearN} corners) ` +
    `vs calm open sea (${farN ? (farSum / farN).toFixed(2) : '-'}, ${farN} corners)`,
    nearN > 100 && nearSum / nearN > 0.85 && (!farN || farSum / farN < 0.2)]);
  {
    // An island world has real open sea: there it must be calm.
    const g2 = SM.generate({ seed: 4242, width: 160, height: 160, seaLevel: 0.6, islandFalloff: 1 });
    const f2 = SM.voxelWaveField(g2);
    let s2 = 0, n2 = 0;
    for (let c = 0; c < f2.cornerDist.length; c++) if (f2.cornerDist[c] > 16) { s2 += f2.cornerAmp[c]; n2++; }
    out.push([`waves: island world (seed 4242, 160², sea 0.6): open sea calm (mean amplitude ` +
      `${n2 ? (s2 / n2).toFixed(2) : '-'}, ${n2} corners beyond 16 tiles)`, n2 > 200 && s2 / n2 < 0.2]);
  }
  let mono = true;
  for (let d = 0; d < 30; d += 0.25) {
    if (d >= 2.5 && SM.voxelWaveAmplitude(d + 0.25) > SM.voxelWaveAmplitude(d) + 1e-9) mono = false;
  }
  out.push(['waves: amplitude 0 at the water line, eases in within a tile, decays out to sea',
    SM.voxelWaveAmplitude(0) === 0 && SM.voxelWaveAmplitude(1) > 0.95 && mono &&
    SM.voxelWaveAmplitude(30) > 0.1 && SM.voxelWaveAmplitude(30) < 0.15]);
  return out;
}

function waveSkirtCheck(grid, mesh) {
  const W = grid.width, H = grid.height, level = grid.level;
  const DIP = SM.VOXEL_WAVE_DIP || 0.072;
  const walls = new Map();
  const quads = mesh.vertexCount / 4;
  for (let q = 0; q < quads; q++) {
    const v = q * 4, nx = mesh.normals[v * 3], nz = mesh.normals[v * 3 + 2];
    if (mesh.normals[v * 3 + 1] !== 0) continue;
    let plane = null, span = Infinity, minY = Infinity, maxY = -Infinity;
    for (let k = 0; k < 4; k++) {
      const p = (v + k) * 3;
      plane = nx ? mesh.positions[p] : mesh.positions[p + 2];
      span = Math.min(span, nx ? mesh.positions[p + 2] : mesh.positions[p]);
      minY = Math.min(minY, mesh.positions[p + 1]);
      maxY = Math.max(maxY, mesh.positions[p + 1]);
    }
    walls.set(`${nx}|${nz}|${plane}|${span}`, { v, minY, maxY });
  }
  const trough = L => Math.fround(L - DIP);
  let holes = 0, rims = 0, edges = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!grid.water[i]) continue;
      const L = level[i];
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const ox = x + dx, oy = y + dy;
        const inside = ox >= 0 && oy >= 0 && ox < W && oy < H;
        // Off the map the neighbour is the plinth ring, flush with this tile.
        const T = inside ? level[oy * W + ox] : Math.max(0, L);
        if (inside && grid.water[oy * W + ox] && T === L) continue;
        edges++;
        const plane = dx ? x - W / 2 + (dx > 0 ? 1 : 0) : y - H / 2 + (dy > 0 ? 1 : 0);
        const span = dx ? y - H / 2 : x - W / 2;
        if (T >= L) {
          const w = walls.get(`${-dx}|${-dy}|${plane}|${span}`);
          if (!w || w.minY > trough(L) || w.maxY < L) holes++;
        } else {
          const w = walls.get(`${dx}|${dy}|${plane}|${span}`);
          let ok = !!w;
          for (let k = 0; ok && k < 4; k++) {
            const vy = mesh.positions[(w.v + k) * 3 + 1];
            if (vy === L && mesh.water[w.v + k] !== 1) ok = false;
          }
          if (!ok) rims++;
        }
      }
    }
  }
  return { ok: holes === 0 && rims === 0 && edges > 0, holes, rims, edges };
}

function runMeshChecks() {
  const a = run(1337, 192, 0.38).grid;
  const t0 = performance.now();
  const mesh = SM.buildVoxelMesh(a);
  const buildMs = performance.now() - t0;
  const shadowStart = performance.now();
  const shadow = SM.buildShadowMap(a, {
    dx: 0.5, dy: -0.7, rise: 1.1, strength: 0.4
  });
  const shadowMs = performance.now() - shadowStart;
  const b = run(1337, 192, 0.38).grid;
  const meshB = SM.buildVoxelMesh(b);
  const attributes = [
    mesh.positions,
    mesh.normals,
    mesh.colors,
    mesh.sideDepth,
    mesh.cellUV,
    mesh.emissive,
    mesh.water,
    mesh.shore,
    mesh.ao
  ];
  const finite = attributes.every(arr => Array.prototype.every.call(arr, Number.isFinite));
  const indices = Array.prototype.every.call(mesh.indices, i => i < mesh.vertexCount);
  const flat = flatMeshCheck();
  const deterministic = typedEqual(mesh.positions, meshB.positions) &&
    typedEqual(mesh.colors, meshB.colors) &&
    typedEqual(mesh.cellUV, meshB.cellUV) &&
    typedEqual(mesh.emissive, meshB.emissive) &&
    typedEqual(mesh.water, meshB.water) &&
    typedEqual(mesh.shore, meshB.shore);
  const waterFlags = mesh.water.length === mesh.vertexCount &&
    Array.prototype.every.call(mesh.water, value => value === 0 || value === 1);
  // Flagged = rides the wave: a water tile's top face, or the rim (upper
  // edge, at the tile's own level) of one of its walls. Never land, never a
  // wall's lower edge.
  const waterOnSurfaces = Array.prototype.every.call(mesh.water, (value, i) => {
    if (!value) return true;
    const uv = i * 2;
    const x = Math.floor(mesh.cellUV[uv] * a.width);
    const y = Math.floor(mesh.cellUV[uv + 1] * a.height);
    const cell = y * a.width + x;
    if (!a.water[cell]) return false;
    if (mesh.normals[i * 3 + 1] === 1) return true;
    return mesh.normals[i * 3 + 1] === 0 &&
      mesh.positions[i * 3 + 1] === a.level[cell];
  });
  const skirts = waveSkirtCheck(a, mesh);
  const shoreRange = mesh.shore.length === mesh.vertexCount &&
    Array.prototype.every.call(mesh.shore, value => value >= 0 && value <= 1);
  const shoreDeterministic = typedEqual(mesh.shore, meshB.shore);
  const aoRange = mesh.ao.length === mesh.vertexCount &&
    Array.prototype.every.call(mesh.ao, value =>
      value >= 0 && value <= 3 && Number.isInteger(value));
  const aoDeterministic = typedEqual(mesh.ao, meshB.ao);
  const flatAO = Array.prototype.every.call(
    SM.buildVoxelMesh(makeFlatGrid(5, 4, 2)).ao,
    value => value === 3
  );
  const aoResponse = raisedColumnAffectsNeighbourAO();
  const quadFlip = SM.shouldFlipVoxelQuad(3, 1, 2, 0) &&
    !SM.shouldFlipVoxelQuad(1, 3, 0, 2) &&
    !SM.shouldFlipVoxelQuad(2, 2, 2, 2);
  const cellUV = mesh.cellUV.length === mesh.vertexCount * 2 &&
    Array.prototype.every.call(mesh.cellUV, uv => uv >= 0 && uv <= 1);
  // Baseline moves only with an intentional terrain change. 124034 → 124392:
  // 09-15 fixes 1-4 (`46d6e71` climate band, `5fb00d9` fresh-water levels) both
  // reshaped the mesh and the number went stale unnoticed because --mesh was not
  // in checks.sh. It is now. 124392 → 124430: river bed grading (tarama
  // 2026-09-22 #2, 2-level steps carved, one-tile pits filled). 124430 →
  // 123314: sea is one flat surface at level 0, depth drawn as colour.
  // 123314 → 124228: wave skirts (2026-10-05) -- a land column level with
  // the water and the plinth ring beside edge water each gain a skirt quad.
  // 124228 → 124708: three huts (src/huts.js, 2026-10-05), 160 triangles
  // each; the terrain itself is unchanged (124228 with grid.huts = []).
  const triangleCount = mesh.triangleCount === 124708 &&
    SM.buildVoxelMesh(Object.assign({}, a, { huts: [] })).triangleCount === 124228;
  const cameraHelpers = SM.VoxelCamera.wrapYaw(-30) === 330 &&
    SM.VoxelCamera.wrapYaw(400) === 40 &&
    SM.VoxelCamera.clampPitch(5) === 10 &&
    SM.VoxelCamera.clampPitch(95) === 89 &&
    SM.VoxelCamera.snapYaw(47) === 90 &&
    SM.VoxelCamera.snapYaw(44) === 0 &&
    SM.VoxelCamera.snapYaw(314) === 270 &&
    // 315..360 is the last half sector of 0, not of 270 (the old clamp).
    SM.VoxelCamera.snapYaw(316) === 0 &&
    SM.VoxelCamera.snapYaw(359.9) === 0;
  // Pan must keep the grabbed ground point under the cursor. Project the pan
  // vector back onto the camera's screen axes (the same basis mat4LookAt
  // builds): the target moves, so the terrain shifts by MINUS that on screen,
  // and that shift has to equal the drag in pixels, at any yaw and pitch.
  let panFollows = true;
  for (const [yaw, pitch] of [[45, 42], [200, 15], [310, 80]]) {
    const y = yaw * Math.PI / 180, p = pitch * Math.PI / 180;
    const zoom = 80, screenW = 1000, wpp = 2 * zoom / screenW;
    const right = [Math.sin(y), -Math.cos(y)];                       // screen +x on the ground
    const down = [Math.cos(y) * Math.sin(p), Math.sin(y) * Math.sin(p)]; // screen +y on the ground
    for (const [dx, dy] of [[30, 0], [0, 30], [-12, 25]]) {
      const v = SM.VoxelCamera.panVector(yaw, pitch, zoom, screenW, dx, dy);
      const shiftX = -(v.x * right[0] + v.z * right[1]) / wpp;
      const shiftY = -(v.x * down[0] + v.z * down[1]) / wpp;
      if (Math.abs(shiftX - dx) > 1e-6 || Math.abs(shiftY - dy) > 1e-6) panFollows = false;
    }
  }
  const clockWrap = SM.formatClock(6) === '06:00' &&
    SM.formatClock(26) === '02:00' &&
    SM.formatClock(29.5) === '05:30';
  const shadowChecks = runShadowChecks();
  // Shore foam: only on top faces of sea / lake tiles, and there exactly at
  // the corners that touch a land tile; never on rivers, walls or land.
  const foamCheck = (() => {
    const W = a.width, H = a.height;
    const LAKE = SM.BIOME_LIST.findIndex(b => b.id === 'lake');
    const land = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !a.water[y * W + x];
    let flagged = 0, bad = 0, missed = 0;
    if (!mesh.foam || mesh.foam.length !== mesh.vertexCount) return { ok: false, flagged, bad: -1, missed };
    for (let v = 0; v < mesh.vertexCount; v++) {
      const px = mesh.positions[v * 3], py = mesh.positions[v * 3 + 1], pz = mesh.positions[v * 3 + 2];
      const top = mesh.normals[v * 3 + 1] === 1;
      // A face is 4 consecutive vertices; its centre names its cell (a
      // plinth-ring top shares edge positions with the edge tiles).
      const q = v - (v % 4);
      let mx = 0, mz = 0;
      for (let k = 0; k < 4; k++) { mx += mesh.positions[(q + k) * 3] / 4; mz += mesh.positions[(q + k) * 3 + 2] / 4; }
      const x = Math.floor(mx + W / 2), y = Math.floor(mz + H / 2);
      const i = y * W + x;
      const ownTop = top && x >= 0 && y >= 0 && x < W && y < H && py === a.level[i];
      const foamTile = ownTop && a.water[i] && (SM.isSea(a, i) || a.biome[i] === LAKE);
      const cx = Math.round(px + W / 2), cy = Math.round(pz + H / 2);
      const want = foamTile && (land(cx - 1, cy - 1) || land(cx, cy - 1) || land(cx - 1, cy) || land(cx, cy)) ? 1 : 0;
      if (mesh.foam[v]) flagged++;
      if (mesh.foam[v] && !want) bad++;
      if (!mesh.foam[v] && want) missed++;
    }
    return { ok: flagged > 0 && bad === 0 && missed === 0, flagged, bad, missed };
  })();
  const waveChecks = terrainWaveChecks(a, mesh);
  const quads = mesh.triangleCount / 2;
  const perCell = quads / (a.width * a.height);
  const results = [
    ['finite attributes', finite],
    ['index range', indices],
    ['flat-grid face culling', flat],
    ['determinism (mesh attributes)', deterministic],
    ['water flag length and binary range', waterFlags],
    ['water flags only on water surfaces (tops, wall rims)', waterOnSurfaces],
    [`wave trough never opens a slit (${skirts.edges} water edges, ` +
      `${skirts.holes} holes, ${skirts.rims} bare rims)`, skirts.ok],
    ['shore length and range', shoreRange],
    [`shore foam only at sea/lake top corners touching land (${foamCheck.flagged} vertices, ` +
      `${foamCheck.bad} wrong, ${foamCheck.missed} missed)`, foamCheck.ok],
    ['shore determinism', shoreDeterministic],
    ['AO type, length, integer range', aoRange],
    ['AO determinism', aoDeterministic],
    ['flat grid AO is fully open', flatAO],
    ['raised column darkens facing neighbour corners', aoResponse],
    ['AO quad-flip helper', quadFlip],
    ['cell UV range and length', cellUV],
    ['camera yaw, pitch, and snap helpers', cameraHelpers],
    ['shift-drag pan keeps the ground under the cursor', panFollows],
    ['clock display wraps after midnight', clockWrap],
    ['triangle count (Faz 1 baseline)', triangleCount]
  ].concat(shadowChecks, waveChecks);
  console.log('voxel mesh checks (seed 1337, 192²):');
  for (const [name, ok] of results) console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`);
  console.log(`  mesh: ${mesh.vertexCount} vertices, ${mesh.triangleCount} triangles, ${buildMs.toFixed(1)} ms`);
  console.log(`  density: ${quads} quads, ${perCell.toFixed(3)} quads/cell`);
  console.log(`  shadow map: ${shadow.byteLength} bytes, ${shadowMs.toFixed(1)} ms`);
  if (!results.every(r => r[1])) process.exitCode = 1;
}

// Waterfalls (voxel view). SM.tagWaterfalls (grid.js, a separate lane) marks
// grid.waterfalls[i]: 1 = LIP (the fresh-water tile the fall drops FROM),
// 2 = LANDING (the water tile it drops INTO); grid.waterfallDrop[i] on a lip
// is the drop in levels. buildVoxelMesh must NOT trust grid.flow (empty on
// ~75% of river tiles) — the fall direction is re-derived from geometry: an
// orthogonal WATER neighbour of a LIP tile that sits >=SM.WATERFALL_MIN_DROP
// levels lower. These checks build small hand-tagged grids rather than
// depending on the other lane's generator, per the coordinator's contract
// note (2026-09-22).
function makeFallGrid(W, H, levels, waterFlags, biomeFlags, waterfalls, waterfallDrop) {
  const n = W * H;
  const level = new Int8Array(n);
  const water = new Uint8Array(n);
  const biome = new Uint8Array(n);
  const moisture = new Float32Array(n).fill(0.5);
  const elevation = new Float32Array(n).fill(0.5);
  for (let i = 0; i < n; i++) {
    level[i] = levels[i];
    water[i] = waterFlags[i];
    biome[i] = biomeFlags[i];
  }
  const grid = {
    width: W, height: H, level, water, biome, moisture, elevation,
    config: { waterDepth: 3, levels: 10 }
  };
  if (waterfalls) grid.waterfalls = Uint8Array.from(waterfalls);
  if (waterfallDrop) grid.waterfallDrop = Int8Array.from(waterfallDrop);
  return grid;
}

// Sum of a mesh's per-vertex fall flags, and the Y range of the flagged
// vertices — a real quad spans exactly its lip-to-landing height difference,
// so this doubles as the "spans the height difference" check.
function fallStats(mesh) {
  let count = 0, minY = Infinity, maxY = -Infinity;
  for (let v = 0; v < mesh.vertexCount; v++) {
    if (!mesh.fall[v]) continue;
    count++;
    const y = mesh.positions[v * 3 + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { count, minY, maxY };
}

function runFallsChecks() {
  const results = [];
  const push = (name, ok, detail) => results.push([name, ok, detail || '']);
  const RIVER = SM.BIOME_IDX.river;
  const GRASS = SM.BIOME_IDX.grassland;

  // 1) A river lip at level 6 next to a river landing at level 2 (drop 4,
  //    over WATERFALL_MIN_DROP) must produce falling-water side faces on
  //    EXACTLY that edge, spanning the full 6→2 height difference.
  {
    const g = makeFallGrid(2, 1, [6, 2], [1, 1], [RIVER, RIVER],
      [1, 2], [4, 0]);
    const mesh = SM.buildVoxelMesh(g);
    const stats = fallStats(mesh);
    push('lip (L6) next to landing (L2): exactly one fall quad',
      stats.count === 4, `fall-flagged vertices: ${stats.count}`);
    push('fall quad spans the full lip-to-landing height difference',
      // The landing is water, so the face goes on below it by the wave dip.
      stats.count > 0 && stats.maxY === 6 &&
        stats.minY === Math.fround(2 - (SM.VOXEL_WAVE_DIP || 0)),
      `y range: ${stats.minY}..${stats.maxY}`);
  }

  // 2) Identical geometry, but the tag is missing (waterfalls omitted) —
  //    the same ordinary side faces must be emitted, with no fall flag.
  {
    const tagged = makeFallGrid(2, 1, [6, 2], [1, 1], [RIVER, RIVER],
      [1, 2], [4, 0]);
    const untagged = makeFallGrid(2, 1, [6, 2], [1, 1], [RIVER, RIVER]);
    const meshTagged = SM.buildVoxelMesh(tagged);
    const meshUntagged = SM.buildVoxelMesh(untagged);
    push('same geometry without the tag keeps the same triangle count',
      meshUntagged.triangleCount === meshTagged.triangleCount,
      `tagged=${meshTagged.triangleCount} untagged=${meshUntagged.triangleCount}`);
    push('same geometry without the tag: no falling-water flag anywhere',
      Array.prototype.every.call(meshUntagged.fall, v => v === 0));
  }

  // 3) A land cliff (same 6/2 step, no water) must render exactly as before
  //    — never treated as a fall even if (mis-)tagged, because the LIP guard
  //    requires the source tile itself to be water.
  {
    const g = makeFallGrid(2, 1, [6, 2], [0, 0], [GRASS, GRASS],
      [1, 2], [4, 0]);
    const mesh = SM.buildVoxelMesh(g);
    const stats = fallStats(mesh);
    push('a land cliff is never flagged as a fall', stats.count === 0,
      `fall-flagged vertices: ${stats.count}`);
    push('a land cliff still gets its ordinary side wall',
      mesh.triangleCount > 0);
  }

  // 4) grid.waterfalls entirely absent (older grid / SM.tagWaterfalls never
  //    ran) — buildVoxelMesh must not throw, and nothing reads as a fall.
  {
    let threw = false;
    let mesh = null;
    try {
      mesh = SM.buildVoxelMesh(makeFallGrid(2, 1, [6, 2], [1, 1],
        [RIVER, RIVER]));
    } catch (err) { threw = true; }
    push('missing grid.waterfalls builds without throwing', !threw && !!mesh);
    if (mesh) {
      push('missing grid.waterfalls: fall array is all zero',
        Array.prototype.every.call(mesh.fall, v => v === 0));
    }
  }

  // 5) Determinism: same tagged grid, built twice, byte-identical fall array
  //    (and positions, since a fall face reuses the ordinary quad geometry).
  {
    const a = makeFallGrid(2, 1, [6, 2], [1, 1], [RIVER, RIVER], [1, 2], [4, 0]);
    const b = makeFallGrid(2, 1, [6, 2], [1, 1], [RIVER, RIVER], [1, 2], [4, 0]);
    const meshA = SM.buildVoxelMesh(a);
    const meshB = SM.buildVoxelMesh(b);
    push('determinism: fall array is byte-identical across two builds',
      typedEqual(meshA.fall, meshB.fall));
    push('determinism: positions are byte-identical across two builds',
      typedEqual(meshA.positions, meshB.positions));
  }

  // 6) A real, decorated map actually produces falling-water faces. This
  //    checkout still carries the pre-contract-update generate.js (the
  //    waterfall-tagging lane's rewrite lands separately), so the count is
  //    whatever the current tagging produces — the assertion is only that
  //    it is non-zero, per the task's spec; the exact number is printed for
  //    visibility, not pinned as a baseline.
  {
    const g = SM.generate({
      seed: 1337, width: 192, height: 192, seaLevel: 0.38, decorations: true
    });
    const mesh = SM.buildVoxelMesh(g);
    const stats = fallStats(mesh);
    push(`real map (seed 1337, 192², decorations) has falling-water faces ` +
      `(${stats.count / 4} quads)`, stats.count > 0);
  }

  console.log('waterfall face checks:');
  for (const [name, ok, detail] of results) {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`);
    if (detail) console.log(`         ${detail}`);
  }
  if (!results.every(r => r[1])) process.exitCode = 1;
}

// M3 river brush. The DOM half (undo capture, biome/water flags, repaint) stays
// in main.js; what is checked here is the pure planner in grid.js, because that
// is where a mistake would be silent — a channel that quietly widens into a lake,
// a bed that digs below sea level and gets reclassified as coast, or a repeated
// stroke that walks itself into a bottomless trench.
function runRiverChecks() {
  const results = [];
  const size = 64;

  // A tilted plane well above sea level: every tile has a distinct height, so a
  // wrong bank reference shows up immediately.
  function slope() {
    const g = SM.createGrid(size, size);
    g.seaThresh = 0.30;
    g.landSpan = 0.70;
    g.config = { levels: 10 };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      g.elevation[y * size + x] = 0.50 + (x / size) * 0.30;
    }
    return g;
  }

  // 1) A river stays a river. Even at the largest brush the channel must be far
  //    narrower than the disc the other brushes paint.
  const widths = [1, 4, 7, 10, 12].map(r => SM.riverHalfWidth(r) * 2 + 1);
  results.push(['channel stays narrow (<= 7 tiles at max brush)',
    widths.every(w => w >= 1 && w <= 7) && widths[0] === 1]);
  results.push(['channel widens monotonically with brush size',
    widths.every((w, i) => i === 0 || w >= widths[i - 1])]);
  // Every width the tool can express must be reachable from the slider,
  // otherwise part of the range is dead travel.
  const reachable = new Set();
  for (let r = 1; r <= 12; r++) reachable.add(SM.riverHalfWidth(r) * 2 + 1);
  results.push(['all four channel widths reachable from the slider',
    [1, 3, 5, 7].every(w => reachable.has(w))]);

  // 2) Bed depth follows strength, and never inverts.
  const drops = [0.1, 0.5, 1.0].map(SM.riverBedDrop);
  results.push(['bed drop grows with strength',
    drops[0] > 0 && drops[1] > drops[0] && drops[2] > drops[1]]);

  // 3) The bed sits BELOW its banks. This is the whole point: a flat blue strip
  //    reads as paint, a cut channel reads as a river in the voxel view.
  let g = slope();
  let plan = SM.planRiverChannel(g, 32, 32, 6, 0.5);
  const bankBefore = g.elevation[32 * size + 32];
  const bedMax = Math.max(...plan.elevation);
  results.push(['bed is cut below the surrounding banks', bedMax < bankBefore]);

  // 4) A river is fresh water ABOVE sea level. If the bed dropped to or under
  //    `seaThresh`, deriveTile would reclassify the tile as coast and the river
  //    would silently disappear.
  const lowland = slope();
  for (let i = 0; i < size * size; i++) lowland.elevation[i] = 0.305;
  plan = SM.planRiverChannel(lowland, 32, 32, 12, 1.0);
  results.push(['bed never sinks to or below sea level',
    plan.elevation.every(e => e > lowland.seaThresh)]);

  // 5) Repeated stamps on the same spot must CONVERGE, not dig forever. The bank
  //    reference is taken OUTSIDE the channel exactly to make this true.
  //
  //    ⚠️ Tolerance is float32-sized, not exact. `grid.elevation` is a
  //    Float32Array, so writing a double-precision bed back and reading it again
  //    loses ~2e-8 — measured, and it looks like a descent to an exact
  //    comparison. The invariant that actually matters is that the TOTAL descent
  //    after the first pass stays far below one bed drop; anything larger means
  //    the stroke is walking itself downhill.
  g = slope();
  const drop = SM.riverBedDrop(1.0);
  let firstPass = null, deepest = null;
  for (let pass = 0; pass < 8; pass++) {
    plan = SM.planRiverChannel(g, 32, 32, 6, 1.0);
    for (let k = 0; k < plan.indices.length; k++) {
      g.elevation[plan.indices[k]] = plan.elevation[k];
    }
    deepest = Math.min(...plan.elevation);
    if (firstPass === null) firstPass = deepest;
  }
  const creep = firstPass - deepest;
  results.push(['repeated strokes converge instead of trenching',
    creep >= 0 && creep < drop * 0.01]);

  // 6) Same input, same plan.
  const a = SM.planRiverChannel(slope(), 20, 40, 9, 0.7);
  const b = SM.planRiverChannel(slope(), 20, 40, 9, 0.7);
  results.push(['planner is deterministic',
    JSON.stringify(a) === JSON.stringify(b)]);

  // 7) Edge of the map must not throw or wrap around.
  let edgeOk = true;
  try {
    for (const [x, y] of [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1]]) {
      const p = SM.planRiverChannel(slope(), x, y, 12, 1.0);
      if (!p.indices.length || p.indices.some(i => i < 0 || i >= size * size)) edgeOk = false;
    }
  } catch (err) { edgeOk = false; }
  results.push(['map edges are safe', edgeOk]);

  console.log('river brush checks (64² slope):');
  for (const [name, ok] of results) console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`);
  console.log(`  widths by brush size 1/4/7/10/12: ${widths.join(', ')} tiles`);
  console.log(`  8-pass creep: ${creep.toExponential(1)} (bed drop ${drop.toFixed(3)})`);
  if (!results.every(r => r[1])) process.exitCode = 1;
}

// M4 sky. Cloud BODY and cloud SHADOW are drawn by two different programs, so
// the one thing that must never drift apart is their shared position. That is
// why drift is computed once in JS -- and why it is checked here: a shadow
// sliding out from under its own cloud looks plausible in a single screenshot
// and only shows up as "something is off" in motion.
function runSkyChecks() {
  const results = [];
  const bounds = { minX: -48, maxX: 48, minY: 0, maxY: 12, minZ: -48, maxZ: 48 };
  const instances = SM.Sky.cloudInstances(bounds, 5, 1337);

  results.push(['instance count honours the request', instances.length === 5]);
  results.push(['count is capped at MAX_CLOUDS',
    SM.Sky.cloudInstances(bounds, 99, 1).length === SM.Sky.MAX_CLOUDS]);
  results.push(['instances are deterministic',
    JSON.stringify(instances) === JSON.stringify(SM.Sky.cloudInstances(bounds, 5, 1337))]);

  // Clouds must stay above the terrain at every vertical exaggeration,
  // otherwise a mountain punches through a cloud at high isoexag.
  let aboveTerrain = true;
  for (const vScale of [0.6, 1.6, 3.0]) {
    const now = SM.Sky.driftClouds(instances, 12.5, bounds, vScale);
    if (now.some(c => c.y <= bounds.maxY * vScale)) aboveTerrain = false;
  }
  results.push(['clouds stay above the terrain at every vScale', aboveTerrain]);

  // Drift must wrap, and wrapping must not teleport a cloud into view: the pad
  // is a full diameter, so it leaves completely before it comes back.
  const spanX = bounds.maxX - bounds.minX;
  let inRange = true, moved = false;
  let previous = SM.Sky.driftClouds(instances, 0, bounds, 1.6);
  for (let t = 1; t <= 400; t++) {
    const now = SM.Sky.driftClouds(instances, t * 0.5, bounds, 1.6);
    for (let i = 0; i < now.length; i++) {
      const pad = instances[i].radius * 2;
      if (now[i].x < bounds.minX - pad - 1e-6 ||
          now[i].x > bounds.maxX + pad + 1e-6) inRange = false;
      if (Math.abs(now[i].x - previous[i].x) > 1e-6) moved = true;
    }
    previous = now;
  }
  results.push(['drift stays inside the padded span for 200s', inRange]);
  results.push(['clouds actually move', moved]);

  // The shadow follows the cloud. With the sun overhead it sits under it; as the
  // sun drops the shadow slides AWAY, and it must never stop tracking.
  // One shadow ellipse per cloud lobe (2026-10-05), packed cloud by cloud.
  const noon = SM.Sky.driftClouds(instances, 3, bounds, 1.6);
  const overhead = SM.Sky.cloudShadowUniforms(noon, bounds, [0, 1, 0]);
  let underCloud = true, k = 0;
  for (let i = 0; i < noon.length; i++) {
    for (const lobe of instances[i].lobes) {
      const u = (noon[i].x + lobe.x - bounds.minX) / spanX;
      const v = (noon[i].z + lobe.z - bounds.minZ) / (bounds.maxZ - bounds.minZ);
      if (Math.abs(overhead[k * 4] - u) > 1e-5) underCloud = false;
      if (Math.abs(overhead[k * 4 + 1] - v) > 1e-5) underCloud = false;
      k++;
    }
  }
  results.push(["overhead sun puts every lobe's shadow directly under that lobe",
    underCloud && k === SM.Sky.shadowLobeCount(instances)]);

  const low = SM.Sky.cloudShadowUniforms(noon, bounds, [0.9, 0.28, 0.0]);
  results.push(['a low sun slides the shadow away from the cloud',
    Math.abs(low[0] - overhead[0]) > 0.01]);

  // A sun at the horizon must not send the shadow to infinity.
  const horizon = SM.Sky.cloudShadowUniforms(noon, bounds, [1, 0, 0]);
  results.push(['horizon sun stays finite',
    Array.from(horizon).every(v => Number.isFinite(v))]);
  results.push(['shadow array is padded to MAX_SHADOW_LOBES (vec4 each)',
    horizon.length === SM.Sky.MAX_SHADOW_LOBES * 4 &&
    SM.Sky.MAX_SHADOW_LOBES === SM.Sky.MAX_CLOUDS * SM.Sky.MAX_LOBES &&
    SM.Sky.MAX_WEATHER_CLOUDS === SM.Weather.MAX_CLOUDS]);

  // Geometry sanity: finite, indexed inside the buffer, deterministic.
  const cloudMesh = SM.Sky.buildCloudMesh(instances);
  const birdMesh = SM.Sky.buildBirdMesh(16, 4242);
  results.push(['cloud mesh is non-empty and finite',
    cloudMesh.triangleCount > 0 &&
    cloudMesh.positions.every(v => Number.isFinite(v))]);
  results.push(['cloud indices stay inside the vertex buffer',
    cloudMesh.indices.every(i => i < cloudMesh.vertexCount)]);
  results.push(['cloud index attribute matches the instance list',
    Array.from(cloudMesh.cloudIndex).every(i => i >= 0 && i < instances.length)]);
  results.push(['bird mesh has two triangles per bird',
    birdMesh.triangleCount === 32 && birdMesh.vertexCount === 64]);
  results.push(['bird indices stay inside the vertex buffer',
    birdMesh.indices.every(i => i < birdMesh.vertexCount)]);
  results.push(['bird wing flags are -1, 0 or 1',
    Array.from(birdMesh.wing).every(w => w === -1 || w === 0 || w === 1)]);
  // The render loop hands both helpers a buffer it owns, so a frame allocates
  // nothing. If that contract breaks the sky quietly starts churning garbage at
  // 60 fps -- invisible until a profiler is opened.
  const reuseTarget = [];
  const first = SM.Sky.driftClouds(instances, 1, bounds, 1.6, reuseTarget);
  const second = SM.Sky.driftClouds(instances, 2, bounds, 1.6, reuseTarget);
  results.push(['driftClouds writes into the caller buffer',
    first === reuseTarget && second === reuseTarget &&
    reuseTarget.length === instances.length]);
  const shadowTarget = new Float32Array(SM.Sky.MAX_SHADOW_LOBES * 4);
  results.push(['cloudShadowUniforms writes into the caller buffer',
    SM.Sky.cloudShadowUniforms(first, bounds, [0, 1, 0], shadowTarget) === shadowTarget]);
  // A shorter cloud list must not leave a previous cloud's shadow behind.
  SM.Sky.cloudShadowUniforms(first, bounds, [0, 1, 0], shadowTarget);
  SM.Sky.cloudShadowUniforms(first.slice(0, 1), bounds, [0, 1, 0], shadowTarget);
  const fadeTarget = new Float32Array(SM.Sky.MAX_SHADOW_LOBES).fill(1);
  SM.Sky.cloudShadowUniforms(first.slice(0, 1), bounds, [0, 1, 0], shadowTarget, fadeTarget);
  const used = instances[0].lobes.length;
  results.push(['reused shadow buffer is cleared, not left stale',
    shadowTarget.slice(used * 4).every(v => v === 0) && fadeTarget.slice(used).every(v => v === 0) &&
    fadeTarget.slice(0, used).every(v => v === first[0].fade)]);
  // Clouds fade in/out instead of popping at the wrap point (Uğur,
  // 2026-09-23). Opacity is exactly 0 where the jump happens, 1 over the
  // middle of the map, and never jumps between consecutive small steps.
  {
    const r = instances[0].radius, pad = r * 2;
    const f = x => SM.Sky.cloudFade(x, r, bounds);
    const mid = (bounds.minX + bounds.maxX) / 2;
    results.push(['cloud opacity is 0 at both wrap points, 1 mid-map',
      f(bounds.minX - pad) === 0 && f(bounds.maxX + pad) === 0 && f(mid) === 1]);
    let maxStep = 0, inRange = true, prev = null;
    for (let t = 0; t < 4000; t++) {
      const now = SM.Sky.driftClouds(instances.slice(0, 1), t * 0.25, bounds, 1.6)[0].fade;
      if (now < 0 || now > 1) inRange = false;
      if (prev !== null) maxStep = Math.max(maxStep, Math.abs(now - prev));
      prev = now;
    }
    results.push([`cloud opacity never jumps, wrap included (max step ${maxStep.toFixed(3)})`,
      inRange && maxStep < 0.1]);
  }

  results.push(['sky meshes are deterministic',
    JSON.stringify([...cloudMesh.positions]) ===
      JSON.stringify([...SM.Sky.buildCloudMesh(instances).positions])]);

  // ---- Varied clouds (Uğur 2026-10-05: clouds looked alike) ----
  // Real map footprints (192² and 448²), five seeds. Every sky must mix
  // sizes, shapes, thicknesses and heights; another seed gives another sky.
  {
    const SEEDS = [1337, 4242, 90210, 7, 2026, 1, 99, 31337];
    const real = { minX: -97, maxX: 97, minY: 0, maxY: 11, minZ: -97, maxZ: 97 };
    const big = { minX: -225, maxX: 225, minY: 0, maxY: 11, minZ: -225, maxZ: 225 };
    const sig = c => {
      const v = SM.Sky.cloudVoxels(c);
      return v.nx + 'x' + v.nz + ':' + Array.from(v.cells).join('');
    };
    const layersOf = c => {
      const v = SM.Sky.cloudVoxels(c);
      let top = 0;
      for (let y = 0; y < SM.Sky.MAX_LAYERS; y++) {
        if (v.cells.subarray(y * v.nx * v.nz, (y + 1) * v.nx * v.nz).some(x => x)) top = y + 1;
      }
      return top;
    };
    const footprint = c => {
      const v = SM.Sky.cloudVoxels(c);
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (let z = 0; z < v.nz; z++) for (let x = 0; x < v.nx; x++) {
        if (v.cells[z * v.nx + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      }
      return [x1 - x0 + 1, z1 - z0 + 1];
    };
    const bad = [];
    let maxTris = 0, maxTrisBig = 0;
    const skies = [];
    for (const seed of SEEDS) {
      const n = SM.Sky.cloudCount(seed);
      const list = SM.Sky.cloudInstances(real, n, seed);
      skies.push(JSON.stringify(list));
      // Size = how much cloud there is (voxel count), not the bounding
      // radius: a small cloud with one far side puff has a big radius.
      const vols = list.map(c => SM.Sky.cloudVoxels(c).cells.reduce((a, b) => a + b, 0));
      const ratio = Math.max(...vols) / Math.min(...vols);
      const sigs = new Set(list.map(sig));
      const layers = new Set(list.map(layersOf));
      const lobeCounts = new Set(list.map(c => c.lobes.length));
      const aspects = list.map(c => { const f = footprint(c); return Math.max(f[0], f[1]) / Math.min(f[0], f[1]); });
      const lifts = list.map(c => c.lift);
      const speeds = list.map(c => c.speed);
      if (n < 4 || n > SM.Sky.MAX_CLOUDS) bad.push(`${seed}: ${n} clouds`);
      if (ratio < 2.5) bad.push(`${seed}: volume ratio ${ratio.toFixed(2)}`);
      if (sigs.size !== list.length) bad.push(`${seed}: two clouds share a voxel shape`);
      if (layers.size < 2) bad.push(`${seed}: one thickness only (${[...layers]})`);
      if (lobeCounts.size < 2 && Math.max(...aspects) - Math.min(...aspects) < 0.5) bad.push(`${seed}: one shape family`);
      if (Math.max(...lifts) - Math.min(...lifts) < 0.8) bad.push(`${seed}: heights within ${(Math.max(...lifts) - Math.min(...lifts)).toFixed(2)}`);
      if (Math.max(...speeds) / Math.min(...speeds) > 2.2) bad.push(`${seed}: drift speeds too far apart`);
      maxTris = Math.max(maxTris, SM.Sky.buildCloudMesh(list).triangleCount);
      maxTrisBig = Math.max(maxTrisBig, SM.Sky.buildCloudMesh(SM.Sky.cloudInstances(big, n, seed)).triangleCount);
    }
    results.push([`each of ${SEEDS.length} skies mixes sizes (voxel volume max/min >= 2.5), shapes, thickness and height`,
      bad.length === 0, bad.join('; ')]);
    results.push(['the sky follows the seed: every seed gets its own sky',
      new Set(skies).size === SEEDS.length]);
    // Frame cost: the old renderer drew 16668 cloud triangles on a 192² map
    // and 96660 on 448² (interior faces included). Only the shell is emitted
    // now; the budget keeps the new, bigger clouds below the old count.
    results.push([`cloud triangles stay under the old budget (192²: ${maxTris} <= 16668, 448²: ${maxTrisBig} <= 96660)`,
      maxTris <= 16668 && maxTrisBig <= 96660]);

    // Shadow and body share one shape. Overhead sun: every voxel column the
    // cloud has casts shadow (inside some lobe ellipse), and every lobe's
    // full-strength core (the inner 45%) has cloud above it.
    const shapeBad = [];
    for (const seed of SEEDS) {
      const list = SM.Sky.cloudInstances(real, SM.Sky.cloudCount(seed), seed);
      const now = SM.Sky.driftClouds(list, 40, real, 1.6);
      const data = SM.Sky.cloudShadowUniforms(now, real, [0, 1, 0]);
      const sx = real.maxX - real.minX, sz = real.maxZ - real.minZ;
      let k = 0, covered = 0, columns = 0, coreHits = 0, coreSamples = 0;
      for (let i = 0; i < list.length; i++) {
        const v = SM.Sky.cloudVoxels(list[i]);
        const mine = [];
        for (let j = 0; j < list[i].lobes.length; j++) mine.push(k++);
        const cover = (wx, wz) => mine.reduce((best, q) => {
          const du = ((wx - real.minX) / sx - data[q * 4]) / data[q * 4 + 2];
          const dv = ((wz - real.minZ) / sz - data[q * 4 + 1]) / data[q * 4 + 3];
          return Math.min(best, Math.hypot(du, dv));
        }, Infinity);
        for (let z = 0; z < v.nz; z++) for (let x = 0; x < v.nx; x++) {
          let any = false;
          for (let y = 0; y < SM.Sky.MAX_LAYERS; y++) if (v.cells[(y * v.nz + z) * v.nx + x]) any = true;
          if (!any) continue;
          columns++;
          const wx = now[i].x + (x - v.reachX) * SM.Sky.CLOUD_VOXEL;
          const wz = now[i].z + (z - v.reachZ) * SM.Sky.CLOUD_VOXEL;
          if (cover(wx, wz) < 1) covered++;
        }
        for (const lobe of list[i].lobes) {
          for (let a = 0; a < 16; a++) for (const t of [0, 0.2, 0.45]) {
            const lx = lobe.x + Math.cos(a * Math.PI / 8) * t * lobe.rx * 1.15;
            const lz = lobe.z + Math.sin(a * Math.PI / 8) * t * lobe.rz * 1.15;
            const gx = Math.round(lx / SM.Sky.CLOUD_VOXEL) + v.reachX;
            const gz = Math.round(lz / SM.Sky.CLOUD_VOXEL) + v.reachZ;
            coreSamples++;
            if (gx >= 0 && gz >= 0 && gx < v.nx && gz < v.nz && v.cells[gz * v.nx + gx]) coreHits++;
          }
        }
      }
      if (covered !== columns) shapeBad.push(`${seed}: ${columns - covered}/${columns} cloud columns cast no shadow`);
      if (coreHits < coreSamples * 0.97) shapeBad.push(`${seed}: shadow core under open sky ${coreSamples - coreHits}/${coreSamples}`);
    }
    results.push(["the shadow has the cloud's shape: every cloud column shades, every shadow core is under cloud",
      shapeBad.length === 0, shapeBad.join('; ')]);

    // Height: the whole cloud body stays above the terrain and below the
    // ceiling the camera fit uses, at every exaggeration.
    const hBad = [];
    for (const seed of SEEDS) {
      const list = SM.Sky.cloudInstances(real, SM.Sky.cloudCount(seed), seed);
      const mesh = SM.Sky.buildCloudMesh(list);
      for (const vs of [0.6, 1.6, 3.0]) {
        const now = SM.Sky.driftClouds(list, 0, real, vs);
        const ceil = SM.Sky.ceiling(real, vs, (real.maxX - real.minX) * 0.09);
        for (let q = 0; q < mesh.vertexCount; q++) {
          const y = mesh.positions[q * 3 + 1] + now[mesh.cloudIndex[q]].y;
          if (y > ceil + 1e-6) { hBad.push(`${seed}@${vs}: top ${y.toFixed(2)} > ceiling ${ceil.toFixed(2)}`); break; }
          if (y <= real.maxY * vs) { hBad.push(`${seed}@${vs}: cloud at ${y.toFixed(2)} inside terrain`); break; }
        }
      }
    }
    results.push(['every cloud vertex is above the terrain and under SM.Sky.ceiling (vScale 0.6 / 1.6 / 3)',
      hBad.length === 0, hBad.slice(0, 4).join('; ')]);

    // Only the shell: no two faces sit in the same place (a hidden interior
    // pair would be two quads with the same centre).
    const centres = new Set();
    let dup = 0;
    const m = SM.Sky.buildCloudMesh(SM.Sky.cloudInstances(real, 6, 4242));
    for (let q = 0; q < m.vertexCount; q += 4) {
      let cx = 0, cy = 0, cz = 0;
      for (let c = 0; c < 4; c++) { cx += m.positions[(q + c) * 3]; cy += m.positions[(q + c) * 3 + 1]; cz += m.positions[(q + c) * 3 + 2]; }
      const key = m.cloudIndex[q] + ':' + [cx, cy, cz].map(x => (x / 4).toFixed(3)).join(',');
      if (centres.has(key)) dup++; else centres.add(key);
    }
    results.push(['cloud mesh is a shell: no interior face pairs', dup === 0, dup ? `${dup} duplicated faces` : '']);
  }

  console.log('sky checks (96 unit span, 5 clouds, 16 birds; variety on real map spans):');
  for (const [name, ok, detail] of results) {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`);
    if (detail) console.log(`         ${detail}`);
  }
  console.log(`  cloud mesh: ${cloudMesh.vertexCount} vertices, ` +
    `${cloudMesh.triangleCount} triangles`);
  console.log(`  bird mesh:  ${birdMesh.vertexCount} vertices, ` +
    `${birdMesh.triangleCount} triangles`);
  if (!results.every(r => r[1])) process.exitCode = 1;
}

/* GLSL cross-stage declaration lint.
 *
 * WHY THIS EXISTS: the same bug has now shipped twice. A uniform declared in
 * BOTH the vertex and fragment shader must be declared IDENTICALLY -- if the
 * precision differs the program fails to LINK, and a failed link is silent:
 * `makeProgram` just returns null and the layer never appears. No GL error, no
 * console output, nothing to search for.
 *   * `uTime` -- fixed in `fix(render): uTime precision mismatch broke WebGL2
 *     link on Firefox` (2026-09-03).
 *   * `uMode` -- cost most of the M4 session (2026-09-06): `int` defaults to
 *     highp in a vertex shader and mediump in a fragment shader.
 *
 * The check is textual on purpose: no GL context is needed, so it runs in the
 * same place as every other check. It compares the DECLARATION LINE, which
 * catches a type mismatch as well as a precision one.
 */
function runShaderChecks() {
  const results = [];
  // Each program is a `makeX(gl)` function holding a vertexSource and a
  // fragmentSource array of quoted GLSL lines. Every GL file in src/render
  // is read (post.js has its own programs since 2026-10-05).
  const pairs = [];
  for (const f of ['voxel3d.js', 'post.js', 'wind.js', 'weather.js']) {
    const file = fs.readFileSync(path.join(root, 'render', f), 'utf8');
    // `makeProgram` only compiles; the terrain GLSL lives in
    // `terrainShaderSources(variant)`, so that body is read under its name.
    const programs = file.replace(/function terrainShaderSources\(variant\)/, 'function makeTerrainProgram(gl)')
      .split(/function make(\w*[Pp]rogram)\(gl[^)]*\)/).slice(1);
    for (let i = 0; i < programs.length; i += 2) {
      pairs.push([f + ' ' + programs[i], programs[i + 1] || '']);
    }
  }

  function uniformsIn(text) {
    const found = new Map();
    const re = /'\s*(uniform\s+[^;']+?\s+(u\w+)\s*(?:\[\d+\])?)\s*;'/g;
    let m;
    while ((m = re.exec(text))) found.set(m[2], m[1].replace(/\s+/g, ' ').trim());
    return found;
  }

  for (const [name, body] of pairs) {
    const cut = body.indexOf('fragmentSource');
    if (cut < 0) continue;
    const vertex = uniformsIn(body.slice(0, cut));
    const fragment = uniformsIn(body.slice(cut));
    const clashes = [];
    for (const [uniform, decl] of vertex) {
      if (fragment.has(uniform) && fragment.get(uniform) !== decl) {
        clashes.push(`${uniform}: vertex "${decl}" vs fragment "${fragment.get(uniform)}"`);
      }
    }
    results.push([`${name}: shared uniforms declared identically in both stages`,
      clashes.length === 0, clashes]);
  }

  results.push(['at least four programs were inspected (terrain, sky, bloom blur, composite)', pairs.length >= 4, []]);

  console.log('shader declaration lint (src/render/voxel3d.js, post.js, wind.js, weather.js):');
  for (const [name, ok, detail] of results) {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`);
    for (const line of detail) console.log(`         ${line}`);
  }
  if (!results.every(r => r[1])) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// --sweep : sea-level sweep. Now ASSERTS (was print-only) and sets exit code.
// ---------------------------------------------------------------------------
function runSweepChecks() {
  const seas = [0.15, 0.25, 0.35, 0.45, 0.55, 0.62, 0.70];
  const rows = seas.map(sea => run(1337, 192, sea));
  console.log('sea-level sweep (seed 1337, 192²):');
  for (let k = 0; k < rows.length; k++) {
    const r = rows[k];
    console.log(`  sea=${seas[k].toFixed(2)}  land=${String(r.landPct).padStart(3)}% ` +
      `water=${String(r.waterPct).padStart(3)}%  islands=${String(r.islands).padStart(3)}  ` +
      `top5=[${r.islandTop5.join(', ')}]  towns=${r.settlements}  towers=${r.towers}  ${r.dt}ms`);
  }

  const results = [];

  // 1) Land fraction is monotone in sea level (higher sea → not more land).
  //    Tolerance: 1 percentage point of noise on the land% integer.
  let landMono = true, worst = 0;
  for (let k = 1; k < rows.length; k++) {
    const rise = rows[k].landPct - rows[k - 1].landPct;
    if (rise > 1) { landMono = false; worst = Math.max(worst, rise); }
  }
  results.push([`land fraction falls (±1pp) as sea rises` +
    (landMono ? '' : ` — jumped +${worst}pp`), landMono]);

  // 2) Raising the sea consolidates land into fewer bodies rather than
  //    shattering it. Allow small non-monotone wobble near the middle where a
  //    land bridge can briefly split, but the trend across the full sweep must
  //    be downward and the endpoints must obey it.
  const firstHalfMax = Math.max(rows[0].islands, rows[1].islands);
  const lastHalfMax = Math.max(rows[rows.length - 1].islands, rows[rows.length - 2].islands);
  results.push(['high sea has no more island bodies than low sea',
    lastHalfMax <= firstHalfMax]);
  let bigSpikes = 0;
  for (let k = 1; k < rows.length; k++) {
    if (rows[k].islands - rows[k - 1].islands > 4) bigSpikes++;
  }
  results.push([`no step fragments land into >4 new bodies (${bigSpikes} spikes)`,
    bigSpikes === 0]);

  // 3) No towers at any sea level (the repair pass is the whole reason the
  //    voxel view reads as terraces, not spikes).
  const towerTotal = rows.reduce((a, r) => a + r.towers, 0);
  results.push([`voxel repair keeps towers at zero across the sweep (${towerTotal})`,
    towerTotal === 0]);

  // 4) Determinism: same seed/size/sea → byte-identical levels.
  function sig(g) { return Buffer.from(g.level.buffer, g.level.byteOffset, g.level.byteLength).toString('base64'); }
  results.push(['same seed reproduces identical topography',
    sig(run(7, 160, 0.4).grid) === sig(run(7, 160, 0.4).grid)]);

  console.log('\nsweep assertions:');
  for (const [name, ok] of results) console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`);
  if (!results.every(r => r[1])) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// --geo : multi-seed geographic property harness. The README makes coastline,
// river and continental-growth claims; these tie each claim to a red/green test
// over several seeds so a regression fails CI instead of a screenshot.
// ---------------------------------------------------------------------------
function runGeoProperties() {
  const SEEDS = [11, 1337, 4242, 90210, 777];
  const B = SM.BIOME_LIST.reduce((m, b, i) => (m[b.id] = i, m), {});
  const results = [];
  const push = (name, ok, detail) => results.push([name, ok, detail || '']);

  // --- P1: sea-level monotonicity holds for EVERY seed, not just 1337 -------
  {
    const seas = [0.20, 0.35, 0.50, 0.65];
    let fails = [];
    for (const seed of SEEDS) {
      const land = seas.map(s => run(seed, 128, s).landPct);
      for (let k = 1; k < land.length; k++) {
        if (land[k] - land[k - 1] > 2) fails.push(`seed ${seed}: ${land.join('→')}`);
      }
    }
    push('sea level ↑ ⇒ land ↓ (±2pp) for all seeds', fails.length === 0, fails.join('; '));
  }

  // --- P2: common-world growth — features stay put, the map grows at the edge.
  // Same seed at 128² and 192² must agree on land/water over the shared centre.
  // Biome is checked alongside water: the water check alone missed a real
  // regression (kod taraması 2026-09-15, bulgu 1 — latBand was sampled in
  // grid-fraction space instead of world space, so climate/biome drifted with
  // map size even while land/water stayed put; ≤40% biome overlap is well
  // below both the fixed baseline (measured 45-89% across these seeds) and
  // comfortably above the pre-fix baseline (measured 35-76%, i.e. this
  // threshold would have failed before the fix).
  {
    let mism = [];
    let biomeMism = [];
    for (const seed of SEEDS) {
      const small = run(seed, 128, 0.4).grid;
      const big = run(seed, 192, 0.4).grid;
      const off = (192 - 128) / 2;
      let same = 0, biomeSame = 0, total = 0;
      for (let y = 0; y < 128; y++) {
        for (let x = 0; x < 128; x++) {
          const ia = y * 128 + x;
          const ib = (y + off) * 192 + (x + off);
          total++;
          if (small.water[ia] === big.water[ib]) same++;
          if (small.biome[ia] === big.biome[ib]) biomeSame++;
        }
      }
      const agree = same / total;
      const biomeAgree = biomeSame / total;
      if (agree < 0.92) mism.push(`seed ${seed}: ${(agree * 100).toFixed(1)}% overlap`);
      if (biomeAgree < 0.40) biomeMism.push(`seed ${seed}: ${(biomeAgree * 100).toFixed(1)}% overlap`);
    }
    push('same seed: ≥92% land/water overlap between 128² and 192² centre',
      mism.length === 0, mism.join('; '));
    push('same seed: ≥40% biome overlap between 128² and 192² centre',
      biomeMism.length === 0, biomeMism.join('; '));
  }

  // --- P3: every river reaches an outlet (sea, lake, or the map edge). A river
  // blob that dead-ends on dry land is a hydrology bug — water running to
  // nowhere.
  {
    let orphaned = [];
    for (const seed of SEEDS) {
      const g = run(seed, 160, 0.38).grid;
      const w = g.width, h = g.height, n = w * h;
      const seen = new Uint8Array(n);
      let blobs = 0, bad = 0;
      for (let i = 0; i < n; i++) {
        if (seen[i] || g.biome[i] !== B.river) continue;
        blobs++;
        let q = [i], head = 0, reachesOutlet = false;
        seen[i] = 1;
        while (head < q.length) {
          const c = q[head++], cx = c % w, cy = (c / w) | 0;
          if (cx === 0 || cy === 0 || cx === w - 1 || cy === h - 1) reachesOutlet = true;
          for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const ni = ny * w + nx;
            if (g.biome[ni] === B.lake || g.biome[ni] === B.deep_water ||
                g.biome[ni] === B.shallow_water) reachesOutlet = true;
            if (g.biome[ni] === B.river && !seen[ni]) { seen[ni] = 1; q.push(ni); }
          }
        }
        if (!reachesOutlet) bad++;
      }
      if (bad > 0) orphaned.push(`seed ${seed}: ${bad}/${blobs} river blobs dead-end on land`);
    }
    push('every river reaches sea / lake / map edge', orphaned.length === 0, orphaned.join('; '));
  }

  // --- P4: river steps are either smooth or a drawn waterfall. -------------
  // Hybrid decision (tarama 2026-09-22 #2): on the DEFAULT config (no
  // decorations flag -- waterfalls are always tagged now), every orthogonal
  // water-water edge that touches a river is
  //   - <= 1 level (a normal bed), or
  //   - >= WATERFALL_MIN_DROP levels, with the high side tagged lip (1) and the
  //     low side tagged landing -- i.e. the voxel view draws it, or
  //   - exactly 2 with a LAKE on the high side: a lake outflow sill. Lakes are
  //     fixed anchors in gradeRiverBeds (rivers only carve down), so this is
  //     the one documented exception; its count is printed.
  // No percentage threshold and no exemption list any more: the previous P4
  // allowed 10% and excluded waterfalls it could not see on the default map.
  // Also direction-aware: along `grid.flow` (centrelines) no step climbs >1.
  {
    const MIN = SM.WATERFALL_MIN_DROP;
    let bad = [], sills = 0, lips = 0, edges = 0, climbs = [];
    const DX = [0, 1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 0, 1, 1, 1, 0, -1, -1, -1];
    for (const seed of SEEDS) {
      const g = SM.generate({ seed, width: 160, height: 160, seaLevel: 0.38 });
      const w = g.width, h = g.height, n = w * h;
      for (let i = 0; i < n; i++) if (g.waterfalls[i] === 1) lips++;
      for (let i = 0; i < n; i++) {
        if (!g.water[i]) continue;
        const x = i % w;
        for (const ni of [x < w - 1 ? i + 1 : -1, i + w < n ? i + w : -1]) {
          if (ni < 0 || !g.water[ni]) continue;
          if (g.biome[i] !== B.river && g.biome[ni] !== B.river) continue;
          edges++;
          const hi = g.level[i] >= g.level[ni] ? i : ni, lo = hi === i ? ni : i;
          const d = g.level[hi] - g.level[lo];
          if (d <= 1) continue;
          if (d === 2 && g.biome[hi] === B.lake) { sills++; continue; }
          if (d >= MIN && g.waterfalls[hi] === 1 && g.waterfalls[lo] > 0) continue;
          if (bad.length < 4) bad.push(`seed ${seed} (${hi % w},${(hi / w) | 0}) ${SM.BIOME_LIST[g.biome[hi]].id} L${g.level[hi]} → L${g.level[lo]}`);
          else bad.push('');
        }
      }
      for (let i = 0; i < n; i++) {
        const dir = g.flow && g.flow[i];
        if (!dir || g.biome[i] !== B.river) continue;
        const nx = (i % w) + DX[dir], ny = ((i / w) | 0) + DY[dir];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (g.water[ni] && g.level[ni] - g.level[i] > 1) climbs.push(`seed ${seed} #${i}`);
      }
    }
    push(`every river edge is <=1 or a tagged waterfall (${edges} edges, ${lips} lips, ${sills} lake sills)`,
      bad.length === 0 && lips > 0, bad.filter(Boolean).join('; ') + (bad.length > 4 ? ` … ${bad.length} total` : ''));
    push('rivers never climb >1 level along their flow', climbs.length === 0, climbs.slice(0, 4).join('; '));
  }

  // --- P6: pipeline recorder (step-through UI + case study). Every stage in
  // SM.PIPELINE_STAGES is recorded exactly once, in order, as a COPY; and
  // recording must not change the map it records.
  {
    const got = [];
    const plain = SM.generate({ seed: 4242, width: 128, height: 128, seaLevel: 0.38 });
    const rec = SM.generate({ seed: 4242, width: 128, height: 128, seaLevel: 0.38 },
      (id, snap) => got.push([id, snap]));
    const order = JSON.stringify(got.map(g => g[0])) === JSON.stringify(SM.PIPELINE_STAGES.map(s => s.id));
    const same = Buffer.compare(Buffer.from(plain.level.buffer), Buffer.from(rec.level.buffer)) === 0 &&
      Buffer.compare(Buffer.from(plain.biome.buffer), Buffer.from(rec.biome.buffer)) === 0;
    const copies = got.every(([, s]) => s.biome !== rec.biome && s.elevation !== rec.elevation);
    const last = got[got.length - 1][1];
    const finalMatches = Buffer.compare(Buffer.from(last.biome.buffer), Buffer.from(rec.biome.buffer)) === 0;
    push(`pipeline recorder: ${got.length} stages in table order, copies, output unchanged`,
      order && same && copies && finalMatches);
  }

  // --- P7: "Island" shapes land, it does not melt it (panel review
  // 2026-09-23). Before the fix the sea threshold ignored the falloff, so the
  // slider just deleted land (65% → 10%) -- a second sea slider. Now: land
  // share stays near the island-off map at 0.5, the edges empty out as the
  // slider rises, and island=1 + sea 0.55 on a big map is ONE landmass with
  // open sea on every edge.
  {
    const fails = [];
    const edgeLand = g => { const w = g.width; let c = 0, t = 0;
      for (let i = 0; i < w; i++) for (const j of [i, (w - 1) * w + i, i * w, i * w + w - 1]) { t++; if (!g.water[j]) c++; }
      return c / t; };
    for (const seed of [1337, 4242, 90210]) {
      const off = SM.generate({ seed, width: 160, height: 160, seaLevel: 0.38 });
      const half = SM.generate({ seed, width: 160, height: 160, seaLevel: 0.38, islandFalloff: 0.5 });
      const full = SM.generate({ seed, width: 160, height: 160, seaLevel: 0.38, islandFalloff: 1 });
      const lone = SM.generate({ seed, width: 256, height: 256, seaLevel: 0.55, islandFalloff: 1 });
      const dLand = Math.abs(SM.summarize(half).landPct - SM.summarize(off).landPct);
      if (dLand > 10) fails.push(`seed ${seed}: island 0.5 moved land by ${dLand}pp`);
      if (!(edgeLand(full) < edgeLand(off))) fails.push(`seed ${seed}: edges did not empty`);
      const bodies = countIslands(lone).filter(sz => sz >= 12).length;
      if (edgeLand(lone) > 0.02 || bodies !== 1) fails.push(`seed ${seed}: lone island edge ${edgeLand(lone).toFixed(2)} bodies ${bodies}`);
    }
    push('Island slider gathers land instead of deleting it', fails.length === 0, fails.join('; '));
  }

  // --- P8: the stored elevation is the elevation the generator classified
  // with. `generate` works on a private copy and writes it back pass by pass;
  // a pass that forgets the write leaves `grid.elevation` stale while every
  // flag and level is right, so nothing looks wrong in the voxel view -- but
  // the top-down hillshade, the hover altitude, the brushes and the exported
  // heightmap all read the stale value. Found 2026-10-04: the pool-filling
  // pass (7c) turned enclosed water into land without the write, leaving up to
  // 11% of the land with a sea-floor height (as deep as 0.43 below sea level).
  // The only land the pipeline leaves under the threshold on purpose is the
  // coast de-speckle (6b), bounded at 0.06.
  {
    const fails = [];
    let worst = 0;
    for (const seed of SEEDS) {
      const g = SM.generate({ seed, width: 160, height: 160, seaLevel: 0.38 });
      let deep = 0;
      for (let i = 0; i < g.width * g.height; i++) {
        if (g.water[i]) continue;
        const under = g.seaThresh - g.elevation[i];
        if (under > worst) worst = under;
        if (under > 0.06) deep++;
      }
      if (deep) fails.push(`seed ${seed}: ${deep} land tiles deeper than 0.06 under sea level`);
    }
    push(`no land tile is stored below the sea floor bound (worst ${worst.toFixed(3)} ≤ 0.06)`,
      fails.length === 0, fails.join('; '));
  }

  // --- P5: no towers, any seed. The README's "no spikes" claim. --------------
  {
    const bad = SEEDS.filter(s => run(s, 160, 0.38).towers > 0);
    push('voxel repair leaves zero towers for every seed', bad.length === 0,
      bad.length ? `seeds with towers: ${bad.join(', ')}` : '');
  }

  console.log(`geo property harness — seeds [${SEEDS.join(', ')}]:`);
  for (const [name, ok, detail] of results) {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`);
    if (detail) console.log(`         ${detail}`);
  }
  if (!results.every(r => r[1])) process.exitCode = 1;
}

// Brush re-derivation (tarama 2026-09-22 #1). The DOM half of the editor lives
// in main.js; `SM.deriveEditedTile` is what every non-river brush calls after it
// touches a tile. The silent failures it guards against: Raise/Lower/Smooth
// re-deriving fresh water from the SEA threshold and drying an above-sea river
// into land, and every water tile being flattened to level 0 while the
// generator puts rivers/lakes at their own height.
function runEditChecks() {
  const SEEDS = [11, 1337, 4242];
  const B = SM.BIOME_IDX;
  const results = [];
  const push = (name, ok, detail) => results.push([name, ok, detail || '']);
  const fresh = (g, i) => g.water[i] && (g.biome[i] === B.river || g.biome[i] === B.lake);
  const levelOf = (g, e) => SM.quantLandLevel(e, g.seaThresh, g.landSpan, g.config.levels);

  let idemFail = [], freshCount = 0, aboveSea = 0;
  let raiseFail = [], lowerFail = [], seaFail = [], deepFail = [];
  let lowLand = 0, lowLandFail = [], highSea = 0, highSeaFail = [];
  for (const seed of SEEDS) {
    const g = SM.generate({ seed, width: 128, height: 128, seaLevel: 0.38 });
    const n = g.width * g.height;

    // 1) An untouched tile is a fixed point: re-deriving it with no elevation
    //    change flips no flag, and water keeps its level. (Land levels are
    //    left out: the generator's tower clamp runs after quantisation and the
    //    editor redoes that clamp per stroke, in `clampEditedTowers`.)
    for (let i = 0; i < n; i++) {
      const w0 = g.water[i], b0 = g.biome[i], l0 = g.level[i];
      SM.deriveEditedTile(g, i, g.elevation[i]);
      if (g.water[i] !== w0 || g.biome[i] !== b0 || (w0 && g.level[i] !== l0)) {
        if (idemFail.length < 4) idemFail.push(`seed ${seed} #${i} ${SM.BIOME_LIST[b0].id} L${l0}→${g.level[i]} w${w0}→${g.water[i]}`);
        g.water[i] = w0; g.biome[i] = b0; g.level[i] = l0;
      }
    }

    // 2) Raise / Lower over fresh water keep it fresh water at its own height.
    for (let i = 0; i < n; i++) {
      if (!fresh(g, i)) continue;
      freshCount++;
      if (g.elevation[i] > g.seaThresh) aboveSea++;
      const e0 = g.elevation[i], b0 = g.biome[i], l0 = g.level[i];
      for (const [delta, fails] of [[+0.04, raiseFail], [-0.04, lowerFail]]) {
        g.elevation[i] = Math.min(1, Math.max(0, e0 + delta));
        SM.deriveEditedTile(g, i, e0);
        if (!g.water[i] || g.biome[i] !== b0 || g.level[i] !== levelOf(g, g.elevation[i])) {
          if (fails.length < 4) fails.push(`seed ${seed} #${i} w${g.water[i]} L${g.level[i]}`);
        }
        g.elevation[i] = e0; g.water[i] = 1; g.biome[i] = b0; g.level[i] = l0;
      }
    }

    // 3) Tiles the generator left on the "wrong" side of the threshold keep
    //    their identity under a dab that moves them further the SAME way:
    //    raising a low beach must not flood it, lowering a high river mouth
    //    must not dry it. Moving them the other way is a genuine crossing.
    for (let i = 0; i < n; i++) {
      if (fresh(g, i)) continue;
      const e0 = g.elevation[i], w0 = g.water[i], b0 = g.biome[i], l0 = g.level[i];
      if (!w0 && e0 <= g.seaThresh) {
        lowLand++;
        g.elevation[i] = Math.min(e0 + 0.002, g.seaThresh);
        SM.deriveEditedTile(g, i, e0);
        if (g.water[i] && lowLandFail.length < 4) lowLandFail.push(`seed ${seed} #${i}`);
      } else if (w0 && e0 > g.seaThresh) {
        highSea++;
        g.elevation[i] = Math.max(e0 - 0.002, g.seaThresh + 1e-4);
        SM.deriveEditedTile(g, i, e0);
        if (!g.water[i] && highSeaFail.length < 4) highSeaFail.push(`seed ${seed} #${i}`);
      }
      g.elevation[i] = e0; g.water[i] = w0; g.biome[i] = b0; g.level[i] = l0;
    }

    // 4) Genuine sea <-> land crossings still follow the sea threshold.
    for (let i = 0; i < n; i += 7) {
      const e0 = g.elevation[i], w0 = g.water[i], b0 = g.biome[i], l0 = g.level[i];
      if (fresh(g, i)) continue;
      if (!w0) {
        if (e0 <= g.seaThresh) continue;
        g.elevation[i] = g.seaThresh - 0.01;
        SM.deriveEditedTile(g, i, e0);
        if (!g.water[i] || g.biome[i] !== B.shallow_water || g.level[i] !== 0) seaFail.push(`land→sea #${i} L${g.level[i]}`);
      } else {
        if (e0 > g.seaThresh) continue;
        g.elevation[i] = g.seaThresh + 0.05;
        SM.deriveEditedTile(g, i, e0);
        if (g.water[i] || SM.BIOME_LIST[g.biome[i]].id.indexOf('water') >= 0 || g.level[i] < 1) seaFail.push(`sea→land #${i} L${g.level[i]}`);
        // 5) The sea stays one flat surface at level 0 under any Lower; depth
        //    is colour (SM.seaColor), never geometry.
        {
          g.elevation[i] = e0; g.water[i] = w0; g.biome[i] = b0; g.level[i] = l0;
          g.elevation[i] = Math.max(0, e0 - 0.01);
          SM.deriveEditedTile(g, i, e0);
          if (g.level[i] !== 0) deepFail.push(`#${i} L${l0}→${g.level[i]}`);
        }
      }
      g.elevation[i] = e0; g.water[i] = w0; g.biome[i] = b0; g.level[i] = l0;
    }
  }

  push('re-deriving an untouched tile changes nothing (flag, biome, water level)', idemFail.length === 0, idemFail.join('; '));
  push(`Raise keeps fresh water fresh at its own level (${freshCount} tiles, ${aboveSea} above sea)`,
    freshCount > 0 && aboveSea > 0 && raiseFail.length === 0, raiseFail.join('; '));
  push('Lower keeps fresh water fresh at its own level', lowerFail.length === 0, lowerFail.join('; '));
  push(`light Raise does not flood low-lying land (${lowLand} tiles at/below sea)`,
    lowLand > 0 && lowLandFail.length === 0, lowLandFail.join('; '));
  push(`light Lower does not dry sea above the threshold (${highSea} tiles)`,
    highSea > 0 && highSeaFail.length === 0, highSeaFail.join('; '));
  push('sea <-> land still follows the sea threshold', seaFail.length === 0, seaFail.slice(0, 4).join('; '));
  push('sea stays flush at level 0 under a light Lower (depth is colour)', deepFail.length === 0, deepFail.slice(0, 4).join('; '));

  // 6) Waterfall tagging is pure geometry on the final levels (the editor
  //    re-tags after every stroke/undo, the generator after voxelize).
  {
    const g = SM.createGrid(6, 3);
    g.config = { levels: 10 };
    for (let i = 0; i < 18; i++) { g.water[i] = 1; g.biome[i] = B.river; g.level[i] = 2; }
    g.level[0] = 6;          // (0,0): 4 above (1,0) and (0,1) → lip
    g.level[3] = 4;          // (3,0): exactly 2 above (4,0) → plain step
    g.water[17] = 0; g.biome[17] = B.grassland; g.level[17] = 9; // land cliff
    const lips = SM.tagWaterfalls(g);
    const ok = lips === 1 && g.waterfalls[0] === 1 && g.waterfallDrop[0] === 4 &&
      g.waterfalls[1] === 2 && g.waterfalls[6] === 2 && g.waterfalls[3] === 0 &&
      g.waterfalls[4] === 0 && g.waterfalls[17] === 0 && g.waterfalls[16] === 0;
    g.level[0] = 3;          // edited down to a 1-level step → no longer a fall
    const again = SM.tagWaterfalls(g) === 0 && g.waterfalls[0] === 0 && g.waterfalls[1] === 0;
    push('waterfall tags: >=3 drop tagged lip+landing, 2-step and land cliff not, re-tag clears', ok && again);
  }

  console.log(`brush re-derivation checks — seeds [${SEEDS.join(', ')}], 128²:`);
  for (const [name, ok, detail] of results) {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`);
    if (detail) console.log(`         ${detail}`);
  }
  if (!results.every(r => r[1])) process.exitCode = 1;
}

// Engine export (portfolio roadmap #4). The bytes a user drags into Unity are
// easy to get silently wrong: a heightmap upside down, off by one row, the
// wrong byte order, or a zip that only THIS code can read. Checked here
// against the grid itself; the zip is re-parsed from its own directory.
function runExportChecks() {
  const results = [];
  const push = (name, ok, detail) => results.push([name, ok, detail || '']);
  const X = SM.Export;

  push('Unity resolution is 2^n+1 and never loses detail',
    X.unityResolution(128) === 129 && X.unityResolution(129) === 257 &&
    X.unityResolution(192) === 257 && X.unityResolution(448) === 513);

  const g = SM.generate({ seed: 1337, width: 192, height: 192, seaLevel: 0.38 });
  const res = X.unityResolution(192);
  const r16 = X.heightmapR16(g, res);
  const at = (r, c) => r16[(r * res + c) * 2] | (r16[(r * res + c) * 2 + 1] << 8);
  const q = v => Math.round(Math.min(1, Math.max(0, v)) * 65535);
  const W = g.width, H = g.height, e = g.elevation;
  push(`heightmap is ${res}² × 16 bit`, r16.length === res * res * 2);
  // Row 0 = SOUTH edge (Unity z = 0); corners land exactly on grid corners.
  const corners = at(0, 0) === q(e[(H - 1) * W]) && at(0, res - 1) === q(e[(H - 1) * W + W - 1]) &&
    at(res - 1, 0) === q(e[0]) && at(res - 1, res - 1) === q(e[W - 1]);
  push('corners: row 0 is the south edge, little-endian, exact at grid corners', corners,
    corners ? '' : `got ${at(0, 0)} want ${q(e[(H - 1) * W])}`);

  // Registration against the 1-px-per-cell textures: a cell is an area and
  // its height sits at its CENTRE. One raised cell on an 8² grid at 33²:
  // cell (5, 2) has its centre at u = 5.5/8, v(from the north) = 2.5/8, i.e.
  // column 22 and -- rows run south to north -- row 22. The old corner-to-
  // corner mapping (u * (W-1)) put no sample on that centre at all.
  {
    const n = 8, tiny = { width: n, height: n, elevation: new Float32Array(n * n) };
    tiny.elevation[2 * n + 5] = 1;
    const tr = X.unityResolution(n), t16 = X.heightmapR16(tiny, tr);
    const tat = (r, c) => t16[(r * tr + c) * 2] | (t16[(r * tr + c) * 2 + 1] << 8);
    let peak = [0, 0], best = -1;
    for (let r = 0; r < tr; r++) for (let c = 0; c < tr; c++) if (tat(r, c) > best) { best = tat(r, c); peak = [r, c]; }
    push('heightmap samples cell centres: a raised cell peaks where its texel is',
      tr === 33 && best === 65535 && peak[0] === 22 && peak[1] === 22,
      `peak ${best} at row ${peak[0]}, col ${peak[1]} (want 65535 at 22, 22)`);
  }

  const meta = X.exportMeta(g);
  const rivers = g.biome.filter(b => b === SM.BIOME_IDX.river).length;
  const lips = g.waterfalls.filter(v => v === 1).length;
  push('map.json: sea level, rivers, waterfalls, legend match the grid',
    meta.seaLevelNormalized === g.seaThresh && meta.rivers.length === rivers &&
    meta.waterfalls.length === lips && meta.biomes.length === SM.BIOME_LIST.length &&
    meta.heightmap.resolution === res);

  // zip: walk the central directory, re-read every local entry, check CRC.
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // stand-in bytes
  const zip = X.buildUnityBundle(g, { albedo: png, biome: png });
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  let names = [], zipOk = dv.getUint32(eocd, true) === 0x06054b50;
  if (zipOk) {
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    for (let k = 0; k < count && zipOk; k++) {
      zipOk = dv.getUint32(p, true) === 0x02014b50;
      const crc = dv.getUint32(p + 16, true), len = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), off = dv.getUint32(p + 42, true);
      const name = Buffer.from(zip.subarray(p + 46, p + 46 + nlen)).toString('utf8');
      zipOk = zipOk && dv.getUint32(off, true) === 0x04034b50;
      const data = zip.subarray(off + 30 + nlen, off + 30 + nlen + len);
      zipOk = zipOk && X.crc32(data) === crc;
      if (name === 'map.json') {
        try { zipOk = zipOk && JSON.parse(Buffer.from(data).toString('utf8')).seed === 1337; }
        catch (err) { zipOk = false; }
      }
      names.push(name);
      p += 46 + nlen;
    }
  }
  push(`zip: directory + CRCs valid (${names.join(', ')})`, zipOk && names.length === 5);
  push('crc32 matches the reference value for "123456789"',
    X.crc32(new Uint8Array(Buffer.from('123456789'))) === 0xCBF43926);
  const again = X.buildUnityBundle(g, { albedo: png, biome: png });
  push('bundle is deterministic', Buffer.compare(Buffer.from(zip), Buffer.from(again)) === 0);

  // The UI button is OFF for now (Uğur 2026-10-05, "şimdilik kapalı"), but the
  // feature must stay one flag away from coming back: the hidden row and its
  // button are still in index.html, and main.js still wires them behind
  // UNITY_EXPORT_ENABLED. If either half is deleted this goes red.
  {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
    const flag = /var UNITY_EXPORT_ENABLED = (true|false);/.exec(mainJs);
    const row = /<div class="toolrow" id="exportUnityRow"( hidden)?>\s*<button id="exportUnity"/.exec(html);
    push('Unity button is kept in index.html and wired behind UNITY_EXPORT_ENABLED (hidden while off)',
      !!flag && !!row && /function exportUnity\(/.test(mainJs) &&
      /if \(UNITY_EXPORT_ENABLED\)[\s\S]{0,200}\$\('exportUnity'\)\.addEventListener\('click', exportUnity\)/.test(mainJs) &&
      (flag[1] === 'true' || !!row[1]),
      flag ? `UNITY_EXPORT_ENABLED = ${flag[1]}` : 'flag missing in main.js');
  }

  if (process.env.EXPORT_ZIP_OUT) fs.writeFileSync(process.env.EXPORT_ZIP_OUT, zip);
  console.log('export checks (seed 1337, 192²):');
  for (const [name, ok, detail] of results) {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`);
    if (detail) console.log(`         ${detail}`);
  }
  if (!results.every(r => r[1])) process.exitCode = 1;
}

// World type presets (moved out of main.js into src/worldtypes.js, 2026-09-23,
// so they can be verified without a browser). Four claims:
//   1) every preset's values are actually reachable on its slider -- inside
//      [min, max] AND landing on a step from min, per index.html;
//   2) SM.WorldTypes.match() round-trips every preset back to its own name;
//   3) a value nudged off a preset reads as 'custom', not a false match;
//   4) every key a preset touches is in main.js's QS_KEYS, so a shared link
//      actually carries the preset (silent failure mode: add a slider to a
//      preset, forget the querystring, links quietly drop it).
// A fifth check measures that presets DO something: on a small shared grid,
// frozen/arid/tropical shift the expected biome share versus continents. This
// is what would have caught a preset whose slider values happen to be in
// range but too weak (or backwards) to change the map.
function parseRangeInputs(html) {
  const inputs = {};
  const tagRe = /<input\b[^>]*type="range"[^>]*>/g;
  let m;
  while ((m = tagRe.exec(html))) {
    const tag = m[0];
    const idm = /\bid="([^"]+)"/.exec(tag);
    if (!idm) continue;
    const attr = (name) => {
      const am = new RegExp('\\b' + name + '="([^"]+)"').exec(tag);
      return am ? parseFloat(am[1]) : NaN;
    };
    inputs[idm[1]] = { min: attr('min'), max: attr('max'), step: attr('step') };
  }
  return inputs;
}

function parseQsKeys(mainJs) {
  const m = /var\s+QS_KEYS\s*=\s*\[([\s\S]*?)\];/.exec(mainJs);
  if (!m) return [];
  return m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

// Slider id -> SM.generate() config key. Mirrors main.js's `readConfig()`,
// which is the DOM half of this same mapping.
const WORLDTYPE_CONFIG_KEY = {
  sea: 'seaLevel', rugged: 'ruggedness', warp: 'warp', escale: 'elevationScale',
  octaves: 'octaves', island: 'islandFalloff', tbias: 'temperatureBias',
  mbias: 'moistureBias', rivers: 'rivers'
};

function worldTypeGenConfig(type, seed, size) {
  const values = SM.WorldTypes.values(type);
  const cfg = { seed, width: size, height: size };
  for (const key of SM.WorldTypes.KEYS) cfg[WORLDTYPE_CONFIG_KEY[key]] = values[key];
  return cfg;
}

function landShare(grid, biomeIdxList) {
  let land = 0, match = 0;
  for (let i = 0; i < grid.biome.length; i++) {
    if (grid.water[i]) continue;
    land++;
    if (biomeIdxList.includes(grid.biome[i])) match++;
  }
  return land ? match / land : 0;
}

function runWorldTypesChecks() {
  const results = [];
  const push = (name, ok, detail) => results.push([name, ok, detail || '']);
  const WT = SM.WorldTypes;
  const types = Object.keys(WT.TYPES);

  // 1) Every preset value is reachable on its slider: inside [min, max] and a
  //    whole number of steps from min (float32/64 tolerance).
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const sliders = parseRangeInputs(html);
  {
    const bad = [];
    for (const type of types) {
      const values = WT.values(type);
      for (const key of WT.KEYS) {
        const slider = sliders[key];
        if (!slider || !Number.isFinite(slider.min) || !Number.isFinite(slider.max) ||
            !Number.isFinite(slider.step)) {
          bad.push(`${type}.${key}: no <input type=range id="${key}"> in index.html`);
          continue;
        }
        const v = values[key];
        const eps = 1e-6;
        if (v < slider.min - eps || v > slider.max + eps) {
          bad.push(`${type}.${key}=${v} outside [${slider.min}, ${slider.max}]`);
          continue;
        }
        const steps = (v - slider.min) / slider.step;
        if (Math.abs(steps - Math.round(steps)) > 1e-6) {
          bad.push(`${type}.${key}=${v} is not a step of ${slider.step} from min ${slider.min}`);
        }
      }
    }
    push(`every preset value is within its slider's min/max/step (${types.length} types × ${WT.KEYS.length} keys)`,
      bad.length === 0, bad.join('; '));
  }

  // 2) match(values(type)) === type for every preset -- the round trip a
  //    shared link and the world-type <select> both depend on.
  {
    const bad = [];
    for (const type of types) {
      const values = WT.values(type);
      const got = WT.match(id => values[id]);
      if (got !== type) bad.push(`${type} -> matched '${got}'`);
    }
    push('match(values(type)) round-trips every preset to its own name', bad.length === 0, bad.join('; '));
  }

  // 3) A perturbed value must read as 'custom', not a false-positive match --
  //    otherwise a user who nudges one slider still sees a preset name that
  //    no longer describes their map.
  {
    const base = WT.values('continents');
    const perturbed = Object.assign({}, base, { sea: base.sea + 0.05 });
    const got = WT.match(id => perturbed[id]);
    push(`a perturbed value ('sea' +0.05) matches 'custom', not a stale preset`,
      got === 'custom', `got '${got}'`);
  }

  // 4) Every key a preset can set is in QS_KEYS, so `shareLink()` actually
  //    carries it -- otherwise opening a shared link silently drops back to
  //    default terrain shape while claiming to reproduce the map.
  {
    const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
    const qsKeys = new Set(parseQsKeys(mainJs));
    const missing = WT.KEYS.filter(k => !qsKeys.has(k));
    push(`every SM.WorldTypes.KEYS entry is in main.js QS_KEYS (${qsKeys.size} keys parsed)`,
      qsKeys.size > 0 && missing.length === 0, missing.join(', '));
  }

  // 5) Measured effect: presets actually move the expected biome share versus
  //    plain 'continents', on a small shared grid, over more than one seed.
  //    A preset whose slider values are in-range but too weak (or aimed the
  //    wrong way) to change the map would pass checks 1-4 and still be dead.
  {
    const SEEDS = [1337, 4242];
    const SIZE = 96;
    const B = SM.BIOME_IDX;
    const cold = g => landShare(g, [B.tundra, B.taiga]);
    const desert = g => landShare(g, [B.desert]);
    const jungle = g => landShare(g, [B.jungle]);
    const claims = [
      ['frozen has more tundra+taiga share of land than continents', 'frozen', cold],
      ['arid has more desert share of land than continents', 'arid', desert],
      ['tropical has more jungle share of land than continents', 'tropical', jungle]
    ];
    for (const [name, type, metric] of claims) {
      const bad = [];
      for (const seed of SEEDS) {
        const base = SM.generate(worldTypeGenConfig('continents', seed, SIZE));
        const preset = SM.generate(worldTypeGenConfig(type, seed, SIZE));
        const baseShare = metric(base), presetShare = metric(preset);
        if (!(presetShare > baseShare)) {
          bad.push(`seed ${seed}: continents ${(baseShare * 100).toFixed(1)}% vs ${type} ${(presetShare * 100).toFixed(1)}%`);
        }
      }
      push(`${name} (${SEEDS.length} seeds, ${SIZE}²)`, bad.length === 0, bad.join('; '));
    }
  }

  console.log(`world type preset checks (${types.length} types: ${types.join(', ')}):`);
  for (const [name, ok, detail] of results) {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`);
    if (detail) console.log(`         ${detail}`);
  }
  if (!results.every(r => r[1])) process.exitCode = 1;
}

// --- UI language (TR / EN) -------------------------------------------------
// The panel is bilingual (Uğur 2026-10-05: everything on bilaxten.art exists in
// Turkish and English). Two ways it silently rots: a key added in one language
// only (the other shows the English fallback or the bare key), and a new
// element in index.html with visible text but no hook (it stays English in
// Turkish mode). Both fail here. Not covered: strings built in JS that never
// go through T() -- only the obvious `.textContent/.title/.innerHTML = '...'`
// literal pattern in main.js is caught.

// Minimal tag tokenizer for our own index.html (no dependency): yields the
// element stack so every text node knows its parent and ancestors.
function walkHtml(html, onText, onElement) {
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'source', 'track', 'wbr']);
  const tokenRe = /<!--[\s\S]*?-->|<!doctype[^>]*>|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/gi;
  const attrRe = /([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  const stack = [];
  let m;
  while ((m = tokenRe.exec(html))) {
    if (m[5] != null) { if (stack.length) onText(m[5], stack); continue; }
    if (!m[2]) continue; // comment / doctype
    const tag = m[2].toLowerCase();
    if (m[1]) { // closing tag: pop to the matching open element
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].tag === tag) { stack.length = k; break; }
      }
      continue;
    }
    const attrs = {};
    let a;
    attrRe.lastIndex = 0;
    while ((a = attrRe.exec(m[3] || ''))) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
    const el = { tag, attrs, line: html.slice(0, m.index).split('\n').length, texts: 0 };
    onElement(el, stack);
    if (tag === 'script' || tag === 'style') { // raw text: skip to its end tag
      const end = html.toLowerCase().indexOf('</' + tag, tokenRe.lastIndex);
      tokenRe.lastIndex = end < 0 ? html.length : end;
      continue;
    }
    if (!m[4] && !VOID.has(tag)) stack.push(el);
  }
}

function runI18nChecks() {
  const results = [];
  const push = (name, ok, detail) => results.push([name, ok, detail || '']);
  const I = SM.I18N;
  const langs = Object.keys(I.STRINGS);
  const en = I.STRINGS.en, tr = I.STRINGS.tr;

  // 1) Both languages carry the same keys, none empty, same {placeholders}.
  {
    const bad = [];
    const all = new Set([...Object.keys(en), ...Object.keys(tr)]);
    const ph = s => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
    for (const key of all) {
      for (const l of ['en', 'tr']) {
        const v = I.STRINGS[l][key];
        if (v == null) bad.push(`${key}: missing in ${l}`);
        else if (typeof v !== 'string' || !v.trim()) bad.push(`${key}: empty in ${l}`);
      }
      if (en[key] != null && tr[key] != null && ph(en[key]) !== ph(tr[key])) {
        bad.push(`${key}: placeholders differ (en ${ph(en[key]) || '-'} / tr ${ph(tr[key]) || '-'})`);
      }
    }
    push(`tr and en have the same ${all.size} keys, none empty, same placeholders (languages: ${langs.join(', ')})`,
      bad.length === 0 && langs.length === 2, bad.join('; '));
  }

  // 2) index.html: every visible text and every title/aria-label/placeholder/alt
  //    has a hook, and every hook names a key that exists.
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  {
    const noHook = [], badKey = [], multi = [];
    const hasLetters = s => /\p{L}/u.test(s.replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, ''));
    const exempt = stack => stack.some(e => e.attrs.translate === 'no');
    const keyOk = (key, el, what) => {
      if (!key || en[key] == null || tr[key] == null) {
        badKey.push(`line ${el.line} <${el.tag}> ${what}="${key}" is not in both languages`);
      }
    };
    walkHtml(html, (text, stack) => {
      if (!hasLetters(text)) return;
      const parent = stack[stack.length - 1];
      if (exempt(stack)) return;
      if ('data-i18n' in parent.attrs || 'data-i18n-js' in parent.attrs) {
        // apply() rewrites only the FIRST text node of an element with children.
        if (++parent.texts > 1 && 'data-i18n' in parent.attrs) {
          multi.push(`line ${parent.line} <${parent.tag}> has more than one text node; only the first is translated`);
        }
        return;
      }
      noHook.push(`line ${parent.line} <${parent.tag}> "${text.trim().slice(0, 40)}"`);
    }, (el, stack) => {
      const self = [...stack, el];
      if ('data-i18n' in el.attrs) keyOk(el.attrs['data-i18n'], el, 'data-i18n');
      for (const attr of I.ATTRS) {
        const hook = 'data-i18n-' + attr;
        if (hook in el.attrs) keyOk(el.attrs[hook], el, hook);
        if (attr in el.attrs && hasLetters(el.attrs[attr]) && !(hook in el.attrs) && !exempt(self)) {
          noHook.push(`line ${el.line} <${el.tag}> ${attr}="${el.attrs[attr].slice(0, 40)}" without ${hook}`);
        }
      }
    });
    push('every visible text and title/aria-label/placeholder/alt in index.html has a translation hook',
      noHook.length === 0, noHook.join('; '));
    push('every data-i18n* hook in index.html names a key that exists in both languages',
      badKey.length === 0, badKey.join('; '));
    push('no data-i18n element has a second text node that apply() would leave untranslated',
      multi.length === 0, multi.join('; '));
  }

  // 3) Keys main.js asks for: literal T('key') calls, plus the keys it builds
  //    from data ids (biome legend/select/hover, pipeline stage label/desc).
  {
    const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
    const bad = [];
    const used = new Set();
    let m;
    // T('key') -- but not T('biome.' + id): a prefix is checked below by id.
    const callRe = /\bT\(\s*'([^']+)'\s*(?=[,)])/g;
    while ((m = callRe.exec(mainJs))) used.add(m[1]);
    const ternRe = /\bT\(([^()]*\?[^()]*)\)/g; // T(cond ? 'a' : 'b')
    while ((m = ternRe.exec(mainJs))) for (const q of m[1].match(/'([^']+)'/g) || []) used.add(q.slice(1, -1));
    for (const b of SM.BIOME_LIST) used.add('biome.' + b.id);
    for (const st of SM.PIPELINE_STAGES) { used.add('stage.' + st.id + '.label'); used.add('stage.' + st.id + '.desc'); }
    for (const key of used) if (en[key] == null || tr[key] == null) bad.push(key);
    push(`all ${used.size} keys main.js uses (literal T() calls, biome ids, pipeline stages) exist in both languages`,
      bad.length === 0, bad.join(', '));

    // Hard-coded UI text written straight into the DOM, bypassing T().
    const raw = [];
    const rawRe = /\.(textContent|title|innerHTML|placeholder)\s*=\s*(['"])((?:(?!\2).)*)\2/gu;
    while ((m = rawRe.exec(mainJs))) {
      // Markup inside an innerHTML literal ('<span class="sw" ...') is not text.
      if (!/\p{L}/u.test(m[3].replace(/<[^>]*(>|$)/g, ''))) continue;
      raw.push(`line ${mainJs.slice(0, m.index).split('\n').length}: .${m[1]} = ${m[2]}${m[3].slice(0, 40)}${m[2]}`);
    }
    push('main.js writes no literal text straight into .textContent/.title/.innerHTML/.placeholder',
      raw.length === 0, raw.join('; '));
  }

  // 4) The language switch itself: two buttons tr/en and the shared key.
  {
    const btns = (html.match(/data-set-lang="(tr|en)"/g) || []).length;
    const i18nSrc = fs.readFileSync(path.join(root, 'i18n.js'), 'utf8');
    push('index.html has the TR and EN buttons; i18n.js uses the shared bx-lang key and loads in <head>',
      btns === 2 && /'bx-lang'/.test(i18nSrc) &&
      /<head>[\s\S]*<script src="src\/i18n\.js"><\/script>[\s\S]*<\/head>/.test(html),
      btns === 2 ? '' : `data-set-lang buttons: ${btns}`);
  }

  // 5) Theme + language behave like bilaxten.art (Uğur 2026-10-05): with no
  //    saved choice English and dark; `bx-theme` (the main site's key) read
  //    before Cartula's `sm-theme`, both written on a switch; the re-type
  //    restores detached-safe and is skipped with reduced motion.
  {
    const i18nSrc = fs.readFileSync(path.join(root, 'i18n.js'), 'utf8');
    const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
    const head = html.slice(0, html.indexOf('</head>'));
    const bxFirst = head.indexOf("getItem('bx-theme')"), smAfter = head.indexOf("getItem('sm-theme')");
    push('defaults: English with no saved language (no browser-language guess), dark with no saved theme',
      /var lang = readSaved\(\) \|\| 'en';/.test(i18nSrc) && !/navigator\.language/.test(i18nSrc) &&
      /if \(t !== 'dark' && t !== 'light'\) t = 'dark';/.test(head) && !/prefers-color-scheme/.test(head),
      '');
    push('theme: bx-theme read before sm-theme; a switch writes both keys',
      bxFirst > 0 && smAfter > bxFirst &&
      /setItem\('bx-theme', next\);\s*localStorage\.setItem\('sm-theme', next\);/.test(mainJs), '');
    push('re-type: restores only attached wraps, finishes before apply(), off with reduced motion',
      /if \(w\.wrap\.parentNode\) w\.wrap\.parentNode\.replaceChild\(w\.node, w\.wrap\);/.test(i18nSrc) &&
      /finishTyping\(\);\s*lang = next;\s*markRoot\(\);\s*apply\(document\);/.test(i18nSrc) &&
      /prefers-reduced-motion: reduce/.test(i18nSrc), '');
  }

  console.log('UI language checks (tr / en):');
  for (const [name, ok, detail] of results) {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`);
    if (detail) console.log(`         ${detail}`);
  }
  if (!results.every(r => r[1])) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// --perf : the performance panel's numbers must be honest. Stats math on known
// input; the GL counter counts only while enabled; and no render file draws or
// allocates behind the counter's back (a raw gl.drawElements would silently
// drop out of "draw calls", a raw gl.bufferData out of "GPU memory").
// ---------------------------------------------------------------------------
function runPerfChecks() {
  const results = [];
  const push = (name, ok, detail) => results.push([name, ok, detail || '']);
  const near = (a, b) => Math.abs(a - b) < 1e-9;

  {
    const st = SM.Perf.createFrameStats(120);
    st.push(NaN, 2);                 // first frame after idle: no interval
    st.push(10, 1); st.push(20, 3); st.push(30, 2);
    const s = st.summary();
    push('frame stats: avg / worst / fps over drawn intervals, idle gap ignored',
      s.frames === 4 && s.intervals === 3 && near(s.avgMs, 20) && near(s.worstMs, 30) &&
      near(s.fps, 50) && near(s.cpuAvgMs, 2) && near(s.cpuWorstMs, 3) && s.gpuAvgMs === null,
      JSON.stringify(s));
    for (let i = 0; i < 300; i++) st.push(i < 290 ? 16 : 40, 1);
    const w = st.summary();
    push('frame stats: rolling window keeps exactly the last 120 frames',
      w.frames === 120 && w.intervals === 120 && near(w.worstMs, 40) &&
      near(w.avgMs, (110 * 16 + 10 * 40) / 120), JSON.stringify(w));
  }

  {
    const calls = [];
    const gl = {
      TRIANGLES: 4, TRIANGLE_STRIP: 5, TRIANGLE_FAN: 6, LINES: 1, POINTS: 0,
      drawElements: (...a) => calls.push(['el', ...a]),
      drawArrays: (...a) => calls.push(['ar', ...a]),
      bufferData: (...a) => calls.push(['bd', ...a])
    };
    const c = SM.Perf.createGLCounter(gl);
    c.beginFrame();
    c.drawElements(gl.TRIANGLES, 300, 0, 0);
    c.endFrame();
    const hidden = c.lastFrame();
    c.setEnabled(true);
    c.beginFrame();
    c.drawElements(gl.TRIANGLES, 300, 0, 0);
    c.drawArrays(gl.TRIANGLE_STRIP, 0, 10);
    c.drawArrays(gl.POINTS, 0, 7);
    c.endFrame();
    const f = c.lastFrame();
    push('GL counter: nothing counted while hidden, every call still reaches GL',
      hidden.draws === 0 && hidden.tris === 0 && calls.filter(k => k[0] !== 'bd').length === 4,
      JSON.stringify(hidden));
    push('GL counter: draw calls and triangles per mode (300 indexed tris -> 100, strip of 10 -> 8, points apart)',
      f.draws === 3 && f.tris === 108 && f.other === 7, JSON.stringify(f));
    const b1 = {}, b2 = {}, t1 = {};
    c.bufferData(34962, b1, new Float32Array(100), 0);
    c.bufferData(34962, b2, new Uint8Array(10), 0);
    c.bufferData(34962, b1, new Float32Array(50), 0);   // re-upload replaces
    c.texture(t1, 64 * 64);
    let m = c.memory();
    const okA = m.buffer === 210 && m.texture === 4096 && m.total === 4306;
    c.forget(b2);
    m = c.memory();
    push('GL counter: memory is the sum of live allocations (re-upload replaces, delete forgets)',
      okA && m.buffer === 200 && m.total === 4296, JSON.stringify(m));
    push('drawing buffer estimate: 100x50, 4x MSAA = 2 resolved RGBA8 + 4 samples x (colour + depth)',
      SM.Perf.drawingBufferBytes(100, 50, 4) === 5000 * 8 + 5000 * 4 * 8 &&
      SM.Perf.drawingBufferBytes(100, 50, 0) === 5000 * 12, '');
  }

  {
    const bad = [];
    const dir = path.join(root, 'render');
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js'))) {
      if (f === 'topdown.js') continue;   // Canvas 2D, no GL
      const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
      lines.forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '');
        if (/\bgl\.(drawElements|drawArrays|drawElementsInstanced|drawArraysInstanced|drawRangeElements|bufferData)\s*\(/.test(code)) {
          bad.push(`${f}:${i + 1} raw ${code.trim().slice(0, 50)}`);
        }
        if (/\bgl\.(texImage2D|texStorage2D|renderbufferStorage(Multisample)?)\s*\(/.test(code)) {
          const ahead = lines.slice(i, i + 16).join('\n');
          if (!/acct\.(texture|renderbuffer)\(/.test(ahead)) bad.push(`${f}:${i + 1} allocation without acct.texture/renderbuffer`);
        }
      });
    }
    push('render/*.js: every draw call and allocation goes through the counter', bad.length === 0, bad.join('; '));
    const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
    push('main.js measures frames only while the panel is open',
      /if \(perf\.on\) renderMeasured\(now\);\s*else voxelRenderer\.render\(\);/.test(mainJs) &&
      (mainJs.match(/renderMeasured\(/g) || []).length === 2, '');
  }

  console.log('performance panel checks:');
  for (const [name, ok, detail] of results) {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`);
    if (!ok && detail) console.log(`         ${detail}`);
  }
  if (!results.every(r => r[1])) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// --night : settlement window lights + bloom (2026-10-05). Lights may only
// sit on settlement voxels, fade with the clock without popping, and the
// shader grade that replaced the CSS night wash must equal the CSS formula.
// ---------------------------------------------------------------------------
function runNightChecks() {
  const results = [];
  const push = (name, ok, detail) => results.push([name, ok, detail || '']);
  const TOWN = SM.BIOME_LIST.findIndex(b => b.id === 'town');

  // Night lights since 2026-10-05 (owner: "biz ev koymuyoruz ki niye
  // parlamalar var?"): only hut WINDOW faces carry the light flag -- no
  // settlement tile does -- and the bloom source holds hut windows and lava.
  for (const seed of [1337, 4242, 90210]) {
    const g = run(seed, 128, 0.38).grid;
    const mesh = SM.buildVoxelMesh(g);
    const W = g.width, H = g.height;
    // Independent model of a window face: the outward face of a G voxel.
    const windowCells = new Map();
    for (const h of g.huts) {
      for (const v of SM.Huts.voxels(g, h)) if (v.m === 'G') windowCells.set(v.x + ',' + v.y, v.level);
    }
    let flagged = 0, wrong = 0, onTown = 0, lavaV = 0, lavaWrong = 0;
    for (let v = 0; v < mesh.vertexCount; v++) {
      const x = Math.floor(mesh.cellUV[v * 2] * W);
      const y = Math.floor(mesh.cellUV[v * 2 + 1] * H);
      const i = y * W + x;
      if (mesh.town[v]) {
        flagged++;
        const lvl = windowCells.get(x + ',' + y);
        const py = mesh.positions[v * 3 + 1];
        if (lvl == null || py < lvl - 1e-6 || py > lvl + 1 + 1e-6 || mesh.normals[v * 3 + 1] !== 0) wrong++;
        if (g.biome[i] === TOWN && lvl == null) onTown++;
      }
      if (mesh.emissive[v] > 0) {
        lavaV++;
        if (!g.lava[i] || mesh.town[v]) lavaWrong++;
      }
    }
    const windows = g.huts.filter(h => SM.Huts.voxels(g, h).length).length * 2;
    const towns = g.biome.filter((b, i) => b === TOWN && !g.water[i]).length;
    push(`seed ${seed}: the light flag sits only on hut window faces (${flagged} vertices = ${windows} windows x 4), ` +
      `none on the ${towns} settlement tiles`,
      flagged === windows * 4 && windows >= 6 && wrong === 0 && onTown === 0 && mesh.town.length === mesh.vertexCount,
      `wrong ${wrong}, on town ${onTown}`);
    push(`seed ${seed}: bloom source inputs: lava faces carry emission (${lavaV} vertices), only on lava, never a window`,
      lavaWrong === 0 && (lavaV > 0 || !g.lava.some(Boolean)), `wrong ${lavaWrong}`);
    // The renderer draws window triangles in their own range at night:
    // the reordered buffer must hold exactly the same triangles.
    const ord = SM.voxelSettlementLast(mesh.indices, mesh.town);
    const key = (arr, t) => arr[t] + ',' + arr[t + 1] + ',' + arr[t + 2];
    const before = [], after = [];
    for (let t = 0; t < mesh.indices.length; t += 3) { before.push(key(mesh.indices, t)); after.push(key(ord.indices, t)); }
    let split = true;
    for (let t = 0; t < ord.indices.length; t += 3) {
      if (!!mesh.town[ord.indices[t]] !== (t >= ord.townStart)) { split = false; break; }
    }
    push(`seed ${seed}: window-last index order keeps every triangle, splits exactly at the boundary (${(ord.indices.length - ord.townStart) / 3} window triangles)`,
      split && ord.indices.length === mesh.indices.length && ord.townStart % 3 === 0 &&
      before.sort().join(';') === after.sort().join(';'), '');
  }

  {
    // The lava halo pulses from a static (cacheable) blurred source: the
    // composite rebuilds the average pulse of the tiles under a pixel from
    // the blurred (G, B, A) phasor channels. Model it with 8-bit storage.
    const q8 = v => Math.round(Math.max(0, Math.min(1, v)) * 255) / 255;
    let worst = 0;
    let rs = 11;
    const rnd = () => { rs = (rs * 1103515245 + 12345) % 2147483648; return rs / 2147483648; };
    for (let trial = 0; trial < 200; trial++) {
      const tiles = [];
      const n = 1 + Math.floor(rnd() * 12);
      for (let k = 0; k < n; k++) tiles.push({ w: rnd() < 0.3 ? 0 : rnd(), phase: rnd() * 300 });
      const sw = tiles.reduce((s, t) => s + 1, 0);
      const G = q8(tiles.reduce((s, t) => s + t.w, 0) / sw);
      const B = q8(tiles.reduce((s, t) => s + t.w * (0.5 + 0.5 * Math.cos(t.phase)), 0) / sw);
      const A = q8(tiles.reduce((s, t) => s + t.w * (0.5 + 0.5 * Math.sin(t.phase)), 0) / sw);
      for (const time of [0, 0.7, 3.3, 41.9]) {
        const w = time * 2.4;
        const want = tiles.reduce((s, t) => s + t.w * (0.42 + 0.42 * (0.55 + 0.45 * Math.sin(w + t.phase))), 0) / sw;
        const got = Math.max(0, 0.651 * G + 0.189 * ((2 * B - G) * Math.sin(w) + (2 * A - G) * Math.cos(w)));
        worst = Math.max(worst, Math.abs(got - want));
      }
    }
    const post = fs.readFileSync(path.join(root, 'render', 'post.js'), 'utf8');
    push(`lava halo: the composite rebuilds the per-tile pulse from the blurred phasor channels (worst error ${worst.toFixed(4)} with 8-bit storage)`,
      worst < 0.01 && /0\.651 \* s\.g \+ 0\.189 \* \(lavaCos \* uPulse\.x \+ lavaSin \* uPulse\.y\)/.test(post) &&
      /Math\.sin\(look\.time \* 2\.4\), Math\.cos\(look\.time \* 2\.4\)/.test(post) && /outColor = c;/.test(post), '');
  }

  {
    const n = h => SM.nightAmount(h);
    let maxStep = 0;
    for (let h = 0; h < 48; h += 0.01) maxStep = Math.max(maxStep, Math.abs(n(h + 0.01) - n(h)));
    let monotone = true;
    for (let h = 17; h < 19; h += 0.05) if (n(h + 0.05) < n(h)) monotone = false;
    for (let h = 5; h < 7; h += 0.05) if (n(h + 0.05) > n(h)) monotone = false;
    const dayZero = [7, 9, 12, 14, 16.9].every(h => n(h) === 0);
    const nightOne = [19, 22, 0, 3, 4.9, 27].every(h => n(h) === 1);
    push('night curve: 0 from 7:00 to 17:00, 1 from 19:00 to 5:00, half at sunset/sunrise, monotone, no pop',
      dayZero && nightOne && Math.abs(n(18) - 0.5) < 1e-9 && Math.abs(n(6) - 0.5) < 1e-9 &&
      Math.abs(n(30) - n(6)) < 1e-9 && monotone && maxStep < 0.02,
      `max step per 0.01 h ${maxStep.toFixed(4)}`);
  }

  {
    // Independent CSS reference: brightness, clamp, saturate matrix (Filter
    // Effects spec, sRGB), clamp, then multiply-blend of rgba(wash, a).
    const css = (c, wash, a, b, s) => {
      const cl = v => Math.max(0, Math.min(1, v));
      const x = c.map(v => cl(v * b));
      const m = [
        [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
        [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
        [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s]
      ];
      const y = m.map(r => cl(r[0] * x[0] + r[1] * x[1] + r[2] * x[2]));
      return y.map((v, k) => (1 - a) * v + a * v * wash[k] / 255);
    };
    const cases = [
      [[34, 50, 102], 0.64, 0.62, 0.82], [[255, 150, 95], 0.31, 0.84, 1.14],
      [[255, 250, 235], 0, 1.02, 1]
    ];
    let worst = 0;
    for (const [wash, a, b, s] of cases) {
      const grade = { tint: wash.map(c => 1 - a + a * c / 255), brightness: b, saturate: s };
      for (const c of [[0.1, 0.2, 0.3], [0.9, 0.8, 0.2], [1, 1, 1], [0, 0, 0], [0.4, 0.6, 0.35]]) {
        const got = SM.voxelGradeColor(c, grade), want = css(c, wash, a, b, s);
        for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(got[k] - want[k]));
      }
    }
    const id = SM.voxelGradeColor([0.2, 0.5, 0.7], { tint: [1, 1, 1], brightness: 1, saturate: 1 });
    push('shader grade (JS twin) equals the CSS brightness + saturate + multiply wash it replaced',
      worst < 1e-9 && Math.abs(id[0] - 0.2) < 1e-9 && Math.abs(id[2] - 0.7) < 1e-9,
      `worst ${worst}`);
  }

  {
    const src = fs.readFileSync(path.join(root, 'render', 'voxel3d.js'), 'utf8');
    const lightLines = src.split('\n').filter(l => /uLightColor \*/.test(l));
    push('terrain shader: the window light colour is only ever multiplied by the window flag',
      lightLines.length === 1 && lightLines.every(l => /\(town \*/.test(l)) &&
      /vAO = aAO \+ 4\.0 \* aTown;/.test(src) && /float town = step\(3\.5, vAO\);/.test(src) &&
      /cellTown = v\.m === 'G' \? 1 : 0;/.test(src) && !/cellTown = grid\.biome/.test(src),
      lightLines.join(' | '));
    push('bloom runs only at night and never in debug views; lava pulses in the composite, not the source',
      /if \(bloom && glowU && bloomOn && !debugView && nightLight > 0\.001\)/.test(src) &&
      /bloomLook\.lavaStrength = LAVA_BLOOM \* nightLight;/.test(src), '');
  }

  {
    // Day variant = no night code compiled in (SwiftShader runs both sides of
    // a branch, so dead night code cost ~18 ms a frame by day). A minimal
    // #ifdef/#if defined/#else/#endif preprocessor over the real sources.
    const pre = (text, defs) => {
      const out = [], stack = [];
      for (const line of text.split('\n')) {
        const t = line.trim();
        let m;
        if ((m = t.match(/^#ifdef (\w+)/))) stack.push(defs.has(m[1]));
        else if (t.startsWith('#if ')) stack.push([...t.matchAll(/defined\((\w+)\)/g)].some(d => defs.has(d[1])));
        else if (t === '#else') stack.push(!stack.pop());
        else if (t === '#endif') stack.pop();
        else if (stack.every(Boolean)) out.push(line);
      }
      return out.join('\n');
    };
    const frag = v => pre(SM.voxelTerrainShaderSources(v).fragment, new Set(v.split(' ').filter(Boolean)));
    const day = frag(''), night = frag('NIGHT'), windows = frag('NIGHT WINDOWS'), glow = frag('GLOW');
    const nightOnly = ['grade(', 'uNightLight', 'uLightColor'];
    const leaked = nightOnly.filter(k => day.includes(k));
    push('day terrain shader compiles none of the night code; lava goes past the grade only at night; the window light only in NIGHT WINDOWS; glow returns before lighting with windows in R and lava in G/B/A',
      leaked.length === 0 && nightOnly.every(k => windows.includes(k)) &&
      night.includes('grade(') && /emission \* \(uNightLight \*/.test(night) && !/emission \* \(uNightLight/.test(day) &&
      !night.includes('uLightColor *') && windows.includes('uLightColor * (town') &&
      /outColor = vec4\(town \* [\d.]+, lavaGlow,[^;]*;[\s\S]{0,20}return;/.test(glow) &&
      !glow.includes('uLightColor') && !glow.includes('windowLight('),
      leaked.join(', '));
  }

  console.log('night lights checks:');
  for (const [name, ok, detail] of results) {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`);
    if (!ok && detail) console.log(`         ${detail}`);
  }
  if (!results.every(r => r[1])) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// --wind : wind lines (src/render/wind.js). The field must actually respond to
// the terrain (less climbing, more valley-following than the plain prevailing
// wind), be deterministic per seed, and the streaks must stay bounded,
// in-bounds, above the ground, stateless in time and allocation-free.
// ---------------------------------------------------------------------------
function runWindChecks() {
  const results = [];
  const push = (name, ok, detail) => results.push([name, ok, detail || '']);
  const Wd = SM.Wind;
  const angles = [];

  for (const seed of [1337, 4242, 90210]) {
    const g = run(seed, 128, 0.38).grid;
    const f = Wd.field(g, seed);
    const f2 = Wd.field(g, seed);
    const W = g.width, H = g.height, n = W * H;
    angles.push(Math.atan2(f.prevailing[1], f.prevailing[0]));
    let finite = true, unit = true;
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(f.u[i]) || !Number.isFinite(f.v[i])) finite = false;
      if (Math.abs(Math.hypot(f.u[i], f.v[i]) - 1) > 1e-4) unit = false;
    }
    push(`seed ${seed}: field finite, unit length, deterministic`,
      finite && unit && typedEqual(f.u, f2.u) && typedEqual(f.v, f2.v) && typedEqual(f.ground, f2.ground), '');

    // Terrain response on steep cells of the smoothed terrain.
    const [w0x, w0y] = f.prevailing;
    let steep = 0, climbW0 = 0, climbF = 0, alongW0 = 0, alongF = 0, aligned = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = (f.smooth[i + 1] - f.smooth[i - 1]) / 2, gy = (f.smooth[i + W] - f.smooth[i - W]) / 2;
      const gl = Math.hypot(gx, gy);
      if (gl < 0.25) continue;
      steep++;
      const nx = gx / gl, ny = gy / gl;
      climbW0 += Math.max(0, w0x * nx + w0y * ny);
      climbF += Math.max(0, f.u[i] * nx + f.v[i] * ny);
      const tx = -ny, ty = nx;
      if (Math.abs(tx * w0x + ty * w0y) > 0.5) {
        aligned++;
        alongW0 += Math.abs(tx * w0x + ty * w0y);
        alongF += Math.abs(tx * f.u[i] + ty * f.v[i]);
      }
    }
    push(`seed ${seed}: on ${steep} steep cells the flow climbs <= 60% of what the prevailing wind would ` +
      `(${(climbF / climbW0 * 100).toFixed(0)}%) and follows valley axes more closely ` +
      `(${(alongF / aligned).toFixed(2)} vs ${(alongW0 / aligned).toFixed(2)})`,
      steep > 50 && climbF <= 0.6 * climbW0 && alongF > alongW0, '');

    // Streaks.
    const b = Wd.makeStreakBuffers();
    const b2 = Wd.makeStreakBuffers();
    const P = Wd.POINTS;
    let inside = true, above = true, alphaOk = true;
    for (const t of [0, 3.7, 12.25, 600]) {
      Wd.streaksInto(f, t, 1000, b);
      for (let k = 0; k < b.count; k++) {
        if (!(b.alpha[k] >= 0 && b.alpha[k] <= 1)) alphaOk = false;
        for (let j = 0; j < P; j++) {
          const q = k * P + j, px = b.x[q], py = b.y[q];
          if (!(px >= 0 && py >= 0 && px <= W && py <= H)) { inside = false; continue; }
          const cell = Math.min(H - 1, Math.floor(py)) * W + Math.min(W - 1, Math.floor(px));
          if (b.ground[q] + Wd.LIFT < Math.max(0, g.level[cell]) + 0.9) above = false;
        }
      }
    }
    Wd.streaksInto(f, 7.5, 64, b);
    Wd.streaksInto(f, 99, 64, b2);
    Wd.streaksInto(f, 7.5, 64, b2);
    const buf = new Float32Array(Wd.MAX_STREAKS * P * 2 * Wd.FLOATS);
    const verts = Wd.ribbons(f, b, buf);
    push(`seed ${seed}: streaks bounded (${b.count} <= ${Wd.MAX_STREAKS}), inside the map, ` +
      `at least 0.9 levels above the ground, alpha 0..1, stateless in time`,
      b.count === Wd.MAX_STREAKS && inside && above && alphaOk &&
      typedEqual(b.x, b2.x) && typedEqual(b.y, b2.y) && typedEqual(b.alpha, b2.alpha) &&
      verts === b.count * P * 2 && Array.prototype.every.call(buf.subarray(0, verts * Wd.FLOATS), Number.isFinite),
      `inside ${inside}, above ${above}, alpha ${alphaOk}`);
  }
  const spread = Math.max(...angles) - Math.min(...angles);
  push('prevailing direction differs between seeds', spread > 0.3, angles.map(a => a.toFixed(2)).join(', '));

  // Owner 2026-10-05: no sudden turns, length follows speed, a notch more
  // frames. Measured on the drawn polylines over many frames.
  for (const seed of [1337, 4242]) {
    const g = run(seed, 192, 0.38).grid;
    const f = Wd.field(g, seed);
    const b = Wd.makeStreakBuffers();
    const P = Wd.POINTS;
    let worst = 0;
    const lens = [], spd = [];
    for (let fr = 0; fr < 30 * 40; fr++) {
      Wd.streaksInto(f, fr / 30, Wd.MAX_STREAKS, b);
      worst = Math.max(worst, Wd.maxTurnPerTile(b));
      if (fr % 15) continue;
      for (let k = 0; k < b.count; k++) {
        if (b.alpha[k] < 0.5) continue;
        let len = 0, sp = 0;
        for (let j = 1; j < P; j++) len += Math.hypot(b.x[k * P + j] - b.x[k * P + j - 1], b.y[k * P + j] - b.y[k * P + j - 1]);
        for (let j = 0; j < P; j++) sp += Wd.sample(f.speed, f, b.x[k * P + j], b.y[k * P + j]) / P;
        lens.push(len); spd.push(sp);
      }
    }
    const deg = r => (r * 180 / Math.PI).toFixed(1);
    push(`seed ${seed}: sharpest bend of any drawn streak over 40 s is ${deg(worst)} deg/tile <= ${deg(Wd.TURN_LIMIT)} (no kinks)`,
      worst > 0 && worst <= Wd.TURN_LIMIT, '');
    const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
    const ml = mean(lens), ms = mean(spd);
    let cov = 0, vl = 0, vs = 0;
    for (let i = 0; i < lens.length; i++) {
      cov += (lens[i] - ml) * (spd[i] - ms); vl += (lens[i] - ml) ** 2; vs += (spd[i] - ms) ** 2;
    }
    const corr = cov / Math.sqrt(vl * vs);
    const sorted = lens.slice().sort((a, c) => a - c);
    const p10 = sorted[Math.floor(sorted.length * 0.1)], p90 = sorted[Math.floor(sorted.length * 0.9)];
    push(`seed ${seed}: streak length follows the local speed (correlation ${corr.toFixed(3)} >= 0.95), ` +
      `long streaks ${(p90 / p10).toFixed(1)}x the short ones (P90 ${p90.toFixed(1)} / P10 ${p10.toFixed(1)} tiles, >= 2.5x)`,
      corr >= 0.95 && p90 / p10 >= 2.5, '');
    // Visible update rate: distinct head positions per second, sampled at 240 Hz.
    let changes = 0, prev = null;
    for (let i = 0; i < 240 * 10; i++) {
      Wd.streaksInto(f, 3 + i / 240, 1, b);
      const key = b.x[P - 1] + ',' + b.y[P - 1];
      if (prev !== null && key !== prev) changes++;
      prev = key;
    }
    push(`seed ${seed}: a streak moves on ${(changes / 10).toFixed(1)} times a second (UPDATE_HZ ${Wd.UPDATE_HZ}; was 4.8)`,
      Math.abs(changes / 10 - Wd.UPDATE_HZ) <= 0.5, '');
  }

  // The per-frame path (streaksInto, ribbons) must not allocate.
  const src = fs.readFileSync(path.join(root, 'render', 'wind.js'), 'utf8');
  const body = name => {
    const at = src.indexOf('function ' + name + '(');
    const next = src.indexOf('\n  function ', at + 10);
    return src.slice(at, next < 0 ? undefined : next);
  };
  const perFrame = body('streaksInto') + body('ribbons') + body('sample');
  push('per-frame path allocates nothing (no new / [] / {} / push in streaksInto, ribbons, sample)',
    !/\bnew\s|\[\s*\]|\.push\(|=\s*\{/.test(perFrame), '');

  console.log('wind lines checks:');
  for (const [name, ok, detail] of results) {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`);
    if (!ok && detail) console.log(`         ${detail}`);
  }
  if (!results.every(r => r[1])) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// --weather : rain and snow (src/render/weather.js). Snow only over cold
// biomes, nothing over desert/mesa/lava, rain elsewhere inside a zone;
// bounded count; zones and particles deterministic per seed.
// ---------------------------------------------------------------------------
/* --layout: side panel, phone layout, touch navigation (2026-10-05).
 * The app's layout is CSS and its gestures are DOM events, so most of this
 * reads the sources; what is pure math (pinch / two-finger pan) is run. The
 * browser itself is checked in headless Edge with device emulation and CDP
 * touch events (CURRENT.md). */
function cssRules(css, selRe) {
  // Every rule whose selector matches selRe -> { sel, body, media }. Rules
  // inside @media blocks are returned too, with the media text in `media`.
  const out = [];
  const strip = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const walk = (text, media) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const head = text.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (j < text.length && depth) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const body = text.slice(open + 1, j - 1);
      if (head.startsWith('@media')) walk(body, head);
      else if (selRe.test(head)) out.push({ sel: head, body, media: media || '' });
      i = j;
    }
  };
  walk(strip, '');
  return out;
}

function runLayoutChecks() {
  const results = [];
  const push = (name, ok, detail) => results.push([name, ok, detail || '']);
  const repo = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(repo, 'css', 'style.css'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const en = SM.I18N.STRINGS.en, tr = SM.I18N.STRINGS.tr;
  const COMPACT = '(max-width: 700px), (max-height: 500px)';

  // 1) Panel toggle: a real button, before the panel, wired to it.
  {
    const btn = html.match(/<button\b[^>]*\bid="panelToggle"[^>]*>/);
    const b = btn ? btn[0] : '';
    push('☰ is a <button type="button" id="panelToggle" aria-controls="panel" aria-expanded>, before <aside id="panel">',
      !!btn && /type="button"/.test(b) && /aria-controls="panel"/.test(b) && /aria-expanded=/.test(b) &&
      html.indexOf(b) < html.indexOf('<aside id="panel">'), b);
    push('setPanel writes aria-expanded and a TR/EN aria-label (panel.open / panel.close in both languages), again on a language switch',
      /setAttribute\('aria-expanded'/.test(main) && /T\(open \? 'panel\.close' : 'panel\.open'\)/.test(main) &&
      !!(en['panel.open'] && en['panel.close'] && tr['panel.open'] && tr['panel.close']) &&
      /syncPanelToggle\(\);\s*if \(perf\.on\) paintPerf\(\);/.test(main), '');
  }
  // 2) First state before paint: saved choice (try/catch), else collapsed on a phone.
  {
    const head = (html.match(/<head>[\s\S]*<\/head>/) || [''])[0];
    push('the <head> script reads sm-panel inside try/catch and starts collapsed on a compact screen with nothing saved',
      /try \{ p = localStorage\.getItem\('sm-panel'\); \} catch \(e\) \{\}/.test(head) &&
      head.includes("matchMedia('" + COMPACT + "')") &&
      /\(compact \? 'collapsed' : 'expanded'\)/.test(head), '');
    push('main.js saves the choice inside try/catch and uses the same compact media query',
      /try \{ localStorage\.setItem\('sm-panel'/.test(main) && main.includes("COMPACT_QUERY = '" + COMPACT + "'"), '');
  }
  // 3) Collapsed look: accent token, semi-transparent, full on hover/focus/touch.
  {
    const col = cssRules(css, /^:root\[data-panel="collapsed"\] #panelToggle$/);
    const act = cssRules(css, /:root\[data-panel="collapsed"\] #panelToggle:hover/);
    const op = col.length ? parseFloat((col[0].body.match(/opacity:\s*([\d.]+)/) || [])[1]) : NaN;
    push('collapsed ☰ is the accent button (var(--accent), no new colour), opacity 0.4-0.7, opacity 1 on hover/focus/active',
      col.length === 1 && /background:\s*var\(--accent\)/.test(col[0].body) && op >= 0.4 && op <= 0.7 &&
      act.length === 1 && /:focus-visible/.test(act[0].sel) && /:active/.test(act[0].sel) &&
      /opacity:\s*1\b/.test(act[0].body), 'opacity ' + op);
    const fab = cssRules(css, /^#panelToggle$/);
    push('☰ is position: fixed with a fixed px size and no CSS transform of its own (not part of the map)',
      fab.length >= 1 && fab.every(r => !/(^|[;\s])transform:/.test(r.body)) &&
      /position:\s*fixed/.test(fab[0].body) && /width:\s*\d+px/.test(fab[0].body) && /height:\s*\d+px/.test(fab[0].body), '');
    push('page pinch-zoom is undone for the ☰ (visualViewport offset and 1 / scale)',
      /visualViewport\.addEventListener\('resize', placePanelToggle\)/.test(main) && /scale\(' \+ \(1 \/ s\)/.test(main), '');
  }
  // 4) Collapsed panel leaves the tab order; short transition; reduced motion.
  {
    const hid = cssRules(css, /^:root\[data-panel="collapsed"\] #panel$/).filter(r => !r.media);
    const durs = hid.length ? (hid[0].body.match(/[\d.]+s\b/g) || []).map(parseFloat) : [];
    push('collapsed panel is visibility: hidden after a slide of at most 0.25 s',
      hid.length === 1 && /visibility:\s*hidden/.test(hid[0].body) && durs.length > 0 && Math.max(...durs) <= 0.25,
      durs.join(','));
    const rm = cssRules(css, /#panel\b/).filter(r => /prefers-reduced-motion: reduce/.test(r.media));
    push('prefers-reduced-motion turns the panel transition off', rm.some(r => /transition:\s*none/.test(r.body)), '');
  }
  // 5) The WebGL frame follows the stage size in the same frame.
  push('a ResizeObserver resizes AND draws the isometric frame (no blank / stretched frame while the panel slides)',
    /new ResizeObserver\(onStageResize\)\.observe\(stage\)/.test(main) &&
    /voxelRenderer\.resize\(w, h, window\.devicePixelRatio \|\| 1\);\s*voxelRenderer\.render\(\);/.test(main), '');

  // 6) Phone layout. Until 2026-10-05 there was none: the 312 px panel stayed
  //    docked and a 390 px phone kept 78 px for the map (48 px at 360).
  {
    const inCompact = sel => cssRules(css, sel).filter(r => r.media === '@media ' + COMPACT);
    const pan = inCompact(/^#panel$/);
    push('compact screens: the panel is a fixed drawer over the map, so the map keeps the full width (78 px of 390 before)',
      pan.length === 1 && /position:\s*fixed/.test(pan[0].body) && /left:\s*0/.test(pan[0].body) &&
      /width:\s*min\(/.test(pan[0].body), pan.length ? '' : 'no #panel rule inside @media ' + COMPACT);
    const meta = (html.match(/<meta name="viewport" content="([^"]+)"/) || [])[1] || '';
    push('viewport: device width, viewport-fit=cover (safe areas), page zoom NOT disabled (accessibility)',
      /width=device-width/.test(meta) && /viewport-fit=cover/.test(meta) &&
      !/user-scalable\s*=\s*(no|0)/.test(meta) && !/maximum-scale/.test(meta), meta);
    push('#app is as tall as the visible screen (100dvh, 100vh fallback first)',
      cssRules(css, /^#app$/).some(r => /height:\s*100vh;\s*height:\s*100dvh/.test(r.body)), '');
    // Every control on a compact screen is at least 44 px for a thumb.
    const need = [
      [/^#panelToggle$/, /width:\s*44px/, /height:\s*44px/],
      [/#panel button,/, /min-height:\s*44px/],
      [/#panel \.seg button/, /min-height:\s*44px/],
      [/#panel \.lang-switch button/, /min-width:\s*44px/, /min-height:\s*44px/],
      [/#panel #themeToggle,/, /width:\s*44px/, /height:\s*44px/],
      [/#panel input\[type=number\],/, /min-height:\s*44px/, /font-size:\s*16px/],
      [/#panel input\[type=range\],\s*#yawControl input\[type=range\]$/, /height:\s*44px/],
      [/#panel label\.check$/, /min-height:\s*44px/],
      [/details\.group > summary$/, /min-height:\s*(4[4-9]|[5-9]\d)px/],
      [/^#autoRotateBtn, #centerViewBtn$/, /width:\s*44px/, /height:\s*44px/]
    ];
    const miss = need.filter(([sel, ...props]) => {
      const rules = inCompact(sel);
      return !rules.some(r => props.every(re => re.test(r.body)));
    }).map(([sel]) => String(sel));
    push('compact screens: ☰, buttons, tabs, TR/EN, inputs, sliders, checkboxes, group headers and chip buttons are >= 44 px; inputs 16 px (no iOS focus zoom)',
      miss.length === 0, miss.join(' | '));
    const safe = ['#panelToggle', '#brand', '#tools', '#yawControl'].filter(id =>
      !inCompact(new RegExp('^' + id.replace(/[#]/g, '\\#') + '$')).some(r => /env\(safe-area-inset-/.test(r.body)));
    push('compact screens keep the ☰, header, footer and angle chip clear of notches / the home bar (safe-area insets)',
      safe.length === 0, safe.join(', '));
    push('the open drawer is a popup: a tap on the scrim or Esc closes it (compact only)',
      /id="panelScrim"/.test(html) &&
      /\$\('panelScrim'\)\.addEventListener\('click', function \(\) \{ setPanel\(false, true\); \}\)/.test(main) &&
      /ev\.key !== 'Escape' \|\| !isCompact\(\) \|\| !panelOpen\(\)/.test(main), '');
  }

  // 7) Touch navigation. Until 2026-10-05 the map had mouse handlers only:
  //    a one-finger drag did nothing and a pinch zoomed the whole page.
  {
    const html2 = html;
    push('the map owns its gestures: #stage touch-action: none (page pinch stays possible on the panel)',
      cssRules(css, /^#stage$/).some(r => /touch-action:\s*none/.test(r.body)) &&
      !cssRules(css, /^#panel$/).some(r => /touch-action/.test(r.body)), '');
    push('pointer events: touch pointers handled on the stage, compatibility mouse events cancelled, chip controls left alone',
      /stage\.addEventListener\('pointerdown', function \(ev\) \{\s*if \(ev\.pointerType !== 'touch'\) return;/.test(main) &&
      /ev\.target !== stage && ev\.target !== map && ev\.target !== glCanvas/.test(main) &&
      /ev\.preventDefault\(\); \/\/ no compatibility mouse events/.test(main) &&
      /stage\.addEventListener\('pointercancel'/.test(main) && /'gesturestart'/.test(main), '');
    push('a second finger re-bases the gesture and ends the one-finger drag; a lifted finger leaves the other panning',
      /if \(touch\.mode === 'one'\) endOneFinger\(\);\s*touch\.mode = 'two';\s*touch\.start = null;\s*touch\.frame = touchFrame\(\);/.test(main) &&
      /touch\.mode = touch\.order\.length === 1 \? 'rest' : null;/.test(main), '');
    push('src/touch.js loads before main.js; touch hints exist in both languages',
      /<script src="src\/touch\.js"><\/script>[\s\S]*<script src="src\/main\.js"><\/script>/.test(html2) &&
      !!(en['hint.top.touch'] && tr['hint.top.touch'] && en['hint.iso.touch'] && tr['hint.iso.touch']), '');

    // The math, run. Seeded so a failure is reproducible.
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const Tch = SM.Touch;
    // Top-down: content point under the fingers stays under them.
    let worstTop = 0, panTop = 0;
    for (let i = 0; i < 200; i++) {
      const cam = { scale: 0.1 + rnd() * 2, x: rnd() * 400 - 200, y: rnd() * 400 - 200 };
      const prev = { x: rnd() * 390, y: rnd() * 844, d: 40 + rnd() * 200 };
      const next = { x: rnd() * 390, y: rnd() * 844, d: 40 + rnd() * 200 };
      const c = Tch.pinchTop(cam, prev, next, 0.1, 6);
      const u = (prev.x - cam.x) / cam.scale, v = (prev.y - cam.y) / cam.scale;
      worstTop = Math.max(worstTop, Math.hypot(c.x + u * c.scale - next.x, c.y + v * c.scale - next.y));
      const p2 = Tch.pinchTop(cam, prev, { x: prev.x + 37, y: prev.y - 11, d: prev.d }, 0.1, 6);
      panTop = Math.max(panTop, Math.abs(p2.x - cam.x - 37) + Math.abs(p2.y - cam.y + 11) + Math.abs(p2.scale - cam.scale));
    }
    push('top-down pinch: the map point under the fingers stays under them (200 random gestures, clamped scale too); same spread = pure pan',
      worstTop < 1e-6 && panTop < 1e-9, `worst ${worstTop.toExponential(2)} px, pan error ${panTop}`);
    // Isometric: project with an orthographic camera built independently of
    // panVector (lookAt basis of renderScene: eye on the yaw/pitch sphere,
    // world up), so a sign error in either shows up here.
    const project = (cam, P, w, h) => {
      const y = cam.yaw * Math.PI / 180, p = cam.pitch * Math.PI / 180;
      const right = [Math.sin(y), 0, -Math.cos(y)];
      const up = [-Math.cos(y) * Math.sin(p), Math.cos(p), -Math.sin(y) * Math.sin(p)];
      const d = [P.x - cam.tx, cam.ty - cam.ty, P.z - cam.tz];
      const wpp = 2 * cam.zoom / w;
      return { x: w / 2 + (d[0] * right[0] + d[1] * right[1] + d[2] * right[2]) / wpp,
               y: h / 2 - (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / wpp };
    };
    let worstIso = 0, worstBack = 0, keptAngles = true, ratioErr = 0;
    for (let i = 0; i < 200; i++) {
      const w = 300 + rnd() * 1100, h = 300 + rnd() * 600;
      const cam = { yaw: rnd() * 360, pitch: 10 + rnd() * 79, zoom: 5 + rnd() * 400, tx: rnd() * 200 - 100, ty: rnd() * 30, tz: rnd() * 200 - 100 };
      const prev = { x: rnd() * w, y: rnd() * h, d: 40 + rnd() * 200 };
      const next = { x: rnd() * w, y: rnd() * h, d: 40 + rnd() * 200 };
      const P = Tch.voxelGroundAt(cam, prev.x, prev.y, w, h);
      const back = project(cam, P, w, h);
      worstBack = Math.max(worstBack, Math.hypot(back.x - prev.x, back.y - prev.y));
      const c = Tch.pinchVoxel(cam, prev, next, w, h, 1, 1000);
      const q = project(c, P, w, h);
      worstIso = Math.max(worstIso, Math.hypot(q.x - next.x, q.y - next.y));
      if (c.yaw !== cam.yaw || c.pitch !== cam.pitch || c.ty !== cam.ty) keptAngles = false;
      const want = Math.min(1000, Math.max(1, cam.zoom * prev.d / next.d));
      ratioErr = Math.max(ratioErr, Math.abs(c.zoom - want));
    }
    push('isometric pinch: the ground point under the fingers stays under them in an independent ortho projection (200 random cameras); yaw/pitch untouched; zoom = old × spread ratio',
      worstBack < 1e-6 && worstIso < 1e-6 && keptAngles && ratioErr < 1e-9,
      `ground-at round trip ${worstBack.toExponential(2)} px, after pinch ${worstIso.toExponential(2)} px, angles kept ${keptAngles}, zoom err ${ratioErr}`);
  }

  console.log('layout checks (panel, phone, touch):');
  for (const [name, ok, detail] of results) {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`);
    if (!ok && detail) console.log(`         ${detail}`);
  }
  if (!results.every(r => r[1])) process.exitCode = 1;
}

function runWeatherChecks() {
  const results = [];
  const push = (name, ok, detail) => results.push([name, ok, detail || '']);
  const Wx = SM.Weather;
  const idx = list => list.map(id => SM.BIOME_LIST.findIndex(b => b.id === id));
  const cold = idx(Wx.COLD), dry = idx(Wx.DRY);
  const wet = idx(['forest', 'jungle', 'marsh']);
  const sigs = [];
  const kinds = new Set();
  let snowDrops = 0, rainDrops = 0;

  for (const seed of [1337, 4242, 90210, 7, 2024]) {
    const g = run(seed, 128, 0.38).grid;
    const a = Wx.build(g, seed);
    const b = Wx.build(g, seed);
    const W = g.width, H = g.height;
    sigs.push(a.zones.map(z => `${z.x},${z.y}`).join(';'));
    // Ground texture: level and kind per tile follow the biome rule.
    let texBad = 0;
    for (let i = 0; i < W * H; i++) {
      const want = dry.includes(g.biome[i]) ? Wx.KIND.none : cold.includes(g.biome[i]) ? Wx.KIND.snow : Wx.KIND.rain;
      if (a.ground[i * 2 + 1] !== want || a.ground[i * 2] !== Math.max(0, Math.min(255, g.level[i]))) texBad++;
    }
    push(`seed ${seed}: ${a.zones.length} zones, one cloud each; ground texture: snow only over cold biomes, nothing over desert/mesa/lava, rain elsewhere; deterministic`,
      a.zones.length >= 1 && a.zones.length <= 3 && a.clouds.length === a.zones.length && texBad === 0 &&
      typedEqual(a.data, b.data) && JSON.stringify(a.clouds) === JSON.stringify(b.clouds) &&
      Array.prototype.every.call(a.data, Number.isFinite), `texture mismatches ${texBad}`);
    // Every particle belongs to a cloud and falls inside its footprint.
    let outside = 0;
    for (let p = 0; p < a.count; p++) {
      const cl = a.clouds[a.cloudOf[p]];
      if (!cl || !Wx.insideLobes(cl.lobes, a.local[p * 2], a.local[p * 2 + 1], 1)) outside++;
    }
    push(`seed ${seed}: ${a.count} particles <= ${Wx.MAX_PARTICLES}, every one inside its cloud's lobes (${outside} outside)`,
      a.count > 0 && a.count <= Wx.MAX_PARTICLES && outside === 0 && a.data.length === a.count * 4 * 6, '');
    // Clouds: semi-transparent, greyer than snow-white from the palette,
    // rain heavier than snow; underside above all ground it can sway over.
    const snowC = SM.BIOME_LIST.find(x => x.id === 'snow').color;
    const white = [1, 3, 5].map(k => parseInt(snowC.slice(k, k + 2), 16) / 255);
    const bad = [];
    for (const cl of a.clouds) {
      kinds.add(cl.kind);
      if (!(cl.alpha >= 0.45 && cl.alpha <= 0.6)) bad.push('alpha ' + cl.alpha);
      const sum = cl.color.reduce((x, y) => x + y, 0);
      if (!(sum < white.reduce((x, y) => x + y, 0))) bad.push('not greyer');
      let hi = 0;
      const reach = cl.radius + cl.sway.amp;
      for (let y = Math.floor(cl.y - reach); y <= cl.y + reach; y++) {
        for (let x = Math.floor(cl.x - reach); x <= cl.x + reach; x++) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          hi = Math.max(hi, g.level[y * W + x]);
        }
      }
      if (cl.bottom < hi + 2) bad.push(`underside ${cl.bottom} vs ground ${hi}`);
      if (!(cl.column > 0 && cl.column <= cl.bottom)) bad.push('column');
      if (!(cl.sway.amp <= 0.3 * cl.r && cl.sway.period >= 60)) bad.push('sway');
    }
    const rainC = Wx.cloudColor('rain'), snowCl = Wx.cloudColor('snow');
    push(`seed ${seed}: clouds semi-transparent (alpha 0.45-0.6), greyer than snow-white, underside above the highest ground under them; snow clouds lighter than rain clouds`,
      bad.length === 0 && snowCl.reduce((x, y) => x + y) > rainC.reduce((x, y) => x + y), bad.join(', '));
    // Sway: bounded, slow, only along x; the particles' cloud centre is the
    // cloud's own (cloudsAt is the single source).
    const c0 = new Float32Array(6), c1 = new Float32Array(6);
    let worstDx = 0, worstSpeed = 0, yMoves = false;
    for (let t = 0; t < 400; t += 0.5) {
      Wx.cloudsAt(a, t, c0);
      Wx.cloudsAt(a, t + 0.5, c1);
      a.clouds.forEach((cl, n) => {
        worstDx = Math.max(worstDx, Math.abs(c0[n * 2] - cl.x) / cl.r);
        worstSpeed = Math.max(worstSpeed, Math.abs(c1[n * 2] - c0[n * 2]) / 0.5);
        if (c0[n * 2 + 1] !== cl.y) yMoves = true;
      });
    }
    push(`seed ${seed}: clouds sway at most ${(worstDx * 100).toFixed(0)}% of their radius, at most ${worstSpeed.toFixed(2)} tiles/s, along x only`,
      worstDx <= Wx.SWAY + 1e-6 && worstSpeed < 1 && !yMoves, '');
    // What falls where, at a few times: a drop over a cold tile is snow, over
    // a dry tile nothing (the shader reads the same texture).
    for (const t of [0, 37, 211]) {
      Wx.cloudsAt(a, t, c0);
      for (let p = 0; p < a.count; p++) {
        const n = a.cloudOf[p];
        const x = Math.floor(c0[n * 2] + a.local[p * 2]), y = Math.floor(c0[n * 2 + 1] + a.local[p * 2 + 1]);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const k = a.ground[(y * W + x) * 2 + 1];
        if (k === Wx.KIND.snow) snowDrops++;
        if (k === Wx.KIND.rain) rainDrops++;
      }
    }
    const centresOk = a.zones.every(z => {
      const i = Math.floor(z.y) * g.width + Math.floor(z.x);
      return !g.water[i] && (wet.includes(g.biome[i]) || cold.includes(g.biome[i]));
    });
    push(`seed ${seed}: every zone is centred on wet or cold land`, centresOk, '');
  }
  push('zones differ between seeds; across the seeds both rain and snow fall, from rain and snow clouds',
    new Set(sigs).size === sigs.length && snowDrops > 0 && rainDrops > 0 && kinds.has('rain'),
    `rain ${rainDrops}, snow ${snowDrops}, cloud kinds ${[...kinds].join('/')}`);
  {
    const g = run(1337, 128, 0.38).grid;
    push('the cap holds when asked for fewer', Wx.build(g, 1337, 50).count <= 50, '');
  }
  {
    // Wiring: rain starts at the cloud underside; the cloud, its shadow and
    // its rain all come from one cloudsAt call; Rain & snow off hides the
    // clouds, their shadow and the particles.
    const wsrc = fs.readFileSync(path.join(root, 'render', 'weather.js'), 'utf8');
    const vsrc = fs.readFileSync(path.join(root, 'render', 'voxel3d.js'), 'utf8');
    push('drops start at the cloud underside (level = underside - fallen, fallen from 0) and fade where they reach the ground',
      /float fallen = cl\.w \* cyc;/.test(wsrc) && /float level = cl\.z - fallen;/.test(wsrc) &&
      /smoothstep\(g\.x, g\.x \+ 0\.7, level\)/.test(wsrc) && /cloudData\[n \* 4 \+ 2\] = built\.clouds\[n\]\.bottom;/.test(wsrc), '');
    push('one cloudsAt per frame feeds the weather cloud and its rain; weather clouds cast no shadow (cost); Rain & snow off removes both',
      (vsrc.match(/SM\.Weather\.cloudsAt\(/g) || []).length === 1 &&
      /var list = weatherBuilt && showWeather && sky && sky\.weatherCount \? weatherBuilt\.clouds : \[\];/.test(vsrc) &&
      (vsrc.match(/SM\.Sky\.cloudShadowUniforms\(/g) || []).length === 1 &&
      /SM\.Sky\.cloudShadowUniforms\(cloudNow, meshBounds/.test(vsrc) &&
      /if \(weather && showWeather && !debugView && weatherNow\.length\) \{/.test(vsrc) &&
      /if \(weatherNow\.length && sky\.weatherCount\) drawWeatherClouds\(\);/.test(vsrc) &&
      /weatherDraw\.centres = weatherCentres;/.test(vsrc), '');
  }

  console.log('rain and snow checks:');
  for (const [name, ok, detail] of results) {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`);
    if (!ok && detail) console.log(`         ${detail}`);
  }
  if (!results.every(r => r[1])) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// --huts : the fixed voxel hut (src/huts.js). Count range, every hut on a
// valid footprint, spacing, determinism, the model itself, the mesh shell.
// ---------------------------------------------------------------------------
function runHutChecks() {
  const results = [];
  const push = (name, ok, detail) => results.push([name, ok, detail || '']);
  const Hu = SM.Huts;
  const habit = new Set(Hu.HABITABLE.map(id => SM.BIOME_IDX[id]));
  const sigs = [];

  for (const [seed, size] of [[1337, 192], [4242, 192], [90210, 192], [7, 256], [2024, 128], [1337, 320]]) {
    const g = run(seed, size, 0.38).grid;
    const g2 = SM.generate({ seed, width: size, height: size, seaLevel: 0.38 });
    const huts = g.huts;
    const W = g.width;
    let land = 0;
    for (let i = 0; i < g.water.length; i++) if (!g.water[i]) land++;
    const want = Math.max(Hu.MIN_HUTS, Math.min(Hu.MAX_HUTS, Math.round(land / Hu.LAND_PER_HUT)));
    sigs.push(JSON.stringify(huts));
    push(`seed ${seed} ${size}²: ${huts.length} huts for ${land} land tiles (want ${want}, ${Hu.MIN_HUTS}..${Hu.MAX_HUTS}); same seed -> same huts`,
      huts.length === want && JSON.stringify(huts) === JSON.stringify(g2.huts), '');
    const bad = [];
    let nearWater = 0;
    for (const h of huts) {
      const why = [];
      if (![0, 1, 2, 3].includes(h.rot)) why.push('rot');
      if (Hu.fits(g, h.x, h.y, null) !== h.base) why.push('footprint');
      const fl = [];
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) fl.push(g.level[(h.y + dy) * W + h.x + dx]);
      if (Math.max(...fl) - Math.min(...fl) > 1 || Math.max(...fl) !== h.base) why.push('uneven');
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
        const i = (h.y + dy) * W + h.x + dx;
        if (g.water[i] || g.lava[i] || !habit.has(g.biome[i])) why.push('cell ' + SM.BIOME_LIST[g.biome[i]].id);
      }
      for (let dy = -1; dy <= 3; dy++) for (let dx = -1; dx <= 3; dx++) {
        if (Math.abs(g.level[(h.y + dy) * W + h.x + dx] - h.base) > 2) why.push('cliff');
      }
      for (const o of huts) {
        if (o !== h && Math.hypot(o.x - h.x, o.y - h.y) < Hu.MIN_SPACING) why.push('spacing');
      }
      let water = false;
      for (let dy = -Hu.NEAR_WATER; dy <= Hu.NEAR_WATER + 2 && !water; dy++) {
        for (let dx = -Hu.NEAR_WATER; dx <= Hu.NEAR_WATER + 2; dx++) {
          const x = h.x + dx, y = h.y + dy;
          if (x >= 0 && y >= 0 && x < W && y < g.height && g.water[y * W + x]) { water = true; break; }
        }
      }
      if (water) nearWater++;
      // The model on this ground: nothing inside the terrain, posts reach it.
      const vox = Hu.voxels(g, h);
      for (const v of vox) if (v.level < g.level[v.y * W + v.x]) why.push('buried');
      if (vox.filter(v => v.m === 'G').length !== 2 || vox.filter(v => v.m === 'D').length !== 1) why.push('model');
      if (why.length) bad.push(`${h.x},${h.y}: ${[...new Set(why)].join(' ')}`);
    }
    push(`seed ${seed} ${size}²: every hut on dry habitable land, footprint within one level, no cliff edge, ` +
      `>= ${Hu.MIN_SPACING} tiles apart, nothing buried; ${nearWater}/${huts.length} within ${Hu.NEAR_WATER} tiles of water`,
      bad.length === 0 && nearWater * 2 >= huts.length, bad.slice(0, 3).join(' | '));
  }
  push('huts differ between seeds', new Set(sigs).size === sigs.length, '');

  {
    // The model: 4 posts, 9 floor, walls with a door in front and a window
    // on each side, a 9-voxel roof and a plus-shaped peak; rotation keeps it.
    const g = run(1337, 192, 0.38).grid;
    const h = g.huts[0];
    const count = m => Hu.MODEL.join('').split('').filter(c => c === m).length;
    const shapes = [0, 1, 2, 3].map(rot => {
      const v = Hu.voxels(g, Object.assign({}, h, { rot }));
      return v.filter(q => q.level >= h.base).length;
    });
    const doorRow = Hu.MODEL[2][0].indexOf('D') === 1 && Hu.MODEL[2][1] === 'GWG';
    push('model: 4 posts, 9 floor, door front-centre, a window on each side wall, 9 roof + 5 peak; all four rotations keep 36 voxels',
      count('P') === 4 && count('F') === 9 && count('D') === 1 && count('G') === 2 && count('R') === 14 &&
      doorRow && shapes.every(n => n === 36), shapes.join(','));
    // Mesh shell: huts add faces, all inside their footprint, none on the
    // terrain without huts.
    const mesh = SM.buildVoxelMesh(g);
    const bare = SM.buildVoxelMesh(Object.assign({}, g, { huts: [] }));
    const extra = mesh.triangleCount - bare.triangleCount;
    push(`mesh: the ${g.huts.length} huts add ${extra} triangles (a closed shell, <= 12 per voxel), terrain untouched`,
      extra > 0 && extra % 2 === 0 && extra <= g.huts.length * 40 * 12 && bare.triangleCount === 124228, '');
    // Top-down: the roof covers exactly the footprint.
    let cover = 0, outside = 0;
    for (let y = h.y - 2; y < h.y + 5; y++) for (let x = h.x - 2; x < h.x + 5; x++) {
      const inside = x >= h.x && y >= h.y && x < h.x + 3 && y < h.y + 3;
      const hit = Hu.at(g, x, y) === h;
      if (inside && hit) cover++;
      if (!inside && hit) outside++;
    }
    // A brush edit that breaks the footprint removes the hut (never floats).
    const edited = Object.assign({}, g, { level: g.level.slice() });
    edited.level[(h.y + 1) * g.width + h.x + 1] = h.base - 3;
    push('top-down roof covers exactly the 3x3 footprint; a hut whose ground is edited away is not drawn',
      cover === 9 && outside === 0 && Hu.voxels(edited, h).length === 0 && Hu.at(edited, h.x + 1, h.y + 1) === null, '');
  }

  console.log('hut checks:');
  for (const [name, ok, detail] of results) {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`);
    if (!ok && detail) console.log(`         ${detail}`);
  }
  if (!results.every(r => r[1])) process.exitCode = 1;
}

if (process.argv[2] === '--huts') {
  runHutChecks();
} else if (process.argv[2] === '--layout') {
  runLayoutChecks();
} else if (process.argv[2] === '--weather') {
  runWeatherChecks();
} else if (process.argv[2] === '--wind') {
  runWindChecks();
} else if (process.argv[2] === '--perf') {
  runPerfChecks();
} else if (process.argv[2] === '--night') {
  runNightChecks();
} else if (process.argv[2] === '--worldtypes') {
  runWorldTypesChecks();
} else if (process.argv[2] === '--i18n') {
  runI18nChecks();
} else if (process.argv[2] === '--shaders') {
  runShaderChecks();
} else if (process.argv[2] === '--sky') {
  runSkyChecks();
} else if (process.argv[2] === '--river') {
  runRiverChecks();
} else if (process.argv[2] === '--edit') {
  runEditChecks();
} else if (process.argv[2] === '--export') {
  runExportChecks();
} else if (process.argv[2] === '--mesh') {
  runMeshChecks();
} else if (process.argv[2] === '--falls') {
  runFallsChecks();
} else if (process.argv[2] === '--sweep') {
  runSweepChecks();
} else if (process.argv[2] === '--geo') {
  runGeoProperties();
} else if (process.argv[2] === '--manifest') {
  // Stable measurement manifest for the portfolio: three fixed seeds at the
  // small (192²) and large (448²) sizes. The numeric half of the "honest
  // visual + measurement package" (P3.5); the PNG / orbit clip is produced in
  // the browser (see docs/measurements/README.md).
  const SEEDS = [1337, 4242, 90210];
  const out = { generatedBy: 'tools/headless.js --manifest', seaLevel: 0.38, maps: [] };
  for (const seed of SEEDS) {
    for (const size of [192, 448]) {
      const r = run(seed, size, 0.38);
      out.maps.push({
        seed, size, seaLevel: 0.38,
        landPct: r.landPct, waterPct: r.waterPct,
        islands: r.islands, islandTop5: r.islandTop5,
        towers: r.towers,
        settlements: r.settlements,
        genMs: r.dt,
        biomes: r.biomes
      });
    }
  }
  console.log(JSON.stringify(out, null, 2));
} else {
  const seed = +(process.argv[2] || 1337);
  const size = +(process.argv[3] || 192);
  const sea = +(process.argv[4] || 0.38);
  const r = run(seed, size, sea);
  delete r.grid;
  console.log(JSON.stringify(r, null, 2));
}
