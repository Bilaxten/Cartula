/* Headless harness — loads the browser SM modules under a fake `window` so the
 * generation pipeline can be exercised from node (Codex has no browser/canvas).
 *
 *   node tools/headless.js [seed] [size] [seaLevel]
 *   node tools/headless.js --sweep      # sea-level sweep, island-count check
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'src');
const win = {};
global.window = win;
global.performance = { now: () => Number(process.hrtime.bigint()) / 1e6 };

for (const f of ['noise.js', 'grid.js', 'biome.js', 'generate.js',
                 'render/topdown.js', 'render/iso.js']) {
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
  let water = 0;
  for (let i = 0; i < grid.water.length; i++) if (grid.water[i]) water++;
  return {
    seed, size, sea, dt: +dt.toFixed(1),
    landPct: s.landPct, waterPct: Math.round(water / grid.biome.length * 100),
    islands: isl.length, islandTop5: isl.slice(0, 5),
    towers: towers(grid),
    biomes: hist, grid
  };
}

if (process.argv[2] === '--sweep') {
  console.log('sea-level sweep (seed 1337, 192²) — island count should fall, not fragment:');
  for (const sea of [0.15, 0.25, 0.35, 0.45, 0.55, 0.62, 0.70]) {
    const r = run(1337, 192, sea);
    console.log(`  sea=${sea.toFixed(2)}  land=${String(r.landPct).padStart(2)}%  ` +
      `islands=${String(r.islands).padStart(3)}  top5=[${r.islandTop5.join(', ')}]  ` +
      `towers=${r.towers}  ${r.dt}ms`);
  }
  // determinism
  const a = JSON.stringify([...run(7, 160, 0.4).grid.level]);
  const b = JSON.stringify([...run(7, 160, 0.4).grid.level]);
  console.log('determinism (same seed → identical levels):', a === b ? 'OK' : 'FAIL');
} else {
  const seed = +(process.argv[2] || 1337);
  const size = +(process.argv[3] || 192);
  const sea = +(process.argv[4] || 0.38);
  const r = run(seed, size, sea);
  delete r.grid;
  console.log(JSON.stringify(r, null, 2));
}
