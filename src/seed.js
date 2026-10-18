/* The seed is the whole map: one short code that carries the random base AND
 * every generation setting (Uğur 2026-10-19: "seed ayarları da temsil edecek").
 * Pure data + math, no DOM, so the round trip is verified headless
 * (`node tools/headless.js --seed`).
 *
 *   1-k3m9-0bx7-4h2d-q8wn-5ztc
 *   ^ version, then 20 characters = 100 bits:
 *     32 bits random base · 54 bits of settings · 14 bits check
 *
 * Alphabet: 32 symbols without i, l, o, u (typed "o" reads as 0, "i"/"l" as 1,
 * "u" as v), case-insensitive, dashes and spaces ignored. Settings are stored
 * as the slider's step index, so a code can only carry values the sliders can
 * show. `season` is render-only but travels in the code too.
 *
 * Versioned: a later change to the field list gets a new version character;
 * old codes keep decoding with their own field table (only version 1 exists).
 * Numeric seeds from before this format are not supported on purpose.
 */
(function (SM) {
  'use strict';

  var VERSION = '1';
  var ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
  var CHECK_BITS = 14;
  var CHARS = 20;

  // id, slider min / step (index.html), index width in bits.
  var FIELDS = [
    { id: 'size',    min: 128,   step: 32,   bits: 4 },
    { id: 'sea',     min: 0.15,  step: 0.01, bits: 6 },
    { id: 'rugged',  min: 0,     step: 0.05, bits: 5 },
    { id: 'warp',    min: 0,     step: 0.02, bits: 5 },
    { id: 'escale',  min: 1,     step: 0.1,  bits: 6 },
    { id: 'octaves', min: 2,     step: 1,    bits: 3 },
    { id: 'island',  min: 0,     step: 0.05, bits: 5 },
    { id: 'tbias',   min: -0.3,  step: 0.02, bits: 5 },
    { id: 'mbias',   min: -0.3,  step: 0.02, bits: 5 },
    { id: 'rivers',  min: 0,     step: 0.25, bits: 4 },
    { id: 'season',  min: 0,     step: 0.05, bits: 6 }
  ];
  // Highest index each slider reaches (max from index.html), so a code that
  // names a value off the end of a slider is rejected, not clamped.
  var MAX = { size: 10, sea: 55, rugged: 20, warp: 25, escale: 50, octaves: 5,
    island: 20, tbias: 30, mbias: 30, rivers: 8, season: 60 };

  function indexOf(f, v) {
    var i = Math.round((v - f.min) / f.step);
    return Math.max(0, Math.min(MAX[f.id], i));
  }
  function valueOf(f, i) { return +(f.min + i * f.step).toFixed(2) + 0; } // + 0: no -0

  // 14-bit check over version, base and indices (FNV-1a style, integer only).
  function check(base, idx) {
    var h = 0x811c9dc5, k;
    function mix(n) { h = Math.imul(h ^ (n & 0xffff), 0x01000193); h = Math.imul(h ^ (n >>> 16), 0x01000193); }
    mix(VERSION.charCodeAt(0));
    mix(base);
    for (k = 0; k < idx.length; k++) mix(idx[k] + 1);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
    return (h >>> 0) & ((1 << CHECK_BITS) - 1);
  }

  function randomBase() { return (Math.random() * 4294967296) >>> 0; }

  // settings: {size, sea, ...} by slider id (numbers). base: uint32.
  function encode(base, settings) {
    base = base >>> 0;
    var idx = FIELDS.map(function (f) { return indexOf(f, +settings[f.id]); });
    var bits = [], k, b;
    function put(n, width) { for (b = width - 1; b >= 0; b--) bits.push((n >>> b) & 1); }
    put(base >>> 16, 16); put(base & 0xffff, 16);
    FIELDS.forEach(function (f, i) { put(idx[i], f.bits); });
    put(check(base, idx), CHECK_BITS);
    var out = '';
    for (k = 0; k < CHARS; k++) {
      var v = 0;
      for (b = 0; b < 5; b++) v = (v << 1) | bits[k * 5 + b];
      out += ALPHABET.charAt(v);
      if (k % 4 === 3 && k < CHARS - 1) out += '-';
    }
    return VERSION + '-' + out;
  }

  // -> { ok: true, base, settings } | { ok: false, error }
  // error: 'empty' | 'chars' | 'length' | 'version' | 'checksum' | 'range'
  function decode(text) {
    var s = String(text == null ? '' : text).toLowerCase().replace(/[\s\-_.]/g, '');
    if (!s) return { ok: false, error: 'empty' };
    s = s.replace(/o/g, '0').replace(/[il]/g, '1').replace(/u/g, 'v');
    if (/[^0-9a-z]/.test(s) || /[^0-9a-hjkmnp-tv-z]/.test(s.slice(1))) return { ok: false, error: 'chars' };
    // A short bare number is the old format: say so rather than "wrong length".
    if (/^\d+$/.test(s) && s.length < 12) return { ok: false, error: 'old' };
    if (s.charAt(0) !== VERSION) return { ok: false, error: s.length === CHARS + 1 ? 'version' : 'length' };
    if (s.length !== CHARS + 1) return { ok: false, error: 'length' };
    var bits = [], k, b, pos = 0;
    for (k = 1; k <= CHARS; k++) {
      var v = ALPHABET.indexOf(s.charAt(k));
      for (b = 4; b >= 0; b--) bits.push((v >>> b) & 1);
    }
    function take(width) { var n = 0, i; for (i = 0; i < width; i++) n = n * 2 + bits[pos++]; return n; }
    var base = (take(16) * 65536 + take(16)) >>> 0;
    var idx = [], settings = {}, bad = false;
    FIELDS.forEach(function (f) {
      var i = take(f.bits);
      if (i > MAX[f.id]) bad = true;
      idx.push(i);
      settings[f.id] = valueOf(f, i);
    });
    var chk = take(CHECK_BITS);
    if (chk !== check(base, idx)) return { ok: false, error: 'checksum' };
    if (bad) return { ok: false, error: 'range' };
    return { ok: true, base: base, settings: settings };
  }

  // The code in its canonical spelling, or null when it does not decode.
  function normalize(text) {
    var d = decode(text);
    return d.ok ? encode(d.base, d.settings) : null;
  }

  SM.Seed = { VERSION: VERSION, FIELDS: FIELDS, MAX: MAX, encode: encode, decode: decode,
    normalize: normalize, randomBase: randomBase };
})(window.SM = window.SM || {});
