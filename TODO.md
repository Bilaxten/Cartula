# TODO.md

Operasyonel iş kuyruğu. **Kısa tut.** Biten madde silinir — tamamlanmış iş git
geçmişinde ve `docs/DEVLOG.md`'de yaşar, burada birikmez.

Tasarım/mimari gerekçe buraya değil `README.md`'ye yazılır.

---

## NOW

- [ ] **2026-10-14 kışın kar yağışına gözle bak** (`61c6837`, tek başına
      `git revert` ile geri alınır). Headless Edge'de (SwiftShader) sabit
      karede bakıldı, gerçek GPU ve telefonda değil. **Bak:** Isometric,
      seed 808, *Season* kışa çek ve **bırak** (kar yağışı slider
      bırakılınca değişir, sürüklerken değil): güneydoğudaki yağmur bulutu
      donmuş gölün ve karlı tepelerin üstüne geldiğinde beyaz kare taneler
      düşüyor mu; yazın aynı yerde yağmur. ⚠️ Kararlar: bulut rengi ve
      şimşek bulutun kurulduğu türde kalıyor (kışın yağmur bulutu kar yağdırıp
      çakabilir); deniz donmadığı için kışın denizde yağmur sürüyor; donmuş
      tatlı su da kar alıyor.

- [ ] **2026-10-13 Uğur'un kararlarından sonra gözle bak** (Uğur 7 bekleyen
      kararı canlıda verdi: gölge yönü, iç denizler, Shift-pan kalsın; TR terimleri
      önerildiği gibi; şimşek karar A = bulutun arkasında). Yeni işler, hepsi
      headless'ta (SwiftShader/CDP) doğrulandı, gerçek GPU ve gerçek parmakla değil:
      - `6a3e9db` + `75f4960` + *Cast shadows: stronger* **sert, köşeli, koyu
        güneş gölgesi** (Uğur 2026-10-13 "daha da belirgin": Lit'te gölgede kara
        ×0.34-0.38, duvar ×0.54, su ×0.6; 06:30 hafif ×0.78; bulut gölgesiyle
        çarpılmıyor, koyusu geçerli).
      - `5cba895` **şimşek**: buluttan yere 130 ms iniş, daha parlak çakma, 3 px /
        250 ms sarsıntı (reduced-motion'da yok), bütün bulutlar yarı saydam,
        yağmur/kar bulutu daha gri. ⚠️ Gündüz yıldırım bulut arkasında hâlâ
        zayıf (A'nın bedeli) — yetmezse yağmur bulutu saydamlığı düşer.
      - `02ec2b9` **yosunlu göl**: bataklığa ≤2 tile göl tam, ≤4 hafif yeşil ton.
      - `90ca3d3` + `8dd7e12` **telefon** (Galaxy S25 FE'de bakılacak): iki
        parmak pan/zoom artık ilk parmağın kaymasıyla dönmüyor (8 px eşik,
        300 ms geri alma); alttaki açı çubuğu eşit 44 px düğme, sabit boşluk.
      - `cfd3853` **iki parmak = yalnız zoom** (Uğur 2026-10-14: pan kilidi
        mobilde kötüydü, "iki parmak sadece zoom yapabilsin"): kıstırma başındaki
        orta noktaya sabit, eşiksiz; bir parmak kalkınca hepsi kalkana kadar
        dokunma yok sayılır. Yalnız `node --check` (Uğur: kontrol uzun sürüyor).
      - `a900da8` gölge daha da koyu (kara ×0.35-0.4); bulut gölgesi ile arazi
        gölgesi çarpılmaz, koyu olan geçer (`min`).
      - `5cd6c51` **Edit paneli gizli** (`EDIT_ENABLED = false`).
      - `87c0401` TR terimleri (Seed, Ortam gölgesi, Kıyı kıvrımı, Arazi ölçeği…).

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

- [ ] **Portfolyo yol haritasından kalanlar (2026-09-22 sırası; 1-5 bitti):**
      - Vaka çalışması (`bilaxten.art`): canlı (2026-10-09); yalnız
        SES-TASLAK onayı kaldı — Uğur.
      - Unity export gerçekten içe aktarılıp denenmedi (aşağıdaki not; özellik
        2026-10-05'ten beri şimdilik kapalı).
      - Shader cilası (outline, mesafe sisi) — estetik karar, Uğur'la
        birlikte (paletten çıkma, ton az). Kıyı köpüğü 2026-10-05'te geldi
        (`7265a2a`).

- [x] **P2 "ada aynı kalır" (eski tarama #3) — kapandı 2026-10-18:** repo'nun
      ölçütü (`--geo`: 128²↔192² merkez, kara/su ≥%92, biyom ≥%40) HEAD
      `4ba4aa7`'de yeşil; 5 seed × deniz 0.4: kara/su %92.4-97.4, biyom
      %45.0-88.9. Eski taramanın daha sert ölçümü 128→256 yeniden alındı:
      kara/su %78.0-95.6, biyom %41.2-70.4 (2026-09-22: %78-96 / %41-89) —
      kara/su aynı, biyom üst ucu düştü (`e9cf0dc` + 10-14 sonrası). 256'da
      kenara değen sığ deniz hâlâ kapanıp göl/kara oluyor; bu ölçütün
      dışında, iç deniz boyut eşiği kararı Uğur'da (kod değişmedi).

- [ ] **Ölçüm paketi, görsel yarısı (Uğur):** sayısal manifest 2026-10-14'te
      yeniden üretildi (`manifest-2026-10-14.json`, `1ee9917`). Kalan: 3 seed ×
      üstten/voxel PNG + orbit klip, `docs/measurements/README.md`.

## NEXT

- [ ] **Fırça sonrası komşu hücreler** (özellik 2026-10-13'ten beri gizli) 450 ms'lik tam render'a kadar eski
      hillshade/kıyı tonunda kalıyor (boyanan hücrenin kendisi artık doğru).
      Küçük; istenirse `paintEditedTiles` komşu halkayı da boyar.

- [ ] **DEVLOG'da 2026-09-07 → 2026-10-04 boşluğu** (2026-10-18'de daraltıldı).
      DEVLOG 09-06'dan sonra 10-05'e atlıyor; arada (property testler,
      pipeline modu, Unity export, debug görünümleri, deniz derinliği renkle,
      şelaleler, world type, dark mode) yalnız `CURRENT.md` ve git'te. README
      bu işleri zaten anlatıyor (pipeline, Unity export, world type bölümleri);
      eski "README milestone listesi geride" kaygısı büyük ölçüde kalktı.

- [ ] **Skill'lerde başka projeden kalan satırlar:** `devlog-entry` var
      olmayan `<!-- NEW-ENTRIES-BELOW -->` işaretini, `PROJECT_STATE.md`'yi,
      ADR klasörünü ve "LÖVE/Lua"yı anıyor; `handoff` `search_graph`'ı. Bu
      depoda karşılıkları yok.

## LATER

- [x] **OBSOLETE (2026-10-18): demo GitHub Pages'te değil, Vercel üzerinden
      `bilaxten.art/cartula` (bilaxten.art `publish-site.sh`).** Eski madde:
      **Pages önbellek karışması:** GitHub Pages `src/*.js`'i 10 dk
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
