# TODO.md

Operasyonel iş kuyruğu. **Kısa tut.** Biten madde silinir — tamamlanmış iş git
geçmişinde ve `docs/DEVLOG.md`'de yaşar, burada birikmez.

Tasarım/mimari gerekçe buraya değil `README.md`'ye yazılır.

---

## NOW

- [ ] **Işık yönü ile düşen gölge birbirinin tersi (2026-10-05, kod okunarak ve
      `buildShadowMap` sayısal denemesiyle doğrulandı, tarayıcıda bakılmadı —
      karar Uğur'da).**
      `sunModel` (`main.js`) `dx/dy`'yi "ışığın GELDİĞİ yön" olarak üretir
      (yorumlar: "east -> west", "a bit from the north"). `SM.buildShadowMap`
      bunu öyle kullanır: engeli `s + (dx,dy)·st` yönünde arar, yani gölge
      güneşin tersine düşer. Ama `setSun` (`voxel3d.js`) yatay bileşeni ters
      çevirip shader'a verir (`sun = (-dx, rise, -dy)`; "Iso uses incoming ray
      direction" yorumu eski iso kodunu yanlış okuyor — silinen `iso.js` de
      `+dx` yönünde yürüyordu). Sonuç 14:00'te: Lambert doğu+güney duvarlarını
      aydınlatıyor, düşen gölge de doğu+güneye uzanıyor — aydınlık yüzün dibinde
      gölge. Bulut gölgesi (`cloudShadowUniforms`) Lambert'le aynı tarafta, yani
      arazi gölgesiyle o da ters.
      İki tutarlı çözüm, ikisi de görünümü değiştirir:
      (A) `setSun`'da eksi işaretlerini kaldır (`sun[0] = dx; sun[2] = dy`):
          gölgeler yerinde kalır, aydınlık duvarlar kuzey+batıya geçer —
          varsayılan kamera (yaw 45) gölgede kalan duvarlara bakar, sahne
          koyulaşır. `sunModel` yorumlarıyla uyumlu olan bu.
      (B) `buildShadowMap`'te yürüyüşü `sx - SUN_DX*st`, `sy - SUN_DY*st` yap:
          duvar aydınlatması aynı kalır, gölgeler tepelerin arkasına (kuzey-
          batı) geçer, varsayılan açıdan daha az görünür.
      Hangisi seçilirse *Render debug view → Sun shadow* ile *Lit* yan yana
      kontrol edilmeli; `--mesh`'e "yüksek sütunun gölgesi, Lambert'in
      aydınlattığı yüzün TERS tarafına düşer" kontrolü eklenmeli.

- [ ] **Portfolyo yol haritasından kalanlar (2026-09-22 sırası; 1-5 bitti):**
      - Vaka çalışması (`bilaxten.art`): `[SES]` cümleleri, şelale/gökyüzü
        GIF'i, `site` → `master` kararı — Uğur.
      - Unity export gerçekten içe aktarılıp denenmedi (aşağıdaki not).
      - Shader cilası (su köpük bandı, outline, mesafe sisi) — estetik karar,
        Uğur'la birlikte (paletten çıkma, ton az).

- [ ] **Doldurulan iç denizler büyük düz "beach" ovası oluyor (2026-10-05
      ölçümü, karar Uğur'da — eski tarama #3 ile aynı kök).** 7c, nehirle
      beslenmeyen her kapalı su kütlesini boyutuna bakmadan karaya çevirir ve
      `seaThresh + 0.012`'ye kaldırır; bu `beachThresh`'in altı olduğu için
      hepsi `beach` olur. Varsayılan haritada (1337, 192²) 4329 beach
      hücresinin 2929'u böyle; 90210/448²'de 29030'un 22426'sı. İç deniz boyut
      eşiği (büyük havza göl kalır) ya da doldurulan hücreyi iklimine göre
      sınıflamak iki olası cevap. P2 "ada aynı kalır" sapması (128→256'da
      kara/su %78-96, biyom %41-89; seed 11'de ~4900 hücre shallow_water→lake)
      da buradan.

- [ ] **Ölçüm paketinin görsel yarısı** (Uğur, tarayıcıda): 3 seed × üstten/voxel
      PNG + orbit klip. Talimat: `docs/measurements/README.md`. Sayısal manifest
      hazır (`node tools/headless.js --manifest`). ⚠️ `manifest-2026-09-15.json`
      2026-09-22 deniz/nehir değişikliklerinden önce üretildi; yayımlamadan
      önce yeniden üret.

- [ ] **Fırça cilası (M3 sonrası, küçük):** fırçalar yalnız üstten görünümde
      çalışıyor ama VARSAYILAN açılış voxel. Araç seçilince sekmeye otomatik
      geçmek ya da voxel'de düzenlemeyi açmak daha iyi olur. Karar verilmedi.

## NEXT

- [ ] **Shift+sürükle pan dikeyde imleci izlemiyor (2026-10-05, hesapla
      doğrulandı, düzeltilmedi — his değişir).** `panVector` dikey sürüklemeyi
      `sin(pitch)` ile ÇARPIYOR; zemin düzlemi ekranda `sin(pitch)` kadar
      kısaldığı için BÖLMESİ gerekir. Şimdiki hâliyle arazi imlecin
      `sin²(pitch)` katı kadar kayıyor (pitch 42°'de %45, 10°'de %3). Yama:
      `downX = cos(yaw) / sin(pitch)`, `downZ = sin(yaw) / sin(pitch)`
      (pitch 10°'de alt sınırlı, taşma yok) + `--mesh`'e "pan vektörünü görüş
      tabanına izdüşür, ekran kayması sürüklemeye eşit" kontrolü.

- [ ] **`paintEditedTiles` üstten render'dan sapıyor** (`main.js`): canlı fırça
      boyaması hillshade'i ±0.18'de, `renderTopDown` ±0.4'te kırpıyor; komşu
      hücrelerin hillshade'i ve kıyı tonu da 450 ms sonraki tam render'a kadar
      eski kalıyor. Temiz çözüm: tek hücre boyamayı `topdown.js`'e
      (`SM.paintTopDownTile`) alıp ikisinin de onu çağırması. Tarayıcı
      doğrulaması ister.

- [ ] **`main.js` ölü kod (iso artığı, davranış etkisi yok):** `tick` içindeki
      kullanılmayan `sun`/`seconds`; `startRiverAnim`'deki `content.diamond`,
      `lh`, `d`, `mode`, `moveLast`; `ISO_TILE`, `ISO_BASE_LH`; iki kez
      tanımlı `shade`; `$('sun')` `change` dinleyicisindeki ulaşılamayan
      `view === 'iso'` dalı; paylaşım linkindeki okunmayan `renderer=voxel`.
      `voxel3d.js`: `buildShadowMap` yorumu hâlâ "iso pre-pass" diyor.
      `generate.js` başlığı ve `grid.js` `level` yorumu hâlâ "signed levels /
      water < 0" diyor (deniz 2026-09-22'den beri düz, kademe 0).

- [ ] **README milestone listesi ve DEVLOG gerçeğin gerisinde.** DEVLOG'un son
      milestone kaydı 2026-09-06; 09-08 → 09-23 arası (property testler,
      pipeline modu, Unity export, debug görünümleri, deniz derinliği renkle,
      şelaleler, world type, dark mode) yalnız `CURRENT.md` ve git'te. README
      "Milestone'lar" bölümü M1-M4'te duruyor; bu işler yalnız "Mimari"
      bölümünde anlatılıyor. `AGENTS.md` §2/§6: anlatılmayan iş yarım.

- [ ] **Skill'lerde başka projeden kalan satırlar:** `devlog-entry` var
      olmayan `<!-- NEW-ENTRIES-BELOW -->` işaretini, `PROJECT_STATE.md`'yi,
      ADR klasörünü ve "LÖVE/Lua"yı anıyor; `handoff` `search_graph`'ı. Bu
      depoda karşılıkları yok.

## LATER

- [ ] **Pages önbellek karışması:** GitHub Pages `src/*.js`'i 10 dk
      önbellekliyor; deploy'dan hemen sonra siteyi önceden açmış biri yeni
      `index.html` + eski JS görebilir (2026-09-22'de canlıda görüldü).
      Çözüm: script/link URL'lerine tek bir `?v=` sürümü + `checks.sh`'te
      hepsinin aynı olduğu kontrolü (`checks.sh` §2 dosya-var-mı kontrolü
      sorgu dizgisini ayıklamalı). Sürümü her yayında elle artırmak gerekir;
      trafik düşükken acil değil.

- [ ] **Bulut mesh'i iç yüzleri:** `buildCloudMesh` komşu kutuların arasında
      kalan yüzleri de üretiyor. Görsel hata DEĞİL (iki geçişli çizim gizliyor),
      yalnız fazladan üçgen. Yerleşim sayısı tavanı (`min(12, …)`) da tasarım
      tercihi; ikisi de hata listesinden düştü.

- [ ] **Görsel regresyon fikri:** `tools/headless.js` determinism'i yakalıyor ama
      render'ı yakalamıyor. node-canvas ile PNG karşılaştırma mümkün ama bir
      **bağımlılık** (`AGENTS.md` §2: önce sor). Kararı verilmedi.

## Unity export doğrulaması — açık (2026-09-29 notu, 2026-10-05 güncellendi)

Resmî Unity 6 dokümanı (Terrain > Import Raw) ilk RAW satırının hangi kenara
düştüğünü açıkça yazmıyor. `export.js`'teki "row 0 = güney, Flip Vertically
yok" iddiası **yalnız Unity'de denenerek** doğrulanabilir:

1. Asimetrik bir harita export et (ör. fırçayla yalnız kuzeydoğu köşeye tepe).
2. Unity 6'da Terrain > Import Raw: Depth 16, Byte Order Windows, Flip
   Vertically kapalı; Terrain Width/Length = `map.json` width/height.
3. Tepe terrain'in kuzeydoğusunda (+x, +z) mı? Değilse export yönü düzeltilir.
4. `albedo.png`'yi tek TerrainLayer olarak (Size = terrain boyutu) ver; kıyı
   çizgisi yükseklikle çakışıyor mu bak.

Bilinen sınırlar (kod tarafında ölçüldü, 2026-10-05):
- Karanın ~%1'i (1337/192²: 271 hücre) kıyı de-speckle'ından dolayı deniz
  eşiğinin en çok 0.06 altında; Unity'de su düzlemi bunları ince bir şerit
  olarak basar.
- Nehir ve göller yükseklik haritasında yalnız yatak olarak var; su düzlemi
  onları doldurmaz (`map.json` hücre listesi verir).
- `albedo.png` üstten render'ın aynısı: *Hillshade* açıksa gölgelendirme ve
  3 px'lik yerleşim işaretleri de içinde. "Albedo" adı için ikisini kapalı
  üretmek daha doğru olur — karar verilmedi.
