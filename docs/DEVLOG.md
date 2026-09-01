# DEVLOG

## 2026-09-01 — Proje başlangıcı + M1: üretim + üstten görünüm

**Ne yapıldı:** Repo sıfırdan kuruldu. Vanilla HTML/CSS/JS, framework/build yok.
Grid veri modeli (`elevation`/`moisture`/`temperature`/`biome`/`water`/`level`),
seedable simplex noise (bağımlılıksız), fBm tabanlı yükseklik + nem üretimi,
enlem+rakım tabanlı sıcaklık, 11 biyomluk sınıflandırma tablosu, Canvas 2D
top-down render (eğim tabanlı ucuz hillshade), canlı parametre paneli
(seed/boyut/deniz seviyesi/arazi ölçeği/dağlılık/nem ölçeği/ada falloff).

**Hangi dosyalar değişti:** `index.html`, `css/style.css`, `src/noise.js`,
`src/biome.js`, `src/grid.js`, `src/generate.js`, `src/render/topdown.js`,
`src/main.js`.

**Neden bu yaklaşım:** Render için Canvas 2D seçildi (saf DOM/CSS değil) —
sonraki milestone'daki izometrik voxel çizimi + su/kuş animasyonu bu ölçekte
(96²) DOM'da performans duvarına çarpar. Grid, iki görünümün (üstten/iso) ortak
kaynağı olacak şekilde tasarlandı — ayrı harita değil, aynı verinin projeksiyonu.
Modüller `window.SM` namespace'i altında classic `<script>` ile yükleniyor
(ES module değil) ki proje çift tıkla `index.html` ile açılabilsin, sunucu
gerekmesin.

**Doğrulama:** Tüm JS dosyaları `node --check` ile sözdizimi kontrolünden geçti.
Üretim hattı Node içinde `window`/`document` stub'ıyla headless çalıştırıldı:
96² haritada determinism doğrulandı (aynı seed → aynı elevation dizisi), 11
biyomun tamamı bir örnek haritada üretildi, elevation/moisture aralık dışı
değer kalmadı (bir sınır-hassasiyeti bulgusu clamp ile düzeltildi).

**Açık işler:** M2 (izometrik voxel projeksiyon), M3 (fırça düzenleme), M4
(nehir dalgası + kuş animasyonu).

**Sonraki adım:** M2 — grid'i prizma/voxel olarak iso açıda çizen renderer,
painter's algorithm ile arkadan öne sıralama, statik terrain bake.
