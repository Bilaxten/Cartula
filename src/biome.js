/* Biome table. Index into BIOME_LIST is what the grid stores. */
(function (SM) {
  'use strict';

  var BIOME_LIST = [
    { id: 'deep_water',    label: 'Derin deniz',   color: '#1b3a5c' },
    { id: 'shallow_water', label: 'Sığ deniz',     color: '#2f6690' },
    { id: 'beach',         label: 'Kumsal',        color: '#d9c48f' },
    { id: 'plains',        label: 'Ova',           color: '#8fb563' },
    { id: 'forest',        label: 'Orman',         color: '#4f7f42' },
    { id: 'jungle',        label: 'Yağmur ormanı', color: '#3f6b32' },
    { id: 'savanna',       label: 'Savan',         color: '#b7ad5f' },
    { id: 'desert',        label: 'Çöl',           color: '#d8b96b' },
    { id: 'tundra',        label: 'Tundra',        color: '#9db3a6' },
    { id: 'rock',          label: 'Kaya',          color: '#7c7468' },
    { id: 'snow',          label: 'Kar',           color: '#e9edf0' }
  ];

  var IDX = {};
  BIOME_LIST.forEach(function (b, i) { IDX[b.id] = i; });

  /* Classify from normalized elevation/moisture/temperature (each 0..1). */
  function classify(elev, moist, temp, seaLevel) {
    if (elev < seaLevel - 0.06) return IDX.deep_water;
    if (elev < seaLevel) return IDX.shallow_water;
    if (elev < seaLevel + 0.015) return IDX.beach;

    if (elev > 0.80) return temp < 0.5 ? IDX.snow : IDX.rock;
    if (elev > 0.68) return temp < 0.3 ? IDX.snow : IDX.rock;

    if (temp < 0.30) return IDX.tundra;

    if (temp > 0.68) {
      if (moist < 0.25) return IDX.desert;
      if (moist < 0.50) return IDX.savanna;
      return IDX.jungle;
    }

    if (moist < 0.32) return IDX.plains;
    return IDX.forest;
  }

  SM.BIOME_LIST = BIOME_LIST;
  SM.BIOME_IDX = IDX;
  SM.classifyBiome = classify;
})(window.SM = window.SM || {});
