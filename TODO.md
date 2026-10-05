# TODO.md

Operasyonel iş kuyruğu. **Kısa tut.** Biten madde silinir — tamamlanmış iş git
geçmişinde ve `docs/DEVLOG.md`'de yaşar, burada birikmez.

Tasarım/mimari gerekçe buraya değil `README.md`'ye yazılır.

---

## NOW

- [ ] **TR / EN arayüzüne gözle bak (2026-10-05, `ab8e83b`):** headless'ta
      doğrulandı, gerçek tıklamayla ve telefon genişliğinde denenmedi.
      Emin olunmayan Türkçe terimler (`src/i18n.js`): *Kabartma gölgesi*
      (Hillshade), *Ortam kapatma (AO)*, *Tohum* (Seed), *Kıyı bükümü* (Coast
      warp), *Şekil ölçeği* (Feature scale), *Nehir yatağı düzeltme* (River
      grading), *Kıyı şeridi ve değişmezler* (Riparian & invariants), iso
      ipucundaki *tekerlek: yakınlaş* ve *Q/E: 90°* (kısa tutuldu: daha uzunu
      1280 px'te yaw denetimine çarpıyordu). Her biri sözlükte tek satır.

- [ ] **2026-10-05 gece düzeltmelerine gözle bak (Uğur yokken karar verildi;
      her biri tek commit, `git revert <hash>` yalnız onu geri alır):**
      - `1cd3abb` düşen gölge artık aydınlık yüzün TERS tarafına düşüyor
        (gölge yürüyüşü çevrildi; duvar ışığı ve bulut gölgesi aynı). Diğer
        seçenek: Lambert + bulut gölgesini çevirmek (gölgeler eski yerinde
        kalır, varsayılan kameraya bakan duvarlar kararır).
        **Bak:** Isometric, seed 1337, *Time of day* 08:00 ve 17:00. *Render
        debug view → Sun shadow*: koyu lekeler dağların hangi tarafında?
        Sonra *Lit*: parlak duvarlar o lekelerin TERS tarafında olmalı ve
        bulut gölgesi lekelerle aynı yöne kaymalı. Gölgeler varsayılan açıdan
        fazla gizli kalıyorsa geri al.
      - `8dcc9c6` Shift+sürükle dikey pan artık imleci birebir izliyor
        (varsayılan pitch'te ~2.2 kat hızlı). Diğer seçenek: eski yavaş his.
        **Bak:** Isometric'te bir kıyı noktasını Shift+sürükle ile yukarı-
        aşağı çek; nokta imlecin altında kalmalı. Kamerayı çok yatırınca
        (pitch 10°'ye yakın) pan fazla hızlı geliyorsa geri al.
      - `e9cf0dc` doldurulan iç denizler artık `beach` değil, iklimine göre
        biyom (1337/192²: beach 4329 → 1400). Diğer seçenek: büyük havzayı
        göl bırakmak (2026-09-01'de bilerek kaldırılmıştı).
        **Bak:** Top-down, seed 1337 / 4242 / 90210 (448²): kum rengi yalnız
        kıyı şeridinde mi; iç kısımdaki dümdüz yeşil ovalar (1. kademe) göze
        batıyor mu? Batıyorsa geri al — eski hâli aynı ovaları kum boyuyordu.
      - `9d69dce` Unity `albedo.png` hillshade'siz ve yerleşim işaretsiz.
        Diğer seçenek: ekrandaki render'ın aynısı.
      - `6ee275d` fırça boyaması ile tam render tek boyayıcı kullanıyor.
      Headless Edge'de sayfa iki görünümde de hatasız açıldı ve ekran
      görüntüsüne bakıldı; etkileşim (pan, fırça, export düğmesi) denenmedi.

- [ ] **Portfolyo yol haritasından kalanlar (2026-09-22 sırası; 1-5 bitti):**
      - Vaka çalışması (`bilaxten.art`): `[SES]` cümleleri, şelale/gökyüzü
        GIF'i, `site` → `master` kararı — Uğur.
      - Unity export gerçekten içe aktarılıp denenmedi (aşağıdaki not).
      - Shader cilası (su köpük bandı, outline, mesafe sisi) — estetik karar,
        Uğur'la birlikte (paletten çıkma, ton az).

- [ ] **P2 "ada aynı kalır" kısmen tutuyor (eski tarama #3):** 128→256'da
      kara/su %78-96, biyom %41-89 (2026-09-22 ölçümü; `e9cf0dc` biyom
      oranını değiştirmiş olabilir, yeniden ölçülmedi). Sebep: küçük haritada
      kenara değen su büyük haritada kapalı kalıp göl ya da kara oluyor.

- [ ] **Ölçüm paketi:** `docs/measurements/manifest-*.json` 2026-10-05
      biyom değişikliğinden (`e9cf0dc`) önce üretildi — yayımlamadan önce
      `node tools/headless.js --manifest` ile yeniden üret. Görsel yarısı
      (3 seed × üstten/voxel PNG + orbit klip) Uğur'da:
      `docs/measurements/README.md`.

- [ ] **Fırça cilası (M3 sonrası, küçük):** fırçalar yalnız üstten görünümde
      çalışıyor ama VARSAYILAN açılış voxel. Araç seçilince sekmeye otomatik
      geçmek ya da voxel'de düzenlemeyi açmak daha iyi olur. Karar verilmedi.

## NEXT

- [ ] **Fırça sonrası komşu hücreler** 450 ms'lik tam render'a kadar eski
      hillshade/kıyı tonunda kalıyor (boyanan hücrenin kendisi artık doğru).
      Küçük; istenirse `paintEditedTiles` komşu halkayı da boyar.

- [ ] **Bayat yorumlar (davranış etkisi yok):** `generate.js` başlığı ve
      `grid.js` `level` yorumu hâlâ "signed levels / water < 0" diyor (deniz
      2026-09-22'den beri düz, kademe 0); paylaşım linkindeki `renderer=voxel`
      parametresini hiçbir şey okumuyor.

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
