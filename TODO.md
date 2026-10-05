# TODO.md

Operasyonel iş kuyruğu. **Kısa tut.** Biten madde silinir — tamamlanmış iş git
geçmişinde ve `docs/DEVLOG.md`'de yaşar, burada birikmez.

Tasarım/mimari gerekçe buraya değil `README.md`'ye yazılır.

---

## NOW

- [ ] **2026-10-06 beş harita özelliğine gözle bak** (her biri canlıda,
      her biri `git revert <hash>` ile tek başına geri alınır; sonra
      `bash scripts/publish-site.sh`). Headless Edge'de (SwiftShader) sabit
      karelerle bakıldı; gerçek GPU, telefon, Firefox/Safari ve akarken his
      denenmedi. **Bak:** Isometric, seed 1337 (volkan + nehir), 4242, 90210:
      - `840100e` **Akan nehirler**: yakınlaş, nehir ve basamak havuzlarında
        beyaz benekler yokuş aşağı kayıyor mu, şelale dibinde köpük var mı,
        büyük gölün ortası durgun mu. Benek hareketi kare kare (çeyrek tile
        adımlarla): akıcı isteniyorsa `flow.js` GLSL'indeki yuvarlama kalkar.
        Bakıldı: 1337/4242/90210 gündüz, 90210 gece, şelale yakın çekimi.
      - `f81bb03` **Volkan dumanı**: kraterden küp küp duman, rüzgâr
        çizgileriyle aynı yöne yatıyor mu; *Time of day* 22:00'de alttan
        turuncu. Bakıldı: 1337 gündüz/gece, 4242 (kenara doğru esen rüzgâr).
      - `ebd782e` + `ebf56b9` **Vadi sisi**: *Time of day* 06:00-08:00
        vadilerde soluk sis, 09:30 inceliyor, 14:00 yok, 19:00 hafif, 22:00
        yok (ikisini birlikte geri al). Bakıldı: 1337 07:00
        önce/sonra, 07/09:30/19/22 yakın çekim.
      - `ab243ce` **Şimşek**: *Rain & snow* açık, yağmur bulutunu bekle (12
        sn'de ~%42): bulut parlıyor, zemin aydınlanıyor, yıldırım iniyor.
        Rahatsız edici mi? ⚠️ Gündüz yıldırım saydam bulutun ardında zor
        seçiliyor (karar). Bakıldı: 1337 ilk çakma, gündüz ve gece, 4 kare.
      - `e9efaaf` **Mevsim** (View → *Season*): sonbaharda orman pas/sarı,
        kışta dağlardan inen kar, soğuk göller buz, lav karsız; üstten
        görünümde de. Random/Regenerate mevsime dokunmamalı (CDP ile
        denendi: dokunmuyor). Bakıldı: 1337 yaz/sonbahar/kış genel, donmuş
        göl yakın çekim, üstten kış/sonbahar, TR/EN panel.
      Kararların listesi ve "alternatif" seçenekleri: `CURRENT.md` 2026-10-06.

- [ ] **2026-10-05 bulut tipleri, gezen yağmur bulutu, kenara kadar rüzgâr,
      lav ışığına gözle bak** (`0937cba`, `450a87b`, `da0b8b7`, `6f1c1e2`; her
      biri `git revert` ile tek başına geri alınır). Headless Edge'de
      (SwiftShader) bakıldı. **Bak:** Isometric, seed 1337:
      - Bulutlar: stratus levha, uzun kümülüs, pofuduk top, küçük bulut kümesi
        var mı; bulut örtüsü eskisinden az, yeterli mi? Gölgeler şekle uyuyor mu.
      - Yağmur/kar bulutu yavaşça haritayı geçiyor, yağmur altına göre
        değişiyor (çölde/lavda yağmıyor). ⚠️ Karar: gölge yok.
      - Rüzgâr: çizgi kenardan kayıp çıkana kadar yaşıyor; hiç birden sönmüyor
        (yalnız 229 sn'de kenara varamayanlar 4 sn'de söner).
      - *Time of day* 22:00: yalnız lav ışıyor, halesi atıyor; kulübe yok.

- [ ] **2026-10-05 telefonda gerçek cihazda bak** (`7b76615` ☰ panel,
      `e5c1fc4` telefon düzeni, `bb2caae` dokunmatik). Edge öykünmesi + CDP
      dokunmatikle ölçüldü; gerçek telefon ve iOS Safari denenmedi. **Bak:**
      telefonda aç → harita tam ekran, ☰ sol üstte yarı saydam turuncu;
      tek parmak döndürür, iki parmak kaydırır + yakınlaştırır, sayfa
      büyümez; ☰ → çekmece, yanına dokun ya da geri → kapanır. iPhone'da
      çentik/ev çubuğu boşlukları ve adres çubuğu (100dvh) özellikle.
      Masaüstünde ☰ ile panel kapanıp açılırken harita ortada kalıyor mu.

- [ ] **2026-10-05 sekiz isteğe gözle bak** (her biri tek commit, `git revert
      <hash>` yalnız onu geri alır). Headless Edge'de (SwiftShader) bakıldı;
      gerçek GPU, telefon, Firefox/Safari denenmedi; animasyon yalnız sabit
      karelerle. **Bak:** Isometric, seed 1337:
      - `e8da874` **P** ile performans paneli: sayılar akıyor mu, gerçek
        GPU'da GPU süresi geliyor mu (SwiftShader'da geldi).
      - `127a590` gece ışıkları + bloom: kasaba noktaları `d959a4c` ile,
        kulübeler `0937cba` ile kalktı (Uğur); ışık artık yalnız lavda. Hâlâ bakılacak: 17:00 → 19:00 arası yavaş yanıyor mu. ⚠️ Karar:
        ışıklar yanarken gece renk düzeltmesi CSS'ten shader'a geçiyor (aynı
        formül); ekranda 17:00'de bir sıçrama görürsen söyle.
      - `7265a2a` kıyıda beyaz bloklu köpük çizgisi; nehirlerde bilerek yok.
      - `a2f542a` rüzgâr çizgileri (`b63070b` ile uzunluk/akış/12 Hz
        yenilendi): vadilerden akıyor mu, yoğunluk (64 çizgi) az mı çok mu;
        gece okunuyor mu.
      - `385e9e3` yağmur ve kar (`38aa281` ile artık kendi bulutlarından):
        varsayılan açık ve hafif (en çok 900). Karar: ilk bölge soğuk karaya
        gider, yoksa kar nadir kalıyordu.
      - `ae4e264` varsayılan 320²: ilk açılış ~2 kat yavaş (üretim ~0.4 s,
        GPU ~1.8 kat). Telefon için ağır mı?
      - `d64982c` tema/dil: kayıtsız açılış İngilizce + koyu; dil değişince
        metin yeniden yazılıyor, tema 0.6 sn'de geçiyor. Sitedeki çerçeve
        çizme Cartula'da yok (köşe çerçevesi stili yok).
      - `95c08a5` dalgalar kıyıya doğru halkalar, açık deniz sakin.
      Ağaç sallanması iptal edildi (Uğur), ağaç eklenmedi.

- [ ] **2026-10-05 dört isteğe gözle bak (`b7fd80e`, `8c0c60b`, `527f137`,
      `e456dcf`):** headless'ta CDP girdi olaylarıyla doğrulandı; gerçek
      klavye/fare ve gerçek GPU'da denenmedi. **Bak:** Isometric, seed 1337:
      Boşluk basılı tutup sürükle (el imleci, harita kayar, sayfa kaymaz);
      sonra çipteki ortala düğmesi. Bulutlar akarken birbirinden farklı mı,
      gölgeleri şekillerine uyuyor mu; birkaç seed dene. Türkçe ipucunda
      *boşluk* (Space) kelimesi yerinde mi?

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
      - Unity export gerçekten içe aktarılıp denenmedi (aşağıdaki not; özellik
        2026-10-05'ten beri şimdilik kapalı).
      - Shader cilası (outline, mesafe sisi) — estetik karar, Uğur'la
        birlikte (paletten çıkma, ton az). Kıyı köpüğü 2026-10-05'te geldi
        (`7265a2a`).

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

- [ ] **Mevsim × yağış (2026-10-06, yapılmadı):** kışın kar çizgisi iniyor
      ama yağmur bulutları hâlâ biyoma göre yağmur yağdırıyor (karlı arazide
      yağmur). İstenirse `weather.js` `ground` dokusundaki tür baytı mevsimle
      yeniden yazılır (slider bırakılınca, tek `texSubImage2D`).

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

- [ ] **Yerleşim sayısı tavanı** (`min(12, …)`) tasarım tercihi; hata
      listesinden düştü. (Bulut mesh'inin iç yüzleri 2026-10-05'te kalktı.)

- [ ] **Görsel regresyon fikri:** `tools/headless.js` determinism'i yakalıyor ama
      render'ı yakalamıyor. node-canvas ile PNG karşılaştırma mümkün ama bir
      **bağımlılık** (`AGENTS.md` §2: önce sor). Kararı verilmedi.

## Unity export doğrulaması — açık (2026-09-29 notu, 2026-10-05 güncellendi)

> ⚠️ 2026-10-05: Unity export arayüzde **şimdilik kapalı** (Uğur). Düğme gizli,
> kod + `--export` duruyor; geri açmak `src/main.js` `UNITY_EXPORT_ENABLED = true`.
> Aşağıdaki doğrulama ancak özellik geri açılınca anlamlı.

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
