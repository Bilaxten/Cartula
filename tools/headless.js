/* Headless harness — loads the browser SM modules under a fake `window` so the
 * generation pipeline can be exercised from node (Codex has no browser/canvas).
 *
 *   node tools/headless.js [seed] [size] [seaLevel]
 *   node tools/headless.js --sweep      # sea-level sweep, island-count check
 *   node tools/headless.js --mesh       # voxel mesh integrity and determinism
 *   node tools/headless.js --river      # river brush channel planning (M3)
 *   node tools/headless.js --sky        # cloud drift, cloud shadow, flock (M4)
 *   node tools/headless.js --shaders    # GLSL cross-stage declaration lint
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

if (process.argv[2] === '--shaders') {
  runShaderChecks();
} else if (process.argv[2] === '--sky') {
  runSkyChecks();
} else if (process.argv[2] === '--river') {
  runRiverChecks();
} else if (process.argv[2] === '--mesh') {
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
