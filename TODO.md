# TODO.md

Operasyonel iş kuyruğu. **Kısa tut.** Biten madde silinir — tamamlanmış iş git
geçmişinde ve `docs/DEVLOG.md`'de yaşar, burada birikmez.

Tasarım/mimari gerekçe buraya değil `README.md`'ye yazılır.

---

## NOW

- [ ] **Portfolyo yol haritası (2026-09-22, Uğur onayladı, bu sırayla):**
      1. **Canlı demo** — GitHub Pages: `https://bilaxten.github.io/StilizedMaps/`
         (`master` kökünden, build yok).
      2. **Pipeline adım adım modu** — üretimi pass pass izlet (ham noise →
         dağ → deniz eşiği → iklim → biyom → nehir → yatak oyma → voxel).
         Vaka çalışmasının görselleri buradan çıkar.
      3. **Vaka çalışması** — `bilaxten.art` `site` dalında `work/`; demo linki
         + pipeline görselleri + ölçümler (`--manifest`, harness'lar).
      4. **Unity export** — 16-bit heightmap, biyom splatmap, nehir/yerleşim
         JSON; VFX-Portfolyo Unity sahnesine bağlar.
      5. **Debug görünümleri + shader cilası** — AO/normal/yükseklik/biyom/
         gölge/şelale maskesi görünümleri; su köpük bandı, outline, sis.

- [ ] **Tarama 2026-09-22 bulguları (kod doğrulandı, düzeltilmedi):**
      3. P2 vaadi kısmen tutuyor: 128→256'da kara/su %78-96, biyom %41-89.
         Ana sebep kenara değen su kütlesinin büyük haritada "göl" olması
         (seed 11: ~4900 hücre shallow_water→lake).
      5. 09-15'ten açık: #5 paintEditedTiles sapması, #6 bulut mesh'i, #7
         yerleşim tavanı + kozmetik (`tick` ölü iso artığı, çift `shade`).

- [ ] **İlk vaka çalışması — kuyruğun başı.** M1-M4 bitti + P3 (property test +
      ölçüm paketi, 2026-09-08). `bilaxten.art`'a konacak breakdown: üretim
      hattı, coğrafi kurallar (artık `--geo`/`--sweep` property testlerine
      bağlı), WebGL2 voxel geçişi, fırça editleme, gökyüzü + gömülü demo.
      Kod işi değil ama projenin asıl amacı bu (`AGENTS.md` §2).
- [ ] **Ölçüm paketinin görsel yarısı** (Uğur, tarayıcıda): 3 seed × üstten/voxel
      PNG + orbit klip. Talimat: `docs/measurements/README.md`. Sayısal manifest
      hazır (`node tools/headless.js --manifest`).

- [ ] **Fırça cilası (M3 sonrası, küçük):** fırçalar yalnız üstten görünümde
      çalışıyor ama VARSAYILAN açılış voxel — kullanıcı "Top-down" sekmesine
      geçmeden düzenleyemiyor. Paneldeki not (`Brushes work in top-down view`)
      bunu söylüyor ama araç seçilince sekmeye otomatik geçmek ya da voxel'de
      düzenlemeyi açmak daha iyi olur. Karar verilmedi.

## NEXT

- [ ] **README milestone listesi DEVLOG'un gerisinde.** Volkanik koniler, gün
      döngüsü, PNG export, paylaşım linki ve UI makeover DEVLOG'da var, README'nin
      milestone bölümünde yok. `AGENTS.md` §0 gereği README mimarinin tek doğru
      kaynağı — sürüklenme kapatılmalı.

## LATER

- [ ] **Görsel regresyon fikri:** `tools/headless.js` determinism'i yakalıyor ama
      render'ı yakalamıyor. Canvas'ı node-canvas ile PNG'ye basıp referansla
      karşılaştırmak mümkün — ama bu bir **bağımlılık** demek (`AGENTS.md` §2:
      önce sor). Kararı verilmedi, sadece kayıt.
