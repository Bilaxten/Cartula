/* Engine export (portfolio roadmap #4): the map as files a game engine can
 * import -- Unity first. Pure data here (no DOM), so it runs under Node
 * (`node tools/headless.js --export`); main.js adds the two PNGs (which need a
 * canvas) and triggers the download.
 *
 * Bundle (one .zip, see README_TEXT below for the import steps):
 *   heightmap.r16  16-bit little-endian RAW, (2^n+1)² -- Unity "Import Raw"
 *   albedo.png     1 px per cell, the top-down colours
 *   biome.png      R = biome index, G = voxel level, B = 255 on water
 *   map.json       sea level, biome legend, rivers, settlements, waterfalls
 *   README.txt     how to import
 */
(function (SM) {
  'use strict';

  // Unity terrain heightmaps must be 2^n+1 on a side. Smallest that does not
  // throw detail away: 128 → 129, 192 → 257, 448 → 513.
  function unityResolution(size) {
    var r = 33;
    while (r - 1 < size && r < 4097) r = (r - 1) * 2 + 1;
    return r;
  }

  // Continuous elevation (0..1), bilinear-resampled to res×res, as 16-bit
  // little-endian bytes. Row 0 is the map's SOUTH edge: Unity puts raw row 0
  // at terrain z = 0, so the terrain then reads the same way up as the
  // top-down view with no "Flip Vertically".
  function heightmapR16(grid, res) {
    var W = grid.width, H = grid.height, e = grid.elevation;
    var out = new Uint8Array(res * res * 2);
    for (var r = 0; r < res; r++) {
      var gy = (1 - r / (res - 1)) * (H - 1);
      var y0 = Math.floor(gy), y1 = Math.min(H - 1, y0 + 1), fy = gy - y0;
      for (var c = 0; c < res; c++) {
        var gx = c / (res - 1) * (W - 1);
        var x0 = Math.floor(gx), x1 = Math.min(W - 1, x0 + 1), fx = gx - x0;
        var top = e[y0 * W + x0] * (1 - fx) + e[y0 * W + x1] * fx;
        var bot = e[y1 * W + x0] * (1 - fx) + e[y1 * W + x1] * fx;
        var v = top * (1 - fy) + bot * fy;
        v = v < 0 ? 0 : v > 1 ? 1 : v;
        var u16 = Math.round(v * 65535), o = (r * res + c) * 2;
        out[o] = u16 & 255;
        out[o + 1] = u16 >> 8;
      }
    }
    return out;
  }

  function cells(grid, pred) {
    var list = [];
    for (var i = 0; i < grid.width * grid.height; i++) {
      if (pred(i)) list.push([i % grid.width, (i / grid.width) | 0]);
    }
    return list;
  }

  function exportMeta(grid) {
    var B = SM.BIOME_IDX, cfg = grid.config || {};
    var falls = [];
    if (grid.waterfalls) {
      for (var i = 0; i < grid.waterfalls.length; i++) {
        if (grid.waterfalls[i] === 1) {
          falls.push({ x: i % grid.width, y: (i / grid.width) | 0, drop: grid.waterfallDrop[i] });
        }
      }
    }
    return {
      generator: 'StilizedMaps',
      format: 1,
      seed: cfg.seed, width: grid.width, height: grid.height,
      heightmap: { file: 'heightmap.r16', resolution: unityResolution(Math.max(grid.width, grid.height)),
        depth: 16, byteOrder: 'little-endian', row0: 'south' },
      // Put the water plane at this fraction of the terrain height.
      seaLevelNormalized: grid.seaThresh,
      voxelLevels: cfg.levels || 10,
      coordinates: 'cells: x east, y SOUTH (row 0 = north, like the top-down view)',
      biomes: SM.BIOME_LIST.map(function (b, k) { return { index: k, id: b.id, label: b.label, color: b.color }; }),
      rivers: cells(grid, function (i) { return grid.biome[i] === B.river; }),
      lakes: cells(grid, function (i) { return grid.biome[i] === B.lake; }),
      settlements: (grid.settlements || []).map(function (s) { return { x: s.x, y: s.y, size: s.size }; }),
      waterfalls: falls
    };
  }

  // biome.png channels as raw RGBA, 1 px per cell (main.js puts it in a canvas).
  function biomeRGBA(grid) {
    var n = grid.width * grid.height, px = new Uint8ClampedArray(n * 4);
    for (var i = 0; i < n; i++) {
      px[i * 4] = grid.biome[i];
      px[i * 4 + 1] = grid.level[i] < 0 ? 0 : grid.level[i];
      px[i * 4 + 2] = grid.water[i] ? 255 : 0;
      px[i * 4 + 3] = 255;
    }
    return px;
  }

  var README_TEXT = [
    'StilizedMaps export — Unity import',
    '',
    '1. Terrain: GameObject > 3D Object > Terrain. In Terrain Settings set',
    '   Heightmap Resolution to the value in map.json heightmap.resolution,',
    '   Terrain Width/Length to taste (e.g. 1 m per cell), Height to taste.',
    '2. Terrain Settings > Import Raw: heightmap.r16, Depth 16 bit,',
    '   Byte Order Windows (little-endian), no flip. Row 0 is the south edge.',
    '3. Water: a plane at height = Terrain Height * map.json seaLevelNormalized.',
    '4. Colour: albedo.png as a Terrain Layer diffuse tiled once over the whole',
    '   terrain (Tile Size = terrain size), filter Point for the voxel look.',
    '5. Masks: biome.png  R = biome index (legend in map.json), G = voxel level,',
    '   B = 255 on water. Use it to drive splat layers or scatter rules.',
    '6. map.json lists rivers, lakes, settlements and waterfalls in cell',
    '   coordinates (x east, y south, origin at the north-west corner).',
    ''
  ].join('\n');

  // ---- minimal ZIP writer: STORE only, no compression, no dependencies ----
  var CRC_TABLE = null;
  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        CRC_TABLE[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(str) {
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xD800 && c < 0xDC00 && i + 1 < str.length) {
        c = 0x10000 + ((c - 0xD800) << 10) + (str.charCodeAt(++i) - 0xDC00);
        out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      } else out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }

  // files: [{ name, data: Uint8Array }] → Uint8Array of a valid .zip
  function zipStore(files) {
    var local = [], central = [], offset = 0, size = 0, k;
    function u16(v) { return [v & 255, (v >> 8) & 255]; }
    function u32(v) { return [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]; }
    for (k = 0; k < files.length; k++) {
      var name = utf8(files[k].name), data = files[k].data, crc = crc32(data);
      var head = [].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      local.push(new Uint8Array(head), name, data);
      central.push(new Uint8Array([].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0),
        u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length),
        u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset))), name);
      offset += head.length + name.length + data.length;
    }
    var cdSize = 0;
    for (k = 0; k < central.length; k++) cdSize += central[k].length;
    var end = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length),
      u16(files.length), u32(cdSize), u32(offset), u16(0)));
    var parts = local.concat(central, [end]);
    for (k = 0; k < parts.length; k++) size += parts[k].length;
    var out = new Uint8Array(size), at = 0;
    for (k = 0; k < parts.length; k++) { out.set(parts[k], at); at += parts[k].length; }
    return out;
  }

  // Everything except the two PNGs (which need a canvas): main.js passes
  // them in as bytes. Returns the .zip bytes.
  function buildUnityBundle(grid, pngs) {
    var meta = exportMeta(grid);
    var files = [
      { name: 'heightmap.r16', data: heightmapR16(grid, meta.heightmap.resolution) },
      { name: 'map.json', data: utf8(JSON.stringify(meta, null, 1)) },
      { name: 'README.txt', data: utf8(README_TEXT) }
    ];
    if (pngs && pngs.albedo) files.push({ name: 'albedo.png', data: pngs.albedo });
    if (pngs && pngs.biome) files.push({ name: 'biome.png', data: pngs.biome });
    return zipStore(files);
  }

  SM.Export = {
    unityResolution: unityResolution,
    heightmapR16: heightmapR16,
    exportMeta: exportMeta,
    biomeRGBA: biomeRGBA,
    crc32: crc32,
    zipStore: zipStore,
    buildUnityBundle: buildUnityBundle
  };
})(window.SM = window.SM || {});
