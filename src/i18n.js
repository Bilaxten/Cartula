/* UI language: Turkish and English, switched live with the TR / EN control in
 * the panel header. Everything the app shows goes through this dictionary --
 * static markup by hook attributes, strings built in JS by `SM.I18N.t`.
 *
 * Hooks in index.html (applied by `apply`):
 *   data-i18n="key"             text of the element (only its first text node
 *                               when it also holds child elements, so a label
 *                               keeps its value <span> and a checkbox label
 *                               keeps its <input>)
 *   data-i18n-title / -aria-label / -placeholder / -alt = "key"
 *                               that attribute
 *   data-i18n-js                text written by main.js (slider values,
 *                               hints); main.js rewrites it on a language change
 *   translate="no"              names that are not translated (Cartula, TR / EN)
 * `node tools/headless.js --i18n` fails when a key is missing in one language
 * or an element in index.html shows text without one of these hooks.
 *
 * The choice is shared with the rest of bilaxten.art (same origin): the
 * localStorage key `bx-lang`, values `tr` / `en`. With nothing saved, a
 * browser whose language starts with "tr" gets Turkish, every other English.
 * This file is loaded in <head>, so <html lang> is right before first paint;
 * index.html calls `apply(document)` right after the panel markup.
 *
 * Exported files (PNG, the Unity .zip and its map.json / README) are data, not
 * UI, and stay in English. */
(function (SM) {
  'use strict';

  var STORAGE_KEY = 'bx-lang';
  var ATTRS = ['title', 'aria-label', 'placeholder', 'alt'];

  var STRINGS = {
    en: {
      'app.title': 'Cartula',
      'brand.tag': 'procedural stylized world generator',
      'lang.group': 'Dil / Language',
      'stage.toggle.title': 'Map background: light / dark (independent of the theme)',
      'stage.toggle.aria': 'Toggle map background',
      'theme.toggle': 'Toggle dark mode',

      'view.top': 'Top-down',
      'view.iso': 'Isometric',
      'view.noWebgl': 'This browser has no WebGL2',

      'group.world': 'World',
      'worldType.label': 'World type',
      'worldType.title': 'Sets every generation slider at once. Moving a slider switches this to Custom.',
      'wt.continents': 'Continents (default)',
      'wt.island': 'Single island',
      'wt.frozen': 'Frozen',
      'wt.arid': 'Arid',
      'wt.tropical': 'Tropical',
      'wt.custom': 'Custom',
      'seed.label': 'Seed',
      'size.label': 'Map size',

      'group.elevation': 'Elevation',
      'sea.label': 'Sea level',
      'sea.title': 'How much of the world is sea. The value shows the land share of the generated map.',
      'sea.value': '{pct}% land',
      'rugged.label': 'Ruggedness',
      'rugged.title': 'Blend of sharp ridged mountains into the rolling base terrain.',
      'warp.label': 'Coast warp',
      'warp.title': 'Domain warp: bends coastlines and ranges into organic shapes.',
      'escale.label': 'Feature scale',
      'escale.title': 'Noise frequency. Lower = fewer, larger landmasses; higher = many small features.',
      'octaves.label': 'Detail',
      'octaves.title': 'Noise octaves: fine surface detail on top of the large shapes.',
      'island.label': 'Island',
      'island.title': 'Gathers the land into one central mass with open sea around it. Sea level still sets how much land there is.',
      'island.off': 'off',

      'group.climate': 'Climate',
      'tbias.label': 'Temperature',
      'tbias.title': 'Shifts the whole climate colder (tundra, taiga, snow) or hotter (savanna, desert, jungle).',
      'tbias.frozen': 'Frozen',
      'tbias.cold': 'Cold',
      'tbias.temperate': 'Temperate',
      'tbias.warm': 'Warm',
      'tbias.hot': 'Hot',
      'mbias.label': 'Rainfall',
      'mbias.title': 'Shifts rainfall: drier (shrubland, desert) or wetter (forest, marsh, jungle).',
      'mbias.arid': 'Arid',
      'mbias.dry': 'Dry',
      'mbias.normal': 'Normal',
      'mbias.wet': 'Wet',
      'mbias.veryWet': 'Very wet',
      'rivers.label': 'Rivers',
      'rivers.title': 'How many river sources are traced from the summits.',
      'rivers.none': 'None',
      'rivers.few': 'Few',
      'rivers.normal': 'Normal',
      'rivers.more': 'More',
      'rivers.many': 'Many',

      'group.view': 'View',
      'isoexag.label': 'Height exaggeration (iso)',
      'sun.label': 'Time of day',
      'debug.label': 'Render debug view',
      'debug.lit': 'Lit (normal)',
      'debug.ao': 'Ambient occlusion',
      'debug.normals': 'Normals',
      'debug.height': 'Height (voxel level)',
      'debug.albedo': 'Albedo (unlit)',
      'debug.shadow': 'Sun shadow',
      'debug.falls': 'Waterfall faces',
      'check.clouds': 'Clouds & birds',
      'check.anim': 'Terrain animation',
      'check.wind': 'Wind lines',
      'check.weather': 'Rain & snow',
      'check.grid': 'Grid lines',
      'check.shade': 'Hillshade',
      'check.perf': 'Performance panel (P)',
      'perf.title': 'Performance',
      'perf.frame': 'frame',
      'perf.frameVal': '{avg} ms avg · {worst} worst',
      'perf.fps': 'fps',
      'perf.cpu': 'cpu',
      'perf.cpuVal': '{avg} ms avg (render, JS)',
      'perf.gpu': 'gpu',
      'perf.gpuVal': '{avg} ms avg (timer query)',
      'perf.gpuNone': 'no timer in this browser',
      'perf.draws': 'draw calls',
      'perf.tris': 'triangles',
      'perf.mem': 'gpu memory',
      'perf.memVal': '~{total} MB estimate',
      'perf.memDetail': 'buffers {b} · textures {t} · canvas {c} MB',
      'perf.window': 'last {n} frames',
      'perf.idle': 'idle: no frames drawn (animation off?)',
      'perf.isoOnly': 'isometric view only',

      'group.pipeline': 'Pipeline',
      'pipeline.enter': 'Step through generation',
      'pipeline.exit': 'Exit step-through',
      'pipeline.slider': 'Generation stage',
      'pipeline.prev': '◀ Prev',
      'pipeline.next': 'Next ▶',

      'group.edit': 'Edit',
      'edit.tool': 'Tool',
      'tool.pan': 'Pan',
      'tool.raise': 'Raise',
      'tool.lower': 'Lower',
      'tool.smooth': 'Smooth',
      'tool.water': 'Water',
      'tool.land': 'Land',
      'tool.river': 'Draw river',
      'tool.biome': 'Paint biome',
      'edit.brushSize': 'Brush size',
      'edit.strength': 'Strength',
      'edit.biome': 'Biome',
      'edit.undo': 'Undo',
      'edit.redo': 'Redo',
      'edit.reset': 'Reset to generated',
      'edit.note': 'Brushes work in top-down view.',

      'group.biomes': 'Biomes',

      'regen.label': 'Regenerate',
      'regen.title': 'New seed, same settings (R)',
      'random.label': 'Random',
      'random.title': 'Random settings and a new seed (Shift+R)',
      'export.png': 'Export PNG',
      'export.png.title': 'Download the current view as a PNG',
      'share.label': 'Copy link',
      'share.title': 'Copy a link that reproduces this map',
      'share.copied': 'Copied',
      'share.copiedSettings': 'Copied (settings only)',
      'share.failed': 'Copy failed',
      'export.unity': 'Export for Unity (.zip)',
      'export.unity.title': 'Heightmap (16-bit RAW), albedo, biome mask and map.json as one .zip — Unity Terrain ready',

      'stats.base': '{w}×{h} · {ms} ms · land {pct}%',
      'stats.edited': 'edited',
      'hover.moist': 'moist',

      'hint.top': 'drag / space+drag to pan · scroll to zoom',
      // \u00a0 keeps each hint segment whole: the isometric hint wraps only
      // at a '·' before it reaches the yaw chip (style.css body.iso #isohint).
      'hint.iso': 'drag\u00a0to\u00a0orbit · space/shift+drag\u00a0to\u00a0pan · scroll\u00a0to\u00a0zoom · Q/E\u00a0snap',
      'hint.contextLost': 'GPU context lost · waiting for the browser to restore it',
      'hint.top.touch': 'drag\u00a0to\u00a0pan · pinch\u00a0to\u00a0zoom',
      'hint.iso.touch': 'drag\u00a0to\u00a0orbit · two\u00a0fingers\u00a0to\u00a0pan · pinch\u00a0to\u00a0zoom',
      'yaw.slider': 'Camera yaw',
      'yaw.auto': 'Auto-rotate',
      'yaw.center.title': 'Center view: frame the whole map again (angle kept)',
      'yaw.center.aria': 'Center view',
      'panel.open': 'Open panel',
      'panel.close': 'Close panel',

      'biome.deep_water': 'Deep sea',
      'biome.shallow_water': 'Shallow sea',
      'biome.river': 'River',
      'biome.lake': 'Lake',
      'biome.beach': 'Beach',
      'biome.cliff': 'Cliff',
      'biome.marsh': 'Marsh',
      'biome.grassland': 'Grassland',
      'biome.plains': 'Plains',
      'biome.shrubland': 'Shrubland',
      'biome.forest': 'Forest',
      'biome.taiga': 'Taiga',
      'biome.jungle': 'Rainforest',
      'biome.savanna': 'Savanna',
      'biome.desert': 'Desert',
      'biome.mesa': 'Mesa',
      'biome.tundra': 'Tundra',
      'biome.bare': 'Bare',
      'biome.rock': 'Rock',
      'biome.snow': 'Snow',
      'biome.lava': 'Lava',
      'biome.volcanic': 'Volcanic rock',
      'biome.town': 'Settlement',

      'stage.sample.label': 'World-space noise',
      'stage.sample.desc': 'fBm + domain warp sampled in world space: a bigger map reveals more world, it does not stretch this one.',
      'stage.shape.label': 'Mountains & repair',
      'stage.shape.desc': 'Ridged ranges along fault lines, peak prominence, plateaus; single-tile spikes and pits clamped.',
      'stage.sea.label': 'Sea level',
      'stage.sea.desc': 'An absolute threshold from a fixed reference area — the coast does not move when the map grows.',
      'stage.climate.label': 'Climate & biomes',
      'stage.climate.desc': 'Moisture with rain shadow, temperature by latitude + altitude, continentality; each tile classified.',
      'stage.coast.label': 'Coast cleanup',
      'stage.coast.desc': 'Speckles removed, ocean flood-filled from the border (enclosed water becomes lakes), islands consolidated.',
      'stage.features.label': 'Fjords, spits, volcanoes',
      'stage.features.desc': 'Cold steep inlets, curving beach spits with lagoons, volcanic cones with lava flows.',
      'stage.rivers.label': 'Rivers',
      'stage.rivers.desc': 'Steepest-descent rivers from summits carve V-valleys and merge into trunks; deltas or estuaries at the mouth.',
      'stage.riparian.label': 'Riparian & invariants',
      'stage.riparian.desc': 'Green buffers along water; fragments and river stubs that reach no outlet are cleaned up.',
      'stage.grade.label': 'River grading',
      'stage.grade.desc': 'Every 2-level riverbed step is carved to 1; drops of 3+ stay and become waterfalls.',
      'stage.voxel.label': 'Voxelize',
      'stage.voxel.desc': 'Discrete levels, tower clamp, waterfall tags — the grid both views draw from.'
    },

    tr: {
      'app.title': 'Cartula',
      'brand.tag': 'prosedürel stilize dünya üreteci',
      'lang.group': 'Dil / Language',
      'stage.toggle.title': 'Harita arka planı: açık / koyu (temadan bağımsız)',
      'stage.toggle.aria': 'Harita arka planını değiştir',
      'theme.toggle': 'Koyu modu aç / kapat',

      'view.top': 'Üstten',
      'view.iso': 'İzometrik',
      'view.noWebgl': 'Bu tarayıcıda WebGL2 yok',

      'group.world': 'Dünya',
      'worldType.label': 'Dünya tipi',
      'worldType.title': 'Bütün üretim kaydırıcılarını tek seferde ayarlar. Bir kaydırıcıyı oynatınca Özel’e geçer.',
      'wt.continents': 'Kıtalar (varsayılan)',
      'wt.island': 'Tek ada',
      'wt.frozen': 'Donmuş',
      'wt.arid': 'Kurak',
      'wt.tropical': 'Tropikal',
      'wt.custom': 'Özel',
      'seed.label': 'Tohum',
      'size.label': 'Harita boyutu',

      'group.elevation': 'Yükselti',
      'sea.label': 'Deniz seviyesi',
      'sea.title': 'Dünyanın ne kadarının deniz olduğu. Değer, üretilen haritadaki kara payını gösterir.',
      'sea.value': '%{pct} kara',
      'rugged.label': 'Engebe',
      'rugged.title': 'Keskin sırtlı dağların yumuşak dalgalı taban araziye karışma oranı.',
      'warp.label': 'Kıyı bükümü',
      'warp.title': 'Alan bükümü (domain warp): kıyıları ve sıradağları organik biçimlere büker.',
      'escale.label': 'Şekil ölçeği',
      'escale.title': 'Gürültü frekansı. Düşük = daha az ve daha büyük kara parçası; yüksek = çok sayıda küçük şekil.',
      'octaves.label': 'Ayrıntı',
      'octaves.title': 'Gürültü oktavları: büyük şekillerin üstüne ince yüzey ayrıntısı.',
      'island.label': 'Ada',
      'island.title': 'Karayı, çevresi açık denizle sarılı tek bir merkezî kütlede toplar. Ne kadar kara olacağını yine deniz seviyesi belirler.',
      'island.off': 'kapalı',

      'group.climate': 'İklim',
      'tbias.label': 'Sıcaklık',
      'tbias.title': 'Bütün iklimi soğuğa (tundra, tayga, kar) ya da sıcağa (savan, çöl, yağmur ormanı) kaydırır.',
      'tbias.frozen': 'Dondurucu',
      'tbias.cold': 'Soğuk',
      'tbias.temperate': 'Ilıman',
      'tbias.warm': 'Ilık',
      'tbias.hot': 'Sıcak',
      'mbias.label': 'Yağış',
      'mbias.title': 'Yağışı kaydırır: daha kurak (çalılık, çöl) ya da daha nemli (orman, bataklık, yağmur ormanı).',
      'mbias.arid': 'Kurak',
      'mbias.dry': 'Az yağışlı',
      'mbias.normal': 'Normal',
      'mbias.wet': 'Yağışlı',
      'mbias.veryWet': 'Çok yağışlı',
      'rivers.label': 'Nehirler',
      'rivers.title': 'Zirvelerden kaç nehir kaynağının izleneceği.',
      'rivers.none': 'Yok',
      'rivers.few': 'Az',
      'rivers.normal': 'Normal',
      'rivers.more': 'Daha çok',
      'rivers.many': 'Çok',

      'group.view': 'Görünüm',
      'isoexag.label': 'Yükseklik abartısı (izometrik)',
      'sun.label': 'Günün saati',
      'debug.label': 'Render hata ayıklama görünümü',
      'debug.lit': 'Işıklı (normal)',
      'debug.ao': 'Ortam kapatma (AO)',
      'debug.normals': 'Normaller',
      'debug.height': 'Yükseklik (voksel kademesi)',
      'debug.albedo': 'Albedo (ışıksız)',
      'debug.shadow': 'Güneş gölgesi',
      'debug.falls': 'Şelale yüzeyleri',
      'check.clouds': 'Bulutlar ve kuşlar',
      'check.anim': 'Arazi animasyonu',
      'check.wind': 'Rüzgâr çizgileri',
      'check.weather': 'Yağmur ve kar',
      'check.grid': 'Izgara çizgileri',
      'check.shade': 'Kabartma gölgesi',
      'check.perf': 'Performans paneli (P)',
      'perf.title': 'Performans',
      'perf.frame': 'kare',
      'perf.frameVal': 'ort. {avg} ms · en kötü {worst}',
      'perf.fps': 'fps',
      'perf.cpu': 'cpu',
      'perf.cpuVal': 'ort. {avg} ms (render, JS)',
      'perf.gpu': 'gpu',
      'perf.gpuVal': 'ort. {avg} ms (zamanlayıcı sorgusu)',
      'perf.gpuNone': 'bu tarayıcıda zamanlayıcı yok',
      'perf.draws': 'çizim çağrısı',
      'perf.tris': 'üçgen',
      'perf.mem': 'gpu belleği',
      'perf.memVal': '~{total} MB tahmini',
      'perf.memDetail': 'buffer {b} · doku {t} · tuval {c} MB',
      'perf.window': 'son {n} kare',
      'perf.idle': 'boşta: kare çizilmiyor (animasyon kapalı mı?)',
      'perf.isoOnly': 'yalnız izometrik görünüm',

      'group.pipeline': 'Üretim hattı',
      'pipeline.enter': 'Üretimi adım adım izle',
      'pipeline.exit': 'Adım adım izlemeyi kapat',
      'pipeline.slider': 'Üretim aşaması',
      'pipeline.prev': '◀ Önceki',
      'pipeline.next': 'Sonraki ▶',

      'group.edit': 'Düzenle',
      'edit.tool': 'Araç',
      'tool.pan': 'Kaydır',
      'tool.raise': 'Yükselt',
      'tool.lower': 'Alçalt',
      'tool.smooth': 'Yumuşat',
      'tool.water': 'Su',
      'tool.land': 'Kara',
      'tool.river': 'Nehir çiz',
      'tool.biome': 'Biyom boya',
      'edit.brushSize': 'Fırça boyutu',
      'edit.strength': 'Güç',
      'edit.biome': 'Biyom',
      'edit.undo': 'Geri al',
      'edit.redo': 'Yinele',
      'edit.reset': 'Üretilen hâline döndür',
      'edit.note': 'Fırçalar üstten görünümde çalışır.',

      'group.biomes': 'Biyomlar',

      'regen.label': 'Yeniden üret',
      'regen.title': 'Yeni tohum, ayarlar aynı kalır (R)',
      'random.label': 'Rastgele',
      'random.title': 'Rastgele ayarlar ve yeni tohum (Shift+R)',
      'export.png': 'PNG indir',
      'export.png.title': 'Geçerli görünümü PNG olarak indir',
      'share.label': 'Bağlantıyı kopyala',
      'share.title': 'Bu haritayı yeniden üreten bir bağlantı kopyala',
      'share.copied': 'Kopyalandı',
      'share.copiedSettings': 'Kopyalandı (yalnız ayarlar)',
      'share.failed': 'Kopyalanamadı',
      'export.unity': 'Unity için dışa aktar (.zip)',
      'export.unity.title': 'Yükseklik haritası (16-bit RAW), albedo, biyom maskesi ve map.json tek .zip içinde — Unity Terrain’e hazır',

      'stats.base': '{w}×{h} · {ms} ms · kara %{pct}',
      'stats.edited': 'düzenlendi',
      'hover.moist': 'nem',

      'hint.top': 'sürükle / boşluk+sürükle: kaydır · tekerlek: yakınlaş',
      'hint.iso': 'sürükle:\u00a0döndür · boşluk/shift+sürükle:\u00a0kaydır · tekerlek:\u00a0yakınlaş · Q/E:\u00a090°',
      'hint.contextLost': 'GPU bağlamı kayboldu · tarayıcının geri getirmesi bekleniyor',
      'hint.top.touch': 'sürükle:\u00a0kaydır · iki\u00a0parmak:\u00a0yakınlaş',
      'hint.iso.touch': 'sürükle:\u00a0döndür · iki\u00a0parmak:\u00a0kaydır\u00a0/\u00a0yakınlaş',
      'yaw.slider': 'Kamera dönüş açısı',
      'yaw.auto': 'Kendiliğinden döndür',
      'yaw.center.title': 'Görünümü ortala: haritanın tamamı yeniden kadraja girer (açı korunur)',
      'yaw.center.aria': 'Görünümü ortala',
      'panel.open': 'Paneli aç',
      'panel.close': 'Paneli kapat',

      'biome.deep_water': 'Derin deniz',
      'biome.shallow_water': 'Sığ deniz',
      'biome.river': 'Nehir',
      'biome.lake': 'Göl',
      'biome.beach': 'Kumsal',
      'biome.cliff': 'Uçurum',
      'biome.marsh': 'Bataklık',
      'biome.grassland': 'Çayır',
      'biome.plains': 'Ova',
      'biome.shrubland': 'Çalılık',
      'biome.forest': 'Orman',
      'biome.taiga': 'Tayga',
      'biome.jungle': 'Yağmur ormanı',
      'biome.savanna': 'Savan',
      'biome.desert': 'Çöl',
      'biome.mesa': 'Mesa',
      'biome.tundra': 'Tundra',
      'biome.bare': 'Çıplak arazi',
      'biome.rock': 'Kaya',
      'biome.snow': 'Kar',
      'biome.lava': 'Lav',
      'biome.volcanic': 'Volkanik kaya',
      'biome.town': 'Yerleşim',

      'stage.sample.label': 'Dünya uzayında gürültü',
      'stage.sample.desc': 'fBm + alan bükümü dünya uzayında örneklenir: daha büyük bir harita dünyanın daha fazlasını gösterir, bu haritayı germez.',
      'stage.shape.label': 'Dağlar ve onarım',
      'stage.shape.desc': 'Fay hatları boyunca sırtlı sıradağlar, zirve belirginliği, platolar; tek hücrelik sivri uçlar ve çukurlar törpülenir.',
      'stage.sea.label': 'Deniz seviyesi',
      'stage.sea.desc': 'Sabit bir referans alandan alınan mutlak bir eşik — harita büyüyünce kıyı yerinden oynamaz.',
      'stage.climate.label': 'İklim ve biyomlar',
      'stage.climate.desc': 'Yağmur gölgeli nem, enleme ve rakıma göre sıcaklık, karasallık; her hücre sınıflandırılır.',
      'stage.coast.label': 'Kıyı temizliği',
      'stage.coast.desc': 'Benekler silinir, okyanus kenardan dolgu ile yayılır (kapalı kalan sular göle dönüşür), adalar birleştirilir.',
      'stage.features.label': 'Fiyortlar, kum dilleri, volkanlar',
      'stage.features.desc': 'Soğuk ve dik koylar, lagünlü kıvrık kum dilleri, lav akıntılı volkan konileri.',
      'stage.rivers.label': 'Nehirler',
      'stage.rivers.desc': 'Zirvelerden en dik iniş yolunu izleyen nehirler V-vadiler oyar ve ana kollarda birleşir; ağızda delta ya da haliç oluşur.',
      'stage.riparian.label': 'Kıyı şeridi ve değişmezler',
      'stage.riparian.desc': 'Su boyunca yeşil tampon şeritler; hiçbir çıkışa ulaşmayan parçalar ve yarım kalan nehir uçları temizlenir.',
      'stage.grade.label': 'Nehir yatağı düzeltme',
      'stage.grade.desc': 'Nehir yatağındaki her 2 kademelik basamak 1’e oyulur; 3 ve üstü düşüşler kalır ve şelale olur.',
      'stage.voxel.label': 'Vokselleştirme',
      'stage.voxel.desc': 'Ayrık kademeler, kule kırpma, şelale etiketleri — iki görünümün de çizdiği ızgara.'
    }
  };

  function readSaved() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      return v === 'tr' || v === 'en' ? v : null;
    } catch (e) { return null; }
  }

  // No saved choice: English (Uğur 2026-10-05), whatever the browser says.
  var lang = readSaved() || 'en';
  var listeners = [];

  // Missing in the active language -> English -> the key itself, so a gap
  // shows up as a visible key instead of an empty control. The harness
  // (`--i18n`) keeps both tables complete.
  function t(key, vars) {
    var s = STRINGS[lang][key];
    if (s == null) s = STRINGS.en[key];
    if (s == null) return key;
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, function (m, name) {
        return vars[name] != null ? String(vars[name]) : m;
      });
    }
    return s;
  }

  function setText(el, s) {
    if (!el.children.length) { el.textContent = s; return; }
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3 && /\S/.test(n.nodeValue)) {
        var lead = n.nodeValue.match(/^\s*/)[0];
        var trail = n.nodeValue.match(/\s*$/)[0];
        n.nodeValue = lead + s + trail;
        return;
      }
    }
  }

  function markRoot() {
    if (typeof document === 'undefined') return;
    var root = document.documentElement;
    root.setAttribute('lang', lang);
    root.setAttribute('data-lang', lang);
  }

  function apply(scope) {
    if (!scope || !scope.querySelectorAll) return;
    var els = scope.querySelectorAll('[data-i18n]');
    for (var i = 0; i < els.length; i++) setText(els[i], t(els[i].getAttribute('data-i18n')));
    ATTRS.forEach(function (attr) {
      var hooked = scope.querySelectorAll('[data-i18n-' + attr + ']');
      for (var k = 0; k < hooked.length; k++) {
        hooked[k].setAttribute(attr, t(hooked[k].getAttribute('data-i18n-' + attr)));
      }
    });
    var buttons = scope.querySelectorAll('[data-set-lang]');
    for (var b = 0; b < buttons.length; b++) {
      buttons[b].setAttribute('aria-pressed',
        String(buttons[b].getAttribute('data-set-lang') === lang));
    }
  }

  /* Re-typing on a language switch, as on bilaxten.art: every visible text
   * node on screen is split into one span per character and the characters
   * fade in left to right over TYPE_MS; then the original text node is put
   * back. Opacity only, so layout does not move. Text that main.js rewrites
   * while it runs simply replaces the spans (restoring skips detached ones);
   * the performance panel and the hover card are left out because they
   * repaint on their own. Instant with prefers-reduced-motion. */
  var TYPE_MS = 650;
  var typing = [];
  var typingTimer = 0;

  function finishTyping() {
    clearTimeout(typingTimer);
    typing.forEach(function (w) {
      if (w.wrap.parentNode) w.wrap.parentNode.replaceChild(w.node, w.wrap);
    });
    typing = [];
  }

  function typeIn() {
    var vh;
    var walker;
    var nodes = [];
    var total = 0;
    var step;
    var i = 0;
    var n;

    finishTyping();
    if (typeof document === 'undefined' || !document.createTreeWalker) return;
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    vh = window.innerHeight;
    walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (t) {
        var el = t.parentElement;
        var r;
        if (!t.nodeValue.trim() || !el) return NodeFilter.FILTER_REJECT;
        if (el.closest('script, style, option, select, [aria-hidden="true"], #perfPanel, #hover')) {
          return NodeFilter.FILTER_REJECT;
        }
        r = el.getBoundingClientRect();
        if (!r.width || !r.height || r.bottom < 0 || r.top > vh) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(function (t) { total += t.nodeValue.length; });
    if (!total) return;
    step = TYPE_MS / Math.max(total, 40);
    nodes.forEach(function (t) {
      var wrap = document.createElement('span');
      var text = t.nodeValue;
      wrap.className = 'typing';
      for (var k = 0; k < text.length; k++) {
        var c = document.createElement('span');
        c.textContent = text[k];
        c.style.animationDelay = Math.round(i * step) + 'ms';
        wrap.appendChild(c);
        i++;
      }
      t.parentNode.replaceChild(wrap, t);
      typing.push({ node: t, wrap: wrap });
    });
    typingTimer = setTimeout(finishTyping, TYPE_MS + 260);
  }

  function setLang(next) {
    if (next !== 'tr' && next !== 'en') return;
    try { localStorage.setItem(STORAGE_KEY, next); } catch (e) {}
    if (next === lang) return;
    // Put any running re-type back first: apply() writes into text nodes.
    finishTyping();
    lang = next;
    markRoot();
    apply(document);
    for (var i = 0; i < listeners.length; i++) listeners[i](lang);
    typeIn();
  }

  markRoot();
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest && ev.target.closest('[data-set-lang]');
      if (btn) setLang(btn.getAttribute('data-set-lang'));
    });
  }

  SM.I18N = {
    STRINGS: STRINGS,
    ATTRS: ATTRS,
    t: t,
    apply: apply,
    setLang: setLang,
    lang: function () { return lang; },
    onChange: function (fn) { listeners.push(fn); }
  };
})(window.SM = window.SM || {});
