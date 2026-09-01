# StilizedMaps

Prosedürel, stilize harita üreteci. Dağ / ova / deniz / orman / çöl / tundra
biyomları noise'dan türetilir; harita hem **üstten** hem **izometrik voxel**
görünümüyle çizilir. Üretimden önce kurallarla ayarlanır, üretimden sonra
fırçayla düzenlenir. İzometrik görünümde animasyon (akan nehir, uçan kuşlar).

Vanilla HTML + CSS + JS. Framework yok, build adımı yok. Harita yüzeyi tek
`<canvas>` üzerinde çizilir; paneller normal DOM.

## Çalıştırma

`index.html` dosyasını tarayıcıda aç (çift tıkla). Yerel sunucu gerekmez.

## Mimari

Tek doğru kaynak: **grid veri modeli** (`src/grid.js`). Her hücre `elevation`,
`moisture`, `temperature`, `biome`, `water`, `level` taşır. Her iki görünüm de
bu aynı modelin projeksiyonudur — ayrı harita değil.

Üretim hattı (`src/generate.js`) adlandırılmış pass'ler — tamamen rastgele
değil, kurallı:

1. **sample** — dünya-uzayı fBm + domain warp → ham yükseklik. Dünya-uzayı
   sampling: özellikler sabit boyutta kalır, harita büyüyünce kenardan yeni
   dünya açılır (ada aynı, okyanus büyür).
2. **shape** — ridged dağ karışımı, radyal ada falloff, sabit kontrast eğrisi
3. **repair** — tek-tile diken/çukur klamp (erozyon), hafif yumuşatma → kule yok
4. **sea level** — sabit referanstan mutlak eşik (boyuttan bağımsız kıyı)
5. **climate** — moisture + temperature (enlem bandı + noise + rakım)
6. **classify** — biyom, eğim tabanlı kıyı (yalıyar/kumsal), de-speckle,
   göl flood-fill
7. **hydrology** — kıyıdan uzaklıkla düzgün su derinliği, yokuş-aşağı nehirler
8. **voxelize** — işaretli ayrık kademeler (kara +, su −), kule klamp

## Milestone'lar

- [x] **M1 — Üretim + üstten görünüm.** Grid modeli, noise, biyom ataması,
  Canvas top-down render, parametre paneli, yeniden üret.
- [x] **M2 — İzometrik voxel projeksiyon.** `src/render/iso.js` — her tile bir
  prizma sütunu (üst diamond + 2 yan yüz, yan yüzler sadece komşuya kadar),
  painter's algorithm, işaretli yükseklik kademeleri (kara yukarı, su aşağı —
  deniz baseni). Harita tam çözünürlükte `#map`'e çizilir; kamera bir CSS
  transform (pan/zoom = sıfır redraw). Üstten VE izometrikte sürükle-pan +
  tekerlek-zoom. "Yükseklik abartısı" slider'ı. 18 biyom, eğim tabanlı
  yalıyar, biyom-içi renk varyasyonu. Boyut 128–176² (piksel sabit).
- [ ] **M3 — Düzenleme.** Fırça araçları: biyom boya, terrain yükselt/alçalt,
  nehir çiz. Kısmi yeniden hesap.
- [ ] **M4 — Animasyon.** Nehir dalgası (voxel yüksekliği sinüs), uçan kuşlar.
  Sonra: gündüz/gece, bulut gölgesi, kamera döndürme.

## Bağlam

Bilaxten technical artist portfolyosunun parçası. Yazımı: her milestone bir
breakdown notu (`docs/DEVLOG.md`) → sonra bilaxten.art'ta vaka çalışması +
WebGL/Canvas gömülü demo.
