/* World type presets — pure data + matching logic, no DOM.
 *
 * Moved out of main.js (2026-09-23) so the presets can be verified headless
 * (`node tools/headless.js --worldtypes`): every preset's values must stay
 * inside its slider's min/max/step (index.html), `match(values(type))` must
 * round-trip back to `type` for every preset, and a perturbed value must
 * read as 'custom'. DOM-free on purpose — `match` takes a `getValue(id)`
 * function instead of reading `$(id).value` itself, so the same logic runs
 * in the browser (main.js passes a DOM reader) and under Node (headless.js
 * passes a plain object reader).
 *
 * Values were chosen by measurement (3 seeds; panel review 2026-09-23), not
 * by eye:
 *   island   → one landmass, open sea on every edge at 256²
 *   frozen   → tundra 22% + taiga 15% of land
 *   arid     → desert 20% + shrubland 24%
 *   tropical → jungle 26% + forest 21%
 * "Archipelago" and "Pangaea" were tried and dropped: island consolidation
 * (a documented rule: more sea → fewer, merged islands) defeats both.
 */
(function (SM) {
  'use strict';

  var DEFAULTS = { sea: 0.38, rugged: 0.35, warp: 0.18, escale: 2.5, octaves: 5,
    island: 0, tbias: 0, mbias: 0, rivers: 1 };
  var TYPES = {
    continents: {},
    island: { sea: 0.55, island: 1 },
    frozen: { tbias: -0.26, mbias: 0.06, rivers: 0.75 },
    arid: { tbias: 0.22, mbias: -0.26, rivers: 0.5 },
    tropical: { tbias: 0.2, mbias: 0.28, rivers: 1.25 }
  };
  var KEYS = Object.keys(DEFAULTS);

  function values(type) {
    return Object.assign({}, DEFAULTS, TYPES[type] || {});
  }

  // Which world type the given values match (a shared link, or a user who
  // moved a slider back) -- 'custom' when none. `getValue(id)` returns the
  // current numeric value for a slider id; the caller supplies it (DOM in
  // the browser, a plain lookup under Node).
  function match(getValue) {
    var types = Object.keys(TYPES);
    for (var k = 0; k < types.length; k++) {
      var v = values(types[k]);
      var same = KEYS.every(function (id) {
        return Math.abs(getValue(id) - v[id]) < 1e-6;
      });
      if (same) return types[k];
    }
    return 'custom';
  }

  SM.WorldTypes = { DEFAULTS: DEFAULTS, TYPES: TYPES, KEYS: KEYS,
    values: values, match: match };
})(window.SM = window.SM || {});
