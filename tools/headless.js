/* Headless harness — loads the browser SM modules under a fake `window` so the
 * generation pipeline can be exercised from node (Codex has no browser/canvas).
 *
 *   node tools/headless.js [seed] [size] [seaLevel]
 *   node tools/headless.js --sweep      # sea-level sweep, island-count check
 *   node tools/headless.js --mesh       # voxel mesh integrity and determinism
 *   node tools/headless.js --river      # river brush channel planning (M3)
 *   node tools/headless.js --edit       # brush re-derivation: fresh water, levels
 *   node tools/headless.js --sky        # cloud drift, cloud shadow, flock (M4)
 *   node tools/headless.js --shaders    # GLSL cross-stage declaration lint
 *   node tools/headless.js --falls      # voxel waterfall face tagging/rendering
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'src');
const win = {};
global.window = win;
global.performance = { now: () => Number(process.hrtime.bigint()) / 1e6 };

for (const f of ['noise.js', 'grid.js', 'biome.js', 'generate.js',
                 'render/topdown.js', 'render/sky.js',
                 'render/voxel3d.js', 'time.js']) {
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
  return [
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
  const waterOnTopFaces = Array.prototype.every.call(mesh.water, (value, i) => {
    if (!value) return true;
    const uv = i * 2;
    const x = Math.floor(mesh.cellUV[uv] * a.width);
    const y = Math.floor(mesh.cellUV[uv + 1] * a.height);
    const cell = y * a.width + x;
    return mesh.normals[i * 3 + 1] === 1 && !!a.water[cell];
  });
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
  const triangleCount = mesh.triangleCount === 123314;
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
    ['water flag length and binary range', waterFlags],
    ['water flags occur only on water top faces', waterOnTopFaces],
    ['shore length and range', shoreRange],
    ['shore determinism', shoreDeterministic],
    ['AO type, length, integer range', aoRange],
    ['AO determinism', aoDeterministic],
    ['flat grid AO is fully open', flatAO],
    ['raised column darkens facing neighbour corners', aoResponse],
    ['AO quad-flip helper', quadFlip],
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
      stats.count > 0 && stats.minY === 2 && stats.maxY === 6,
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
  const noon = SM.Sky.driftClouds(instances, 3, bounds, 1.6);
  const overhead = SM.Sky.cloudShadowUniforms(noon, bounds, [0, 1, 0]);
  let underCloud = true;
  for (let i = 0; i < noon.length; i++) {
    const u = (noon[i].x - bounds.minX) / spanX;
    const v = (noon[i].z - bounds.minZ) / (bounds.maxZ - bounds.minZ);
    if (Math.abs(overhead[i * 3] - u) > 1e-5) underCloud = false;
    if (Math.abs(overhead[i * 3 + 1] - v) > 1e-5) underCloud = false;
  }
  results.push(['overhead sun puts the shadow directly under the cloud', underCloud]);

  const low = SM.Sky.cloudShadowUniforms(noon, bounds, [0.9, 0.28, 0.0]);
  results.push(['a low sun slides the shadow away from the cloud',
    Math.abs(low[0] - overhead[0]) > 0.01]);

  // A sun at the horizon must not send the shadow to infinity.
  const horizon = SM.Sky.cloudShadowUniforms(noon, bounds, [1, 0, 0]);
  results.push(['horizon sun stays finite',
    Array.from(horizon).every(v => Number.isFinite(v))]);
  results.push(['shadow array is padded to MAX_CLOUDS',
    horizon.length === SM.Sky.MAX_CLOUDS * 3]);

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
  const shadowTarget = new Float32Array(SM.Sky.MAX_CLOUDS * 3);
  results.push(['cloudShadowUniforms writes into the caller buffer',
    SM.Sky.cloudShadowUniforms(first, bounds, [0, 1, 0], shadowTarget) === shadowTarget]);
  // A shorter cloud list must not leave a previous cloud's shadow behind.
  SM.Sky.cloudShadowUniforms(first, bounds, [0, 1, 0], shadowTarget);
  SM.Sky.cloudShadowUniforms(first.slice(0, 1), bounds, [0, 1, 0], shadowTarget);
  results.push(['reused shadow buffer is cleared, not left stale',
    shadowTarget.slice(3).every(v => v === 0)]);

  results.push(['sky meshes are deterministic',
    JSON.stringify([...cloudMesh.positions]) ===
      JSON.stringify([...SM.Sky.buildCloudMesh(instances).positions])]);

  console.log('sky checks (96 unit span, 5 clouds, 16 birds):');
  for (const [name, ok] of results) console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`);
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
  const file = fs.readFileSync(path.join(root, 'render', 'voxel3d.js'), 'utf8');
  const results = [];
  // Each program is a `makeX(gl)` function holding a vertexSource and a
  // fragmentSource array of quoted GLSL lines.
  const programs = file.split(/function make(\w*[Pp]rogram)\(gl\)/).slice(1);
  const pairs = [];
  for (let i = 0; i < programs.length; i += 2) {
    pairs.push([programs[i], programs[i + 1] || '']);
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

  results.push(['at least two programs were inspected', pairs.length >= 2, []]);

  console.log('shader declaration lint (src/render/voxel3d.js):');
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

if (process.argv[2] === '--shaders') {
  runShaderChecks();
} else if (process.argv[2] === '--sky') {
  runSkyChecks();
} else if (process.argv[2] === '--river') {
  runRiverChecks();
} else if (process.argv[2] === '--edit') {
  runEditChecks();
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
