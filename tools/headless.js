/* Headless harness — loads the browser SM modules under a fake `window` so the
 * generation pipeline can be exercised from node (Codex has no browser/canvas).
 *
 *   node tools/headless.js [seed] [size] [seaLevel]
 *   node tools/headless.js --sweep      # sea-level sweep, island-count check
 *   node tools/headless.js --mesh       # voxel mesh integrity and determinism
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'src');
const win = {};
global.window = win;
global.performance = { now: () => Number(process.hrtime.bigint()) / 1e6 };

for (const f of ['noise.js', 'grid.js', 'biome.js', 'generate.js',
                 'render/topdown.js', 'render/iso.js', 'render/voxel3d.js',
                 'time.js']) {
  const code = fs.readFileSync(path.join(root, f), 'utf8');
  // strip canvas-only renderers of their getContext calls is unnecessary — we
  // just never call renderIso/renderTopDown here.
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
  return [
    ['shadow map type, length, and range', typeAndLength && range],
    ['shadow determinism', deterministic],
    ['flat grid has no cast shadow', flatClear],
    ['high column casts a shadow', castShadow]
  ];
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
    mesh.emissive
  ];
  const finite = attributes.every(arr => Array.prototype.every.call(arr, Number.isFinite));
  const indices = Array.prototype.every.call(mesh.indices, i => i < mesh.vertexCount);
  const flat = flatMeshCheck();
  const deterministic = typedEqual(mesh.positions, meshB.positions) &&
    typedEqual(mesh.colors, meshB.colors) &&
    typedEqual(mesh.cellUV, meshB.cellUV) &&
    typedEqual(mesh.emissive, meshB.emissive);
  const cellUV = mesh.cellUV.length === mesh.vertexCount * 2 &&
    Array.prototype.every.call(mesh.cellUV, uv => uv >= 0 && uv <= 1);
  const triangleCount = mesh.triangleCount === 124034;
  const cameraHelpers = SM.VoxelCamera.wrapYaw(-30) === 330 &&
    SM.VoxelCamera.wrapYaw(400) === 40 &&
    SM.VoxelCamera.clampPitch(5) === 10 &&
    SM.VoxelCamera.clampPitch(95) === 89 &&
    SM.VoxelCamera.snapYaw(47) === 90 &&
    SM.VoxelCamera.snapYaw(44) === 0 &&
    SM.VoxelCamera.snapYaw(316) === 270;
  const clockWrap = SM.formatClock(6) === '06:00' &&
    SM.formatClock(26) === '02:00' &&
    SM.formatClock(29.5) === '05:30';
  const shadowChecks = runShadowChecks();
  const quads = mesh.triangleCount / 2;
  const perCell = quads / (a.width * a.height);
  const results = [
    ['finite attributes', finite],
    ['index range', indices],
    ['flat-grid face culling', flat],
    ['determinism (mesh attributes)', deterministic],
    ['cell UV range and length', cellUV],
    ['camera yaw, pitch, and snap helpers', cameraHelpers],
    ['clock display wraps after midnight', clockWrap],
    ['triangle count (Faz 1 baseline)', triangleCount]
  ].concat(shadowChecks);
  console.log('voxel mesh checks (seed 1337, 192²):');
  for (const [name, ok] of results) console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`);
  console.log(`  mesh: ${mesh.vertexCount} vertices, ${mesh.triangleCount} triangles, ${buildMs.toFixed(1)} ms`);
  console.log(`  density: ${quads} quads, ${perCell.toFixed(3)} quads/cell`);
  console.log(`  shadow map: ${shadow.byteLength} bytes, ${shadowMs.toFixed(1)} ms`);
  if (!results.every(r => r[1])) process.exitCode = 1;
}

if (process.argv[2] === '--mesh') {
  runMeshChecks();
} else if (process.argv[2] === '--sweep') {
  console.log('sea-level sweep (seed 1337, 192²) — island count should fall, not fragment:');
  for (const sea of [0.15, 0.25, 0.35, 0.45, 0.55, 0.62, 0.70]) {
    const r = run(1337, 192, sea);
    console.log(`  sea=${sea.toFixed(2)}  land=${String(r.landPct).padStart(2)}% ` +
      `water=${String(r.waterPct).padStart(2)}%  ` +
      `islands=${String(r.islands).padStart(3)}  top5=[${r.islandTop5.join(', ')}]  ` +
      `towns=${r.settlements} roads=${r.roadTiles}/${r.bridges}bridge ` +
      `labels=${r.labels} falls=${r.waterfallDrops}/${r.waterfallTiles}tiles ` +
      `spread=${r.fluidSpread.water}/${r.fluidSpread.lava} ` +
      `towers=${r.towers}  ${r.dt}ms`);
  }
  // determinism
  function signature(g) {
    return JSON.stringify({
      level: [...g.level], settlements: g.settlements, roads: [...g.roads],
      labels: g.labels, waterfalls: [...g.waterfalls]
    });
  }
  const a = signature(run(7, 160, 0.4).grid);
  const b = signature(run(7, 160, 0.4).grid);
  console.log('determinism (same seed → identical levels/features):', a === b ? 'OK' : 'FAIL');
} else {
  const seed = +(process.argv[2] || 1337);
  const size = +(process.argv[3] || 192);
  const sea = +(process.argv[4] || 0.38);
  const r = run(seed, size, sea);
  delete r.grid;
  console.log(JSON.stringify(r, null, 2));
}
