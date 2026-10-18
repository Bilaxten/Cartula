# DEVLOG

<!-- 2026-10-18: aşağıdaki bloklar CURRENT.md'den olduğu gibi taşındı (el-değiştirme biçimindeki oturum anlatıları, 2026-10-14 ve öncesi). Aynı oturumların DEVLOG biçimindeki girdileri bunların altında. -->

## Bu oturum — ilk yükleme: worker + katman katman açılış (2026-10-19)

A32 bulgusu 2'nin çözümü (telefonda ~4,9 sn boş ekran; senkron 320² `regenerate()`).
Uğur: *"tanıtım videosundaki gibi, katman katman güzel animasyonlu oluşsun"*.
Dal `layered-intro`, PR açık; Uğur'un telefonda izleyip onaylaması bekleniyor,
yayınlanmadı.

**Ne değişti.** Sayfa hemen çizilir; ilk harita Web Worker'da üretilir
(`src/gen-worker.js`, classic worker, `importScripts` ile sayfayla aynı dört dosya,
aynı sıra). Worker, `SM.generate`'in zaten var olan kayıt kancasıyla beş pass'i
(ham noise, dağlar, deniz seviyesi, iklim/biyom, nehirler) bitirdikçe yollar, en
sonda bitmiş grid'i transfer eder (`src/genclient.js`; worker yoksa ya da
başlamazsa aynı `SM.generate` ana thread'de, bir kare çizildikten sonra koşar).
`src/intro.js` lansman filmindeki mürekkep süpürmesini oynatır: çizgi (`--accent`,
yeni renk yok) haritayı yukarıdan aşağı süpürür, her süpürme bir pass'i basar
(280 ms + 50 ms bekleme). Sıra: noise → dağlar → deniz → biyom → nehirler →
bitmiş harita; izometrikte (varsayılan) son adım düz harita üstünde voxel
dünyanın 520 ms'lik süpürmesi. Hızlı makinede toplam ~2,4 sn, yavaş cihazda
pass'ler geldikçe basılır. Haritaya dokunma / tuş, `regenerate()` (her
slider/seed değişikliği) ve `prefers-reduced-motion` animasyonu atlar.

**Neden kare çizici ayrı.** Gerçek `renderTopDown` hücre başına iki canvas çağrısı
ve bir stil dizgesi harcıyor; telefonda tek karesi üretimin kendisi kadar
(CPU x4: 1,0 sn). Beş kare, intro'yu üretimden pahalı yapıyordu. `SM.Intro.pixels`
aynı renkleri (palet, deniz rampası, göl tonu, hücre gölgesi, hillshade) tek
geçişte piksele yazar (10-100 ms); yalnız duruşta anlamlı olanı (yerleşim
simgeleri, nehir parıltısı) atlar, bitmiş harita gerçek renderer'la hemen
ardından çizilir. `--intro` bu kare çiziciyi gerçek renderer'a (`renderTopDown`,
`renderStage`) hücre hücre bağlar (8 bit karışım yuvarlaması içinde).

**Doğrulama.** `node tools/headless.js --intro` (checks.sh'e bağlı): worker
betiği sahte worker kapsamında sürülür; grid'in her alanı ve pass kayıtları
ana-thread `SM.generate` çıktısıyla **bayt bayt aynı** (seed 1337 320², seed
20261019 160²), oynatıcı sırası/atla/iptal, kablolama. Gerçek tarayıcıda
(headless Edge) worker grid'i ile ana-thread grid'i FNV özeti aynı (1337 320²,
987654 256²); Worker silinince, `file://`'de, reduced-motion'da, dokunup
atlayınca, süpürme sırasında seed değişince ve izometrik açılışta hatasız.
Süpürmenin görünüşü tuvalde: tarayıcıda gözle bakılması gerekiyor.

**Bilinen sınırlar.** (1) İlk yükleme dışındaki `regenerate()` hâlâ senkron ve
animasyonsuz (slider sürüklemesi, rastgele harita düğmesi). (2) Voxel dünya
(mesh, gölge haritası, shader derlemesi) hâlâ ana thread'de ve süpürmeden önce
bir kez bloklar; bunu parçalara bölmek ayrı iş. (3) Üstten görünümde
süpürmenin bitiminde gerçek render bir kez yerine oturur (simgeler belirir).

## Oturum — seed haritanın tamamı, Kaydır düğmesi (2026-10-19)

Uğur'un gerçek telefondan iki isteği. (1) *"pan düzgün çalışmıyor, buton olarak
yapar mısın"*: iki parmak ortası kaydırması (932ddbc) geri alındı (kar/yosun
değişiklikleri kaldı); yalnız dokunmatik ekranda görünen *Pan* / *Kaydır* düğmesi
geldi. Kapalı: tek parmak görünümün kendi sürüklemesi, iki parmak yalnız zoom.
Açık: tek parmak iki görünümde de kaydırır, kıstırma kapalı. CDP parmaklarıyla
iki yönde de denendi. (2) Seed: önce "aynı seed aynı sonucu versin" diye
anlaşıldı; Uğur düzeltti: *"ayarlar değişince seed de değişecek, seed ayarları
da temsil edecek"*. Karar: seed = rastgele taban + her ayar tek kodda (32 + 54 +
14 bit doğrulama, 5 bitlik harflerle 20 karakter, sürüm karakteri başta), alan
ayar değiştikçe canlı güncellenir, yapıştırılan kod ayarları kontrollere uygular.
Denetim: üretim yolunda `Math.random`/`Date`/`performance` yok, alt seed'ler
`seed ^ sabit`; tek motor riski `Math.sin/cos/pow` (V8/JSC/SpiderMonkey son bitte
ayrışabilir, bir hücrenin kademesini çevirebilir) `SM.dmath` ile değişti
(yalnız `+ - * /` ve `sqrt`; `sin`/`cos` ~1e-14, `pow` ~2e-16 içinde). Bedeli:
bu yüzden eski sayıdan aynı harita birebir çıkmaz; Uğur eski seed'lere ihtiyaç
olmadığını söyledi. `--seed` denetimi 23 kontrol: kod gidiş-dönüş (3003 kod, iki
uç dahil), yazım, geçersiz giriş nedenleri, tek karakter hatası, aynı seed iki
kez / araya başka harita girince / kod üzerinden aynı grid, üretim yolunda
yasaklı çağrı yok, bağlantılar. Tarayıcıda (Edge): alan canlı, yapıştırma
kontrolleri oynatıyor, geçersiz mesaj TR/EN, eski bağlantı açılıyor, Node ve
Edge aynı parmak izi (`4586ca46`). Ölçülmedi: Safari, Firefox.

Düzeltme (aynı gün, Uğur: *"regenerate aynı özelliklerde farklı map yapmasın, aynı seed aynı sonucu versin"*): *Regenerate* (R) artık yeni taban çekmiyor, geçerli kodun haritasını aynen yeniden kuruyor (fırça düzenlemelerini siler); yeni kodu yalnız *Random* veriyor. Edge'de R ve düğme sonrası kod ve canvas pikselleri aynı.

## Önceki oturum — kışın kar yağar, bayat yorumlar, ölçüm manifesti (2026-10-14)

Uğur'un üç isteği (ana oturum üzerinden), push'landı, `checks.sh` temiz,
yayında. Uğur'un aynı gün Mac'ten gelen iki dokunma commit'i (`cfd3853`
iki parmak = yalnız zoom, `cf9932e`) bu commit'lerin altında; dokunma koduna
bu oturumda dokunulmadı.

1. **Kışın kar yağar** (`61c6837`, Uğur: *"kar yağdıralım"*; eski TODO
   *Mevsim × yağış*). `weather.js` `ground` dokusunun tür baytı mevsimi
   izliyor: renderer'ın kendi kar miktarı (`SM.Season.tileAmounts`) ≥ 0.5
   ya da tatlı suyu donmuş yağmur tile'ı kar alıyor. Biyom türü `baseKind`'da
   saklı; `SM.Weather.applySeason` baytları ondan yeniden yazar, katman
   slider **bırakılınca** tek `texSubImage2D` yükler (sürüklerken yalnız
   uniform; `voxel3d.setSeason(value, live)`). Yeni harita kurulurken o anki
   mevsim uygulanıyor. 320²'de ~2 ms (ilk çağrı JIT ile ~34 ms).
   Ölçülen (node, 128², 5 seed): kışın 77 610 yağmur tile'ının 6 574'ü kar
   (6 437 kara, 137 donmuş su); aynı damlalar yazın 288, kışın 979 kez kar.
   `--weather`'a 4 kontrol (renderer kuralıyla birebir, yaz değişmez ve geri
   döner, monoton, bağlantı); mutasyonla kırmızı görüldü (donmuş suyu
   unutmak, harita kurulunca uygulamamak).
   **Headless Edge (SwiftShader) önce/sonra**, seed 808, 320², sabit zaman
   T=388 s, kamera güneydoğudaki yağmur bulutunda (donmuş göl + karlı tepe):
   önce kışın gölün üstünde yağmur çizgileri, sonra beyaz kare taneler (eski
   kar parçacığının aynısı, yeni renk yok); yaz iki sürümde **piksel piksel
   aynı** (0 farklı piksel), kış farkı yalnız bulutun altındaki bölgede.
   Kararlar: bulut rengi/saydamlığı ve şimşek kurulduğu türde kalıyor; deniz
   donmadığı için kışın denizde yağmur; donmuş tatlı su kar alıyor;
   reduced-motion'da yağış davranışı eskisi gibi (yağışın ayrı bir
   reduced-motion kuralı yok, kar parçacığı aynı yoldan çiziliyor).
   **Kapsamadığı:** gerçek GPU, telefon, akarken his (yalnız sabit kare);
   kışa geçerken bulutun "yağmur bulutu" grisi kalması gözle değerlendirilmedi.
2. **Bayat yorumlar** (`811c297`): `generate.js` başlığı/voxelize ve
   `grid.js` `level` artık "deniz düz, kademe 0, derinlik renk" diyor.
   Paylaşım linki `renderer=voxel` yazmıyor (hiçbir şey okumuyordu); eski
   linklerde varsa yok sayılıyor, aynı açılıyor. Ölçüm README'sindeki voxel
   linki de `?seed=<S>&size=192`.
3. **Ölçüm manifesti** (`1ee9917`, `docs/measurements/manifest-2026-10-14.json`):
   `e9cf0dc` sonrası beklenen fark: kumsal payı 192²'de %4-12 → %3-4,
   448²'de %12-15 → %3-4 (iç denizler artık iklime göre). Kara %, ada,
   en büyük ada (±4), kule 0, yerleşim aynı. `genMs` 2-5 kat yüksek (192²
   179-314 ms, 448² 830-944 ms) — arada 14 üretim commit'i var ve eski
   ölçümün makinesi yazılı değil, ayrılmadı. Görsel yarısı (PNG + orbit)
   Uğur'da.

## Önceki oturum — sert, köşeli güneş gölgesi (2026-10-13)

Uğur `afeb6d5`'in gölge **yönünü** onayladı, ama yumuşaklığı istemedi:
"daha belirgin ve köşeli gölgeler, map voxel sonuçta". Yumuşaklığın tek
kaynağı `buildShadowMap`'in kesirli değeriydi (doku zaten NEAREST, UV tile
merkezi): değer occluder'a uzaklıkla soluyor (12 adımda 0'a) ve ışını ne
kadar aştığıyla (`over / 2.2`) ölçekleniyordu → her gölge tile tile gradyan.
Şimdi: hücre ya 255 ya 0; occluder ışının en az **bir tam voxel** üstünde
olmalı (yoksa tek kademelik her teras yamaçta şerit çiziyordu: 08:00'de
kaplama 8.9k yerine 22k tile); yürüyüş sabit 12 adım yerine ışın en yüksek
sütunu geçene kadar (en çok 64) — gölge geometri bitince biter, kare
kesilmez. Koyuluk (`SHADOW_GAIN`, `uSunStrength`) ve palet aynı; yön aynı.
Bulut gölgesi ayrı yol (`SM.Sky.rasterShadow`, LINEAR doku), dokunulmadı.
`--mesh`: iki yeni kontrol (sert/tam güç, tek kademe gölge düşürmez),
önce kırmızı görüldü. Headless Chrome (SwiftShader) önce/sonra: Sun shadow
görünümünde kenarlar tile hizalı ve ikili; Lit'te gölge belirgin ama
08:00/17:00 gücü düşüktü (×0.67 / ×0.74). **Aynı gün ikinci commit (koyuluk):**
gölge artık `SHADOW_DEPTH` 0.5 → gündüz ×0.5 (çarpım, ton korunuyor);
`daylight` 0.30-0.60 arası smoothstep ile alçak güneşte açılıyor (17:00 ×0.55,
06:30 ×0.72 — uzun sabah gölgeleri siyah şerit olmuyor, gece 0, alacakaranlık
çamurlaşmıyor); su derinliğin 0.6'sını alıyor (×0.7, koyu deniz kararmıyor).
Ölçülen (headless, seed 1337): gölgedeki kara aynı karanın ışıktakine göre
08:00 ×0.50-0.59 (vadi sisi kaldırıyor), 17:00 ×0.56. **Üçüncü commit (canlıdan
sonra, Uğur "daha da belirgin"):** `SHADOW_DEPTH` 0.66, `SHADOW_LOW_SUN`
[0.40, 0.56] → 07:00-17:00 kara ×0.34-0.37 (ölçülen ×0.35-0.42 / ×0.37-0.38),
duvar ×0.54, su ×0.6; 06:30/17:30 ×0.78 (06:30 ile 07:00 arası rampa bilerek
dik: güneş neredeyse aynı, gölge boyu çok farklı). Bulut gölgesi ile arazi
gölgesi artık çarpılmıyor, `min()`: ikisi de aynı güneşi kesiyor; çarpım bulut
altındaki gölgeyi ×0.22'ye indiriyordu. Yosunlu göller su yolundan geçiyor
(×0.6), ayrıca bakılmadı. Push ve yayın ana oturumda.

## Bu oturum — beş harita özelliği, her biri canlıda (2026-10-06)

Uğur beş özelliği onayladı ve her birinin ayrı ayrı yayınlanmasına izin verdi
(ana oturum üzerinden). Sırayla, her biri kendi commit'i, push'landı,
`checks.sh` temiz, `publish-site.sh` ile bilaxten.art/cartula'ya çıktı ve
değişen her JS/CSS dosyası canlıda bayt bayt doğrulandı (CR atılarak sha256).
⚠️ `publish-site.sh`'nin kendi canlı kontrolü yalnız `index.html`'e bakıyor:
`index.html` değişmeyen bir yayında (`ebf56b9`) "canlı = …" hemen ok dedi,
oysa `fog.js` canlıda ~15 sn daha eskiydi; JS'i ayrıca kontrol etmek gerek.
**Düzeltildi (2026-10-06):** betik artık uygulamanın 25 dosyasının hepsini canlıyla karşılaştırıyor;
`--check` farklı olanları tek tek yazar (yerel bir JS değişikliğiyle sınandı: `FARK  src/time.js`, çıkış 1).
Özellikler:

1. **Akan nehirler** (`840100e`, `src/render/flow.js`): nehir + basamak
   havuzları + şelale dibi akar; çift fazlı flow map, `RIVER` varyantı,
   akan üst yüzler indeks tamponunun sonunda. `--flow`.
2. **Volkan dumanı** (`f81bb03`, `src/render/smoke.js`): kraterden 18 voxel
   küp, rüzgâr alanıyla bükülüyor, gece alttan lav ışığı. `--smoke`.
3. **Vadi sisi** (`ebd782e`, `src/render/fog.js`): sabah vadilerde, öğleden
   sonra yok, akşam hafif; `FOG` varyantı yalnız sis varken. `--fog`.
   Sonra `ebf56b9`: 22:00-2:30 sissiz (gece görünmüyordu, ~5 ms yiyordu).
4. **Şimşek** (`ab243ce`, `src/render/lightning.js`): yalnız yağmur bulutu,
   dakikada en çok 5, saniyede en çok 2 parlama, bloklu yıldırım. `--lightning`.
5. **Mevsim** (`e9efaaf`, `src/render/season.js`, panelde *Season / Mevsim*):
   sonbahar ormanı, kışın kar çizgisi iner + soğuk tatlı su donar; yalnız
   görünüm, harita ve seed değişmez. `--season`.

Ayrıntı ve gerekçe: `README.md` → Mimari (her özelliğin paragrafı),
`docs/DEVLOG.md` 2026-10-06.

**Kararlar (Uğur değiştirmek isteyebilir) — "X yaptım, alternatif Y":**
- Nehir: akış geometriden, tek seviyeli tatlı su gövdesi başına; basamak
  havuzları (`lake` etiketli) da akıyor — alternatif: yalnız `river` biyomu
  (denedim: 320²'de yalnız ~150 tile, havuz zincirleri durgun kalıyordu).
- Nehir: büyük gölde yalnız giriş/çıkışa 3 tile yakın akıntı, ortası durgun —
  alternatif: göller tamamen durgun.
- Nehir deseni: benek çeyrek tile blok, yol tam bloklara yuvarlanıyor
  (kare kare kayıyor) — alternatif: akıcı kayma (benekler blok kenarında
  ince şeritlere bölünüyordu, gördüm).
- Duman: küp küçülerek dağılıyor, solarak değil — alternatif: alfa ile solma
  (sıralama gerekir, bulutların ön-geçiş hilesi bozulur).
- Duman: her zaman açık (lav varsa), ayrı anahtar yok — alternatif: *Clouds &
  birds* anahtarına bağlamak.
- Sis: tile başına bütün sütun aynı — alternatif: vertex yüksekliğine göre
  (denedim: her kıyı yarında beyaz perde).
- Sis eğrisi: 6-8 tam, 11'de biter, 16:30-19:30 arası 0.3'e çıkar, 22:00'de
  biter, 2:30'dan şafağa yükselir — alternatif: gece boyunca hafif sis
  (görünmüyordu, ~5 ms yiyordu; ilk sürüm `ebd782e` öyleydi).
- Şimşek: yerel ışık + bütün haritaya hafif ışık (arazi shader'ında tek
  uniform) — alternatif: yalnız genel parlama (CSS/grade ile, sıfır shader
  maliyeti ama yönsüz).
- Şimşek: yıldırım bulutun ARKASINDA çiziliyor (saydam bulut onu %42'ye
  kısıyor, gündüz zor görünüyor) — alternatif: bulutun üstüne çizmek
  (sırtların arkasından görünürdü).
- Şimşek: `prefers-reduced-motion`'da ışık parlaması yok, yıldırım var.
- Mevsim: kışın yaprak döken orman çıplak (`bare` tonuna) — alternatif:
  kışın yeşile dönmesi (istenmemişti; çıplak bırakmak benim kararım).
- Mevsim: lav karlanmaz; kar yalnız karada; donmuş suyun dalga ÇUKURU
  sürüyor (yalnız gölge/köpük/akış duruyor).
- Mevsim: üstten görünüm de mevsimi gösteriyor (slider bırakılınca ~150 ms
  yeniden çizim); Unity albedo mevsimsiz.
- (2026-10-14'te yapıldı, `61c6837`: kışın karlı zemine kar yağar.) Mevsim: kış yağışı değiştirmiyor (yağmur bulutu karlı arazide hâlâ
  yağmur yağdırabilir) — yapılmadı.

**Ölçüm (headless Edge, SwiftShader, 1400×900 pencere, seed 1337, 320²,
`render()` + 1 px readPixels, 3×30 kare medyanı; gürültü ±5-10 ms):**
taban `855fd07` ile son hâl (beşi birden) dönüşümlü, 2 tur (gece 3):
- 07:00 (sis açık): ~96 → ~102 ms (+6);
- 14:00 (yaz, sis yok): ~97 → ~100-103 ms (+3-6, gürültü sınırında);
- 22:00 (gece; 22:00-2:30 sissiz): ~112 → ~116 ms (+4);
- 14:00 kış (`season=3`): ~104-111 ms (aynı yapının yazına göre +2-8);
- çizim çağrısı gündüz 12 → 15, gece 13 → 16 (nehir +1, duman +2; çakma
  anında yıldırım +1); üçgen +432 (duman); GPU belleği tahmini +0.9 MB
  (akış 412 KB, mevsim 410 KB, sis 102 KB doku).
- Harita kurma (node, 320², medyan): akış alanı 5-29 ms, sis 11-18, mevsim
  baytları ~7, duman ≤1 → harita başına +25-55 ms (mesh toplamı ~300-330).
- Özellik özellik (her biri bir öncekine karşı): nehir ve duman gürültü
  içinde (±5); sis 07:00'de ~+5; şimşeğin `uFlash` terimi ~+3; mevsim yazın
  0, kışın ilk sürümde +17 → renk vertex'e taşınınca +3-9.

**Kapsamadığı:** gerçek GPU, telefon, Firefox/Safari; animasyon yalnız sabit
karelerle (akışın, dumanın, şimşeğin akarken hissi gözle bakılmadı);
şimşeğin gerçek ekranda rahatsız edip etmediği (oran ve nabız ölçüldü, his
değil); mevsimle yağmur/kar uyumu.

## Önceki oturum — kulübeler kalktı, rüzgâr kenara kadar, bulut tipleri (2026-10-05)

Uğur canlıda baktı: *"hutları beğenmedim kaldıralım. rüzgarlar mapten çıkana
kadar devam etsinler fade out olmasınlar birden. yağış yapan bulutlar da daha
yavaş şekilde hareket edebilir diğer bulutlar gibi. bulutlardaki şekil
varyasyonunu arttıralım ... yükseklik voxel sayısı farklı ... pofuduk ...
küçük küçük birden fazla buluta sahip bulut kümeleri"*. Dört commit, push'landı:

1. **Kulübeler kaldırıldı** (`0937cba`): pass, `src/huts.js`, mesh, üstten
   görünüm, `--huts`, belgeler; pencere ışığı makinesi de (`aTown`, pencere
   varyantı, pencere-sonda index sırası). Gece yalnız lav ışır; bloom kaynağı
   yalnız lav (R miktar, G/B nabız fazörü). Mesh tabanı 124228'e döndü.
2. **Rüzgâr kenara kadar** (`450a87b`): sabit ömür yok. Her çizgi için harita
   başına 6 yol önceden hesaplanır (doğuştan kenara, sonra dümdüz dışarı),
   döngüyle oynatılır; nesil = yol süresi. Kenarı geçen her nokta 1.2 tile
   içinde kaybolur (çizgi kenardan kayıp çıkar). Kenara varamayan yol 1100
   adımda (~229 s) kesilir, son 4 sn'de söner. Kare başına iş 0.25 → 0.03-0.05
   ms; alan + yollar 320²'de ~158 ms (önce ~108).
3. **Bulut tipleri + doku gölge** (`da0b8b7`): stratus (1-2 katman levha),
   kümülüs (düz taban + 4-6 katman kuleler), pofuduk (top), küme (3-7 ayrı
   kabarık); her gökyüzünün ilk dört bulutu dört farklı tip. Gölge artık JS'te
   yarım çözünürlüklü R8 dokuya çiziliyor, shader tek okuma yapıyor (lob
   döngüsü gitti). Bulut üçgeni 320²'de 14-18k → 5-10k.
4. **Hava bulutları geçiyor** (`6f1c1e2`): açık hava bulutları gibi x boyunca
   geçip dönüyor, hızın %40-60'ı; şekli ağır nimbus; yağış her tile'da altına
   göre, harita dışına yağmaz, bulutla birlikte söner.

**Kararlar (Uğur değiştirmek isteyebilir):** durgun rüzgâr yolu sınırı 1100
adım (~229 s) + 4 sn sönme; uzun yaşayan çizgiler (320²'de medyan ~100 s);
hava bulutu hızı %40-60; hava bulutu hâlâ gölge düşürmüyor (doku sayesinde
artık bedava, istenirse tek satır); bulutlar eskisinden küçük ve çeşitli
(kapladıkları alan azaldı); küme kabarıkları ilk üçü üçgende.

**Ölçüm (SwiftShader, 1280×800, seed 1337, 320², önce `3738e04` / sonra,
dönüşümlü 2 tur):** GPU kare süresi gündüz sabit 164/153 → 106/107 ms, gece
sabit 171/170 → 121/121, gündüz dönen 153/155 → 102/103, gece dönen 203/200 →
149/147 (kazancın çoğu gölge döngüsünün dokuya dönmesi). CPU render 0.9 →
0.7 ms. Üçgen 371k → 353k (gece dönen 701k → 682k). Harita kurma (node, 3
seed × 3): üretim ~335 ms aynı, mesh ~310 aynı, rüzgâr alanı + yollar 108 →
158 ms, hava ~15, gökyüzü ~7.

**Kapsamadığı:** gerçek GPU, telefon, Firefox/Safari; rüzgârın kenardan
çıkışının akarken gözle hissi (kare dizisi var); bulut tiplerinin Uğur'un
gözüne uyması. Bu oturumda yayınlanmadı; 2026-10-06'da `840100e` yayınıyla
canlıya çıktı.

## Önceki oturum — kulübeler, lav ışığı, bulutlu yağmur, rüzgâr akışı (2026-10-05)

Uğur kendi PC'sinde yeni özelliklere baktı: *"bu parlamalar ne ve neden
lavlar parlamıyor? yağmur ve kar yarı saydam bulutlardan yağsın. rüzgarı da
hızına göre ... ani dönüşler yapmasın ... animasyon hızını bir tık
arttırabiliriz"*; ardından *"biz ev koymuyoruz ki niye parlamalar var? sabit
bir hut şeklinde ev yapalım ... minecrafttaki witch hut gibi ... voxelleri
bölme"*. Kulübe tasarımı (3×3, 5 kat, kazıklı) ana oturumda kararlaştırıldı,
birebir uygulandı. Altı commit, hepsi push'landı:

1. **Rüzgâr** (`b63070b`): uzunluk = yerel hız × sabit zaman penceresi (hız
   alanı 0.32-1.35, uzunlar kısaların ~3 katı); alan daha geniş yumuşatıldı,
   yol tile başına en çok 14° döner, çizgi iki kez [1 2 1]; kenarda yol durur
   ve söner; saniyede 4.8 yerine 12 güncelleme (zaman 1/12 s'ye kuantize,
   noktalar arası kesirli adım). `--wind` en keskin bükümü ölçer: 14.7°/tile
   (sınır 18; eski kod 1100+).
2. **Kulübeler** (`7bc509d`; aynı gün `0937cba` ile kaldırıldı): `src/huts.js`, pass 8c; ~8000 kara tile başına
   bir, 3-12, en az 24 tile ara, suya yakın tercih, seed'li dönüş. Mesh'e kabuk
   (kulübe başına 160 üçgen), üstten görünümde çatı rengi. Yeni `--huts`.
   Mesh tabanı 124228 → 124708 (arazi aynı).
3. **Gece ışıkları** (`d959a4c`): yerleşim tile'larındaki pencere noktaları
   kalktı; yalnız kulübe pencere voksellerinin dış yüzü yanar. Lav gece
   düzeltmesinden SONRA 1.3× eklenir ve bloom'a girer; bloom kaynağı miktar
   yazar (R pencere, G lav, B/A lav nabız fazörü), kaynak zamandan bağımsız
   kaldığı için kamera durunca önbellek hâlâ çalışır. Gündüz shader'ı aynı
   (yorumlar hariç birebir, karşılaştırıldı).
4. **Yağmur/kar bulutları** (`38aa281`): her bölgeye bir yarı saydam bulut
   (yağmur 0.58, kar 0.48; kar beyazı → kaya grisi karışımı), parçacıklar
   bulutun altından, lobları içinde; bulut x'te yavaşça salınır, yağmur onunla
   gider (zemin seviyesi + ne yağar küçük bir dokudan). `--weather` yeniden.
5. **Hava bulutu gölgesi kaldırıldı** (`e0355b6`): 0.6 güçte gölge
   SwiftShader'da kare başına ~25-30 ms yiyordu.
6. Belgeler (bu commit).

**Kararlar (Uğur değiştirmek isteyebilir):** hava bulutu gölge düşürmez;
hava bulutları haritayı geçmez, ±%25 yarıçap salınır (kar bulutu çöle
gitmesin); kulübe yaşanabilir biyomları: çayır, ova, çalılık, orman,
bataklık, yağmur ormanı, savan, yerleşim (tayga yok); renkler: kazık/kapı
koyu mesa, tahta mesa, çatı volkanik kaya, cam derin deniz; lav gece 1.3×,
lav bloom 1.8; rüzgâr 12 Hz (tam akıcı değil, "kare kare" görünüm korunsun
diye; varsayılan zoom'da adım ~0.4 px, yakın zoom'da ~2 px).

**Ölçüm (SwiftShader, 1280×800, seed 1337, 320²; gürültü ±10-15 ms):**
GPU kare süresi önce/sonra dönüşümlü: gündüz sabit 156/154, 189/185 ms;
gece sabit 181/192, 190/200 ms; dönen kamera gündüz 185/162, 153/155,
154/155 ms; gece 197/199, 202/205, 203/200 ms. Sayfa içi aç/kapa: *Rain &
snow* açık, kapalıya göre +11-15 ms (önceden +1-11). Çizim çağrısı gündüz
6 → 12 (hava bulutu başına 2), üçgen 362k → 371k.

**Kapsamadığı:** gerçek GPU, gerçek telefon, Firefox/Safari; rüzgârın 12 Hz
akarken gözle hissi (yalnız sayısal: saniyede 11.9 güncelleme; kare
dizisinde çizgiler bu ölçekte zor seçiliyor); kulübenin fırça düzenlemesiyle
etkileşimi yalnız headless (`--huts`: zemini bozulan kulübe çizilmez).
Yayınlanmadı: `publish-site.sh` koşulmadı.

## Önceki oturum — telefon: düzen, dokunmatik zoom, ☰ panel (2026-10-05)

Uğur'un isteği (telefonda canlı siteye baktı): *"cartula mobilde hem kötü
gözüküyor hem de zoom kötü çalışıyor … 3 çizgi şeklinde yan paneli
küçültebilelim. küçültünce 3 çizgi butonu yarı saydam … aynı yerinde boyutu
da sabit kalsın"*; sonradan: kapalıyken ☰ sitenin turuncusu (`--accent`).
Üç commit, hepsi push'landı:

1. **☰ panel** (`7b76615`): tek düğme iki durumda, panelin sol üst köşesinde
   sabit (`position: fixed`). Açıkken başlıkta sıradan ikon düğmesi; kapalıyken
   `--accent` 0.55 opak, hover/odak/dokunuşta 1. Harita zoom/pan'ı onu
   etkilemez; telefonda sayfa iki parmakla büyütülürse `visualViewport` ile
   geri ölçeklenir. İlk durum boyamadan önce (`<html data-panel>`):
   `sm-panel` kayıtlıysa o, yoksa telefonda kapalı, masaüstünde açık. Panel
   kayarken `ResizeObserver` haritanın merkezini ve ekrandaki ölçeğini korur,
   WebGL karesini aynı karede yeniden boyutlayıp çizer. Başlık grid oldu
   (☰ sütunu + slogan alt satırda), yüksekliği eskisiyle aynı (88.75 px).
2. **Telefon düzeni** (`e5c1fc4`): kompakt ekranda
   (`(max-width: 700px), (max-height: 500px)`) harita tam ekran, panel üstüne
   açılan çekmece; karartılmış haritaya dokunmak ya da Esc kapatır. Kontroller
   ≥ 44 px, giriş alanı 16 px yazı, `safe-area`, `100dvh`; yatayda çekmece
   tek parça kayar.
3. **Dokunmatik gezinme** (`bb2caae`): tek parmak = fare sürüklemesi; iki
   parmak = kaydır + parmakların ortasına yakınlaş (`src/touch.js`); parmak
   ekleme/kaldırmada sıçrama yok; `#stage` `touch-action: none` (panelde
   sayfa zoom'u açık kaldı).

**Ölçüm (önce):** 390×844 telefonda harita 78 px (360×740'ta 48 px), panel
312 px; açı çipi 36 px'e ezilip sağdan taşıyordu; görünür 20-22 kontrol
44 px altı. Dokunmatik (CDP, 844×390 yatay): tek parmak sürükleme hiçbir şey
yapmadı (yaw 035° kaldı), haritada kıstırma bütün sayfayı ×1.94 (iso) /
×5 (üstten) büyüttü, kamera hiç değişmedi.
**Ölçüm (sonra):** üç telefon boyutunda harita tam genişlik, yatay taşma yok,
görünür 44 px altı kontrol 0; telefon kapalı başlıyor, masaüstü açık.
CDP dokunmatik: kıstırmada parmak altındaki dünya noktası 1e-5 içinde sabit
(iso ve üstten), iki parmak kaydırma tam piksel, ikinci parmak inince / ilk
kalkınca kamera aynı, kalan parmak kaydırıyor (döndürmüyor), sayfa ölçeği
hep 1, ☰ hep (12,12) 44 px; sayfa ölçeği 2.5'e zorlanınca da ☰ ekranda
aynı. Çip slider'ı dokunarak çalışıyor; üstten görünümde dokunuş tile
kartını gösteriyor; kıstırmaya dönüşen fırça darbesi geri alınıyor.
Masaüstü 1376×808: başlık dışında piksel farkı yok (üstten görünüm sahnesi
0 piksel; iso'daki fark dalga fazı, eski sürüm kendisiyle de aynı farkı
veriyor). `--layout` yeni harness: panel, kompakt düzen, dokunmatik
matematiği (200 rastgele hareket, bağımsız ortografik izdüşüm); her kontrol
bilerek bozulup kırmızı görüldü.

**Uğur'a sorulacak kararlar (yaptım — öyle mi kalsın?):**
- Telefon eşiği genişlik ≤ 700 px **ya da** yükseklik ≤ 500 px; yani alçak
  bir masaüstü penceresi de çekmece düzenine geçer.
- Kapalı ☰ masaüstünde 34 px, telefonda 44 px; konumu panelin sol üst köşesi.
- Kıstırmadan bir parmak kalkınca kalan parmak **kaydırır** (döndürmez).
- Telefonda çekmece açıkken haritanın yanı hafif karartılıyor (mevcut
  `--card-shadow` tonu, yeni renk yok).
- Esc yalnız telefonda paneli kapatır; masaüstündeki sabit panel açılır
  pencere sayılmadı.

**Kapsamadığı:** gerçek telefon (yalnız Edge cihaz öykünmesi + CDP dokunmatik
olayları), iOS Safari (`gesturestart`, `touch-action`, `visualViewport`,
`100dvh` davranışı orada denenmedi), görsel viewport'un zoom'lu **kaydırılması**
(ölçek telafisi ölçüldü, ofset kısmı CDP ile üretilemedi), gerçek GPU'da panel
kayarken kare akıcılığı (SwiftShader'da kareler ~0.4 sn). Bir koşuda sayfa
başlangıçta bir kez `$(SLIDERS[id].label)` null hatası verdi; aynı sıra 3+
kez tekrarlandı, yeniden üretilemedi — gözünüz olsun. Yayınlanmadı:
`publish-site.sh` koşulmadı.

## Önceki oturum — ölçüm paneli + yedi görsel iş (2026-10-05)

Uğur'un onayladığı liste (2026-10-05), her biri tek commit, hepsi
push'landı. Sıra bilinçli: önce ölçüm aracı, her sonraki işin bedeli onunla.

1. **Performans paneli** (`e8da874`): *P* / View. Kare aralığı (ort. + en
   kötü, 120 kare), FPS, CPU, GPU zamanlayıcısı varsa GPU süresi, çizim
   çağrısı, üçgen, GPU belleği tahmini. Sayım kaynakta (`src/perf.js`);
   `--perf` sayaçsız çizim/ayırmayı kırmızı yapar.
2. **Gece ışıkları + bloom** (`127a590`): yalnız `town` vokselleri;
   17-19 yanar, 5-7 söner. Bloom 1/4 çözünürlükte, kamera durunca önbellekte,
   gündüz hiç çalışmaz, FBO eksikse kendini kapatır. ⚠️ Işıklar yanarken gece
   renk düzeltmesi shader'da (CSS örtüsü ışıkları griye boyuyordu); gündüz
   CSS. Arazi shader'ı 3 varyant + yerleşim üçgenleri ayrı aralıkta
   (SwiftShader ölü dalı da çalıştırıyor).
3. **Kıyı köpüğü** (`7265a2a`): deniz/göl üstünde karaya değen köşeler,
   bloklu, dalga değeriyle genişleyip daralır; nehirde yok.
4. **Rüzgâr çizgileri** (`a2f542a`): ağaç sallanmasının yerine (Uğur iptal
   etti; ağaç da eklenmedi). Araziyi izleyen akış alanı, 64 durumsuz çizgi.
5. **Yağmur ve kar** (`385e9e3`): seed'li 2-3 bölge, biyom kuralı, ≤900
   parçacık, statik buffer, düşüş shader'da.
6. **Varsayılan 320²** (`ae4e264`): link `size` kazanır, Random dokunmaz.
7. **Tema ve dil bilaxten.art gibi** (`d64982c`): kayıtsız İngilizce + koyu;
   `bx-theme` önce, iki anahtar birlikte yazılır; tema 0.6 sn geçiş, sahne
   katmanları ve WebGL temizleme rengi de; dil değişince metin yeniden yazılır.
8. **Dalgalar araziye uyar** (`95c08a5`): karaya uzaklık alanı, kıyıya doğru
   halkalar, kıyıda sönüm, açık deniz sakin; değerler grid köşesinde.

**Doğrulama:** her commit'te `bash scripts/checks.sh` → `SONUÇ: temiz`.
Yeni harness'ler `--perf`, `--night`, `--wind`, `--weather`; `--mesh`'e köpük
ve dalga kontrolleri, `--i18n`'e tema/dil varsayılanları, `--shaders` artık
`post.js`, `wind.js`, `weather.js`'i de okur. Her yeni kontrol önce bilerek
bozulup kırmızı görüldü. Baseline değişmedi (üçgen tabanı 124228 aynı).
Headless Edge (SwiftShader, CDP): önce/sonra, gündüz/gece ekran
görüntüleri; kare süresi aynı sayfada dönüşümlü A/B ile. Ölçümler
SwiftShader'da (gerçek GPU değil): gündüz ve gece hareketsiz kamerada
efekt katmanları +2-3 ms (~90-100 ms'lik karede), hareketli kamerada gece
+19 ms (bloom kaynağı her kare yeniden), 320² 192²'nin ~1.8 katı GPU.

**Kapsamadığı:** gerçek GPU, telefon, Firefox/Safari, gerçek klavye/fare
(CDP girdisi kullanıldı), animasyonun akarken gözle hissi (sabit kareler).
Yayınlanmadı: `publish-site.sh` koşulmadı.

## Önceki oturum — Unity kapalı, Boşluk+sürükle, ortala düğmesi, çeşitli bulutlar (2026-10-05)

Uğur'un dört isteği (2026-10-05), her biri tek commit:

1. **Unity export şimdilik kapalı** (`b7fd80e`): düğme satırı `index.html`'de
   duruyor ama `hidden`; `main.js` onu yalnız `UNITY_EXPORT_ENABLED = true`
   iken gösterip bağlar (bugün `false`). `src/export.js`, `exportUnity()` ve
   `--export` dokunulmadı. `--export`'a yeni kontrol: gizli satır + bayrağa
   bağlı bağlama hâlâ yerinde (satırın `hidden`'ı bayrak kapalıyken
   kaldırılınca kırmızı görüldü). README/AGENTS/TODO "şimdilik kapalı" diyor.
   Neden kapalı: Uğur'un isteği; gerekçesini söylemedi (ayrıca Unity'de hiç
   denenmemişti — bu bir gözlem, onun gerekçesi diye yazılmadı).
2. **Boşluk+sürükle = kaydır** (`8c0c60b`): iki görünümde, üstten görünümde
   fırça seçiliyken bile. Boşluk basılıyken imleç grab/grabbing
   (`#stage.space-pan`), fırça imleci gizli. Metin/sayı alanı ve select
   dışında Boşluk yutulur: keydown + keyup `preventDefault` (sayfa/panel
   kaymaz, odaktaki düğme/kutucuk/summary basılmaz); pencere `blur` modu
   bırakır. Shift+sürükle aynen. İpuçları iki dilde güncellendi.
3. **Ortala düğmesi** (`527f137`): açı çipinde slider'ın solunda, yalnız
   ikon; `renderer.fitCamera` (yeni haritanın aldığı kadraj) ile pan + zoom
   sıfırlanır, yaw ve pitch korunur. Çip 260 → 292 px; iso ipucu çipe
   varmadan yalnız `·`'da kırılıyor (`\u00a0`'lı parçalar).
4. **Bulutlar çeşitli** (`e456dcf`): gökyüzü haritanın seed'inden
   (`mesh.seed`; eskiden her haritada sabit 1337). 4-6 bulut, boyut ve
   yükseklik tabakalı; her bulut 1-3 lob, 1-2.1 kat uzun, 1-3 katman. Gölge
   lob başına elips (`uCloudLobes[18]`) — şekil gövdeyle aynı. Mesh yalnız
   dış kabuk: 192²'de 16 668 → ~5 500 üçgen. Solma bulutun kendi erimine
   indi (uzun bulutlar harita yanında gri hayalet bırakıyordu).

**Doğrulama:** her commit'te `bash scripts/checks.sh` → `SONUÇ: temiz`
(baseline değişmedi; `--mesh` üçgen tabanı aynı, bulut üçgeni ayrı).
`--sky` yeni kontroller 8 seed'de yeşil. Headless Edge (CDP, SwiftShader,
`?seed=1337`, gerçek `Input.dispatchKeyEvent`/`dispatchMouseEvent`):
Unity düğmesi görünmüyor; Boşluk+sürükle iso'da hedefi kaydırıyor
(yaw/pitch/zoom sabit), üstten görünümde Raise seçiliyken haritayı tam
sürükleme kadar taşıyor ve boyamıyor; düz sürükle hâlâ döndürüyor/boyuyor,
Shift+sürükle hâlâ kaydırıyor; odaktaki Yeniden üret / kutucuk / summary
Boşlukla basılmıyor, panel kaymıyor, seed alanı ve select'te Boşluk pan
modunu açmıyor. Ortala: pan + zoom + orbit sonrası tık → hedef ve zoom ilk
kadrajla birebir, yaw/pitch aynı (EN 1400, TR 1280). Bulut: eski/yeni
ekran görüntüsü (iso + tepeden), gölge-maskesi (gökyüzü kapalı taban ile
fark) gövde çizgisini izliyor. SwiftShader'da kare süresi gürültü içinde
(gökyüzü açık eski 71-84 ms, yeni 78-93 ms; kapalı aynı).

**Kapsamadığı:** gerçek GPU (yalnız SwiftShader), gerçek klavye/fare
(CDP girdi olayları tarayıcının girdi hattından geçiyor ama fiziksel değil),
bulutların akarken gözle hissi (sabit kareler), telefon genişliği,
Firefox/Safari, Türkçe ipucundaki *boşluk* kelimesi (TODO). Yayınlanmadı:
`publish-site.sh` koşulmadı.

## Önceki oturum — su dalgasında kara şeritler + daha okunur dalga (2026-10-05)

Uğur'un raporu (ekran görüntüsüyle): iso görünümde su, kara sütununa
(yalıyar) değdiği yerde dalgayla inip çıkıyor; inince aradaki boşluk siyah.
İstediği: boşluk üstündeki bloğun rengiyle dolsun; dalga biraz daha görünsün.

1. **Kök neden + düzeltme** (`073cf21`): yüzey dinlenme kademesi etrafında
   ±0.036 oynuyordu, komşu her yüz ise tam o kademede bitiyordu. Çukurda
   sütunun içi boş kalan yarık açılıyor, arka plan rengi siyah şerit olarak
   görünüyordu — yalıyar dibinde, plinth halkasında ve kıyı ağırlığı farklı
   iki su tile'ı arasında (tile başına kıyı sönümü ortak kenarı farklı
   oynatıyordu). Şimdi: yüzey yalnız **iner** (tepe = dinlenme kademesi,
   çukur = `SM.VOXEL_WAVE_DIP`), sönüm yok (tek sürekli dalga, ortak kenarlar
   birlikte hareket eder); suya bakan her duvar çukurun altına kadar iner
   (**etek**, komşunun kendi yan rengiyle); suyla aynı kademedeki kara ve
   kenardaki su yanındaki halka kendi eteğini alır; su tile'ının kendi
   duvarlarının üst kenarı yüzeyle birlikte iner.
2. **Daha okunur dalga** (`92c546f`): çukur 0.072 → 0.15 kademe; her su
   üst yüzü tile merkezindeki dalgadan tek bir parlaklık alır (±%7) —
   tepe tile'lar açılır, çukurdakiler koyulaşır, dalga bütün tile'lardan
   sakin basamaklı bantlar olarak ilerler. Maliyet: vertex başına bir `sin`,
   bir vertex-only uniform (`uGridSize`).

**Doğrulama:** `bash scripts/checks.sh` → `SONUÇ: temiz`. `--mesh`'e yeni
kontrol: her su kenarı çukura kadar kapalı (eski renderer'da kırmızı: 3842
delik, 398 çıplak kenar); su bayrağı kontrolü duvar üst kenarına izin
veriyor; üçgen tabanı 123314 → 124228 (bilerek, etek quad'ları). `--falls`:
şelale yüzü inişin `WAVE_DIP` altında bitiyor. Headless Edge (SwiftShader
WebGL2, CDP, `?seed=1337`, bulutsuz, `setTime` ile sabit anlar): seed 1337
kıyı yalıyarında yakın plan 4 an — arka plan rengi piksel sayısı önce
21-907, sonra 0; orta yakınlıkta tile bantları görünüyor, iki an arası
değişen piksel ~1.8 kat.

**Kapsamadığı:** gerçek GPU (yalnız SwiftShader), dalganın akarken gözle
hissi (yalnız sabit kareler), telefon. Yayınlanmadı: `publish-site.sh`
koşulmadı (ana ajan yayınlayacak).

## Önceki oturum — arayüz Türkçe + İngilizce (2026-10-05)

Uğur'un kararı (2026-10-05): sitede görünen her şey TR + EN, sağ üstte küçük
bir *TR / EN* ile değişir. Uygulama arayüzü yalnız İngilizceydi.

1. **Sözlük + düğme** (`ab8e83b`): `src/i18n.js` (`SM.I18N`, `<head>`'de
   yüklenir) — 158 anahtar, iki dil. `index.html` metinleri `data-i18n*`
   kancalı; main.js'in yazdıkları `T(key)` ile (slider kelimeleri,
   istatistik, ipuçları, aşama metinleri, biyom adları, kopyalama geri
   bildirimi). Panel başlığında TR / EN (sitedeki görünüş, yalnız mevcut
   renkler). Seçim `localStorage` `bx-lang` — bilaxten.art ile ortak.
   Dil değişimi yalnız metni değiştirir; harita, kamera, fırça düzenlemesi,
   adım adım aşaması yerinde kalır.
2. **Kontrol** (`8f41d15`): `node tools/headless.js --i18n`, `checks.sh`'e
   bağlı. Bir dilde eksik anahtar, kancasız görünür metin ya da main.js'te
   DOM'a düz metin kırmızı. Kırmızı görüldü (TR anahtarı silindi + kancasız
   `<p>` ve `title`), sonra yeşil.

**Doğrulama:** `bash scripts/checks.sh` → `SONUÇ: temiz`. Headless Edge
(CDP; `--lang=tr` ve `en-US`; 1440 ve 1280 genişlik; koyu + açık tema):
konsol hatası yok; ilk dil tarayıcı dilinden geliyor, düğmeyle değişiyor,
`bx-lang` yazılıyor, `<html lang>` güncelleniyor; değişimde `SM.generate`
hiç çağrılmadı. Adım adım modunda ve fırça düzenlemesinden sonra
(istatistik "· düzenlendi") dil değişimi denendi; hover kartı TR'de.
Panelin dört kaydırma konumunda TR / EN ekran görüntüsüne bakıldı; büyük
harfli başlıklar Türkçe doğru (DÜNYA, YÜKSELTİ, İKLİM, BİYOMLAR). TR iso
ipucu 1280'de yaw denetimine çarpıyordu, kısaltıldı (7 px boşluk kaldı).

**Kapsamadığı:** gerçek fare/klavye (düğmeler JS `click()` ile
tetiklendi), dar/telefon genişliği, WebGL2'siz yol (`view.noWebgl`), GPU
bağlamı kaybı ipucu, panoya kopyalama başarı metni (headless'ta pano
reddedildi, "Kopyalanamadı" görüldü), Firefox/Safari. Yayınlanmadı:
`scripts/publish-site.sh` koşulmadı (ana ajan gözden geçirip yayınlayacak).

## Önceki oturum — derin kod incelemesi (2026-10-04/05)

Uğur'un istediği: depoyu derinlemesine kontrol et, doğrulanabileni düzelt.
Yeni özellik yok. Dört düzeltme, hepsi `bash scripts/checks.sh` temizken:

1. **`grid.elevation` bayat kalıyordu** (`5383f75`): 7c (iç su temizliği)
   doldurduğu havzayı çalışma kopyasında kaldırıyor ama `grid.elevation`'a
   yazmıyordu. Voxel doğruydu (kademe çalışma kopyasından); üstten hillshade,
   hover rakımı, fırçalar ve Unity yükseklik haritası deniz tabanını
   görüyordu. Varsayılan haritada 2929 hücre (karanın %11'i), 0.43'e kadar.
   Yeni `--geo` P8 (düzeltmeden önce 5 seed'de kırmızı).
2. **Unity yükseklik haritası dokulara göre yarım hücre kaymıştı**
   (`4c2830b`): örnekleme köşeden köşeye hücre merkezlerine gidiyordu;
   artık hücre alanına (`u·W − 0.5`). `--export`'ta yeni hiza kontrolü.
3. **Q/E 315°'den sonra dengesizdi; gökyüzü link hatası sessizdi**
   (`f195513`): `snapYaw` son yarım dilimi 270'e kırpıyordu (testte de öyle
   kilitliydi). Link hatası logu yanlış programdaydı.
4. **`checks.sh` CRLF kontrolü Windows'ta hiç çalışmıyordu**: artık index'ten
   (`git ls-files --eol`) okuyor; bilaxten.art'taki ikiz betikle aynı
   düzeltme. Sahte CRLF blob'uyla tetiklendiği görüldü.

**İkinci tur — Uğur'un gece talimatı: "önerdiğin gibi düzelt, her şey geri
alınabilir olsun, sabah bakacağım".** Görünümü/hissi değiştiren kararlar,
her biri TEK commit (`git revert <hash>` yalnız onu geri alır):

5. ⚠️ **Düşen gölge aydınlık yüzle aynı taraftaydı** (`1cd3abb`): `setSun`
   yatay bileşeni çeviriyor, `buildShadowMap` çevirmiyordu; bulut gölgesi
   de Lambert'le aynı taraftaydı. Gölge yürüyüşü çevrildi (üç sistemden
   yalnız biri değişti). Alternatif: Lambert + bulut gölgesini çevirmek.
6. **Shift+sürükle dikey pan** imleci izliyor (`8dcc9c6`); eskiden
   `sin²(pitch)` kadar yavaştı. Alternatif: eski his.
7. **Doldurulan iç denizler iklimine göre biyom alıyor** (`e9cf0dc`);
   eskiden hepsi düz `beach` ovasıydı (varsayılan haritada beach'in %68'i).
   Alternatif: büyük havzayı göl bırakmak (09-01'de bilerek kaldırılmıştı).
8. **Unity `albedo.png` ışıksız renk** (`9d69dce`): hillshade ve yerleşim
   işaretleri yok. Alternatif: ekrandaki render'ın aynısı.
9. **Tek hücre boyayıcı** (`6ee275d`, `SM.paintTopDownTile`): fırça boyaması
   hillshade'i ±0.18'de kırpan kendi kopyasını taşıyordu.
10. **`main.js` ölü iso artıkları silindi** (`1ec1911`), davranış aynı.

**Doğrulama:** her commit'te `bash scripts/checks.sh` temiz; 5 ve 6 için
önce kırmızı görülen `--mesh` kontrolleri; 8 ve 9 için Node'da sahte
canvas'la çizim çağrısı karşılaştırması (tam render'ın çağrı günlüğü
refactor öncesiyle birebir). Sonunda headless Edge'de `index.html` iki
görünümde de açıldı (konsolda hata yok, WebGL2 çalıştı) ve ekran görüntüsüne
bakıldı: harita düzgün, kumsallar yalnız kıyıda.

**Kapsamadığı:** etkileşim denenmedi (pan, fırça, Q/E, export düğmesi).
Gölgenin yeni yönü ekran görüntüsünde bu ölçekte ayırt edilemedi — *Sun
shadow* debug görünümüyle bakılmalı. Unity içe aktarma hâlâ denenmedi.
`docs/measurements` manifestleri (7)'den önce üretildi, bayat.

**Bilerek bırakılanlar** (`TODO.md`): ~~Pages `?v=` sürümü~~ (Pages yok, obsolete 2026-10-18), DEVLOG'un 09-07…10-04 boşluğu,
skill'lerdeki başka projeden kalan satırlar, Unity doğrulaması.

## Önceki oturum — 3 madde kod taraması düzeltmesi (2026-09-23)

Uğur'un verdiği üç bulgu, hepsi düzeltildi + push'landı:

1. **Satır sonları** (`7c3dad3`): `.gitattributes` (`* text=auto` + binary
   listesi) eklendi, `git add --renormalize .`. Tek CRLF dosyası
   (`scripts/agent-notify.ps1`) LF'e döndü; `git ls-files --eol` artık
   `.nojekyll` dışında hepsi `i/lf`.
2. **World type ayarları test edilmiyordu** (`efe5239`): saf veri +
   eşleştirme `src/worldtypes.js`'e taşındı (`SM.WorldTypes`, DOM'suz),
   `index.html` main.js'ten önce yüklüyor. Yeni harness
   `node tools/headless.js --worldtypes` — slider min/max/step aralığı,
   match round-trip, perturbe edilince 'custom', QS_KEYS kapsaması, 96²'de
   ölçülen biyom etkisi (frozen/arid/tropical vs continents). RED-yeşil
   kanıtlandı: arid'in mbias'ı geçici olarak 0'a çekilince "more desert"
   iddiası kırmızıya düştü (exit 1), değer geri alınca yeşile döndü.
   `scripts/checks.sh` harness döngüsüne eklendi.
3. **Koyu tema swatch kenarlığı** (`52dac9e`): `#legend .sw` / `#hover .sw`
   sabit `rgba(0,0,0,0.12)` kullanıyordu, koyu panelde görünmezdi.
   `--swatch-edge` token'ı (`:root` eski değer, `:root[data-theme="dark"]`
   `rgba(255,255,255,0.14)`).

**Doğrulama:** `bash scripts/checks.sh` → temiz (12 JS, 0 uyarı, tüm
harness'ler dahil `--worldtypes`). Tarayıcıda `scripts/serve.py 8000` +
headless browser: konsol temiz, World type dropdown'da frozen/custom
round-trip'i çalıştı, `--swatch-edge` koyu temada doğru değeri okudu.

Kalan: TODO.md'de bu taramaya ait açık madde yok (ayrı, ad-hoc bir denetimdi).

## Önceki görev — portfolyo yol haritası (2026-09-22, Uğur: "önerdiğin neyse yapalım")

Sıra `TODO.md` NOW'da. Durum:
1. ✅ Canlı demo — https://bilaxten.art/cartula/ (*2026-10-18: GitHub Pages değil;
   Vercel üzerinden bilaxten.art, `publish-site.sh` ile; `.nojekyll` artık işlevsiz*).
2. ✅ Pipeline adım adım modu (`3ddbae6`) — `SM.generate(cfg, record)`,
   `SM.PIPELINE_STAGES` (10 aşama), `SM.renderStage`; `--geo` P6.
3. ✅ Vaka çalışması — `bilaxten.art` `site` dalı `64fbd1c`.
   *2026-10-18: Vaka çalışması canlı (2026-10-09); yalnız SES-TASLAK onayı (Uğur).*
4. ✅ Unity export (`319483a`) — `src/export.js`, `--export`. ⚠️ Unity'de
   gerçekten içe aktarılmadı.
5. ✅ Debug görünümleri (`6bff8ef`). ⏳ Shader cilası Uğur'la.

Aynı gün önce: deniz derinliği renkle (3 bant, paletten — Uğur "bu kadar
ton kullanmayalım" dedi), tarama #1/#2/#4 düzeltmeleri (aşağıdaki bölüm).
Hâlâ açık: #5. Tarama #3 (P2) 2026-10-18'de yeniden ölçüldü, repo ölçütü tutuyor → kapandı (aşağıda).

## Önceki görev — 2026-09-22 taramasının düzeltmeleri

Bulgular `TODO.md` NOW'da. Bu oturumda (2026-09-22):

- ✅ **#1 fırça/tatlı su** (`4d645b2`): `SM.deriveEditedTile` (`grid.js`, saf).
  Tatlı su yükseklik fırçalarında tatlı su kalır; deniz↔kara yalnız fırçanın
  YÖNÜNDE eşik geçilince değişir (eski kod hafif Raise'de sahili su basıyordu —
  TODO'da yazmayan ikinci bug). `--edit` harness'ı eski mantıkta 6/7 kırmızı.
- ✅ **#4 iso Undo/Redo + bfcache + bağlam kaybı** (`8dbe220`). Tarayıcıda
  `buildVoxelMesh` sayacıyla ölçüldü.
- ✅ **#2 generatör yarısı** (`b469ad4`): Uğur **hibrit** seçti — 2 kademe
  basamak oyulur (`gradeRiverBeds`), 3+ şelale (`SM.tagWaterfalls`, geometriyle,
  lip=1 / landing=2). P4 yeniden yazıldı (toleranssız). Tek istisna: göl taşma
  eşiği (göl nehrin 2 üstünde; göller sabit çapa) — 5 haritada 3 kenar.
- ✅ **#2 renderer yarısı** (`dc8db43`): ayrı bir worktree'de yazıldı,
  birleştirildi. `aFall` vertex attribute'u; düşen su yüzü suyun rengi +
  shader'da aşağı akan şeritler; iniş tile'ında köpük (`shore` 0.9). Tarayıcıda
  ilk sürüm çapraz zebra gibi okundu → sütun başına hash'li faz + beyaz su
  tabanı. Ölçüm: 124430 üçgen (fall yüzleri quad eklemiyor), 1337/192²'de 23
  fall quad. ⚠️ Animasyonlu hâli gözle İZLENMEDİ (inceleme için anim
  kapatıldı) — Uğur'un bakacağı: akış hızı/yoğunluğu (`1.6`/`0.9`).
- Yan bulgu: `--mesh` baseline 09-15'ten beri kırmızıydı, checks'e bağlı
  değildi. Artık `--edit/--river/--mesh/--sky` hepsi `checks.sh`'te.

Kalan: TODO #3 (P2 "ada aynı kalır": büyük haritada kapalı kalan deniz → göl;
iç deniz boyut eşiği muhtemelen doğru cevap ama karar Uğur'da). **2026-10-18 yeniden ölçüm:** `--geo` ölçütü (128²↔192², ≥%92 kara/su, ≥%40 biyom) HEAD `4ba4aa7`'de tutuyor — kara/su %92.4-97.4, biyom %45.0-88.9; 128→256'da kara/su %78.0-95.6, biyom %41.2-70.4 (eskisiyle aynı kara/su) → P2 kapandı, 256 artığı bilinen davranış, eşik kararı Uğur'da. #5 (09-15'ten
açık 5-7).

## Önceki görev (2026-09-08)

**Yok — M1-M4 bitti + Gerçeklik Borcu P3 turu yapıldı (2026-09-08).**
Kuyruğun başı hâlâ ilk vaka çalışması (`bilaxten.art`), artık ölçüm paketiyle.

**P3 turu:**
- **Coğrafi property harness'ları:** `node tools/headless.js --geo` (5 seed:
  deniz monotonluğu, kıtasal büyüme örtüşmesi ≥%92, nehir terminali, downhill
  akış, kule=0). `--sweep` artık **assertion + non-zero exit**. İkisi de
  `scripts/checks.sh`'e bağlandı.
- **Bulunan + düzeltilen bug:** seed 11'de 2-tile "nehir hiçliğe akıyor"
  fragmanı → `pruneRiverStubs` pass'i (çıkışa ulaşmayan <4 tile nehir → kara).
- **Görünmez pass'ler:** yol / fantezi etiket / şelale artık `decorations`
  bayrağı arkasında (varsayılan kapalı).
- **Share link + kara %:** link fırça editlerini taşımıyor → "Copied (settings
  only)"; edit sonrası istatistik GERÇEK kara %'sini gösteriyor.
- **Ölçüm paketi:** `docs/measurements/` — `--manifest` (3 seed × 192/448) +
  README (görsel/orbit klip tarayıcıda Uğur).

## M4 bitti (2026-09-06, ikinci tur)

Voxel görünümüne **bulut + bulut gölgesi + uçan kuşlar** geldi; yeni saf katman
`src/render/sky.js`, doğrulaması `node tools/headless.js --sky` (20 kontrol).

- **Bulutlar gerçek geometri.** Eski iso yolunda boyanmış sprite'lardı; artık
  dünya uzayında voxel blokları, yani kamera etraflarında dönüyor.
- **Bulut gölgesini ARAZİ shader'ı çiziyor**, gökyüzü değil. Arazi shader'ının
  dünya konumu yok ama `vCellUV`'si var, o yüzden gölge hücre-UV uzayında ifade
  ediliyor. Güneş alçaldıkça gölge bulutun altından kayıyor.
- ⚠️ **Tek kaynak kuralı:** bulut GÖVDESİ ile bulut GÖLGESİ iki ayrı program
  tarafından çiziliyor. Her biri sürüklenmeyi kendi hesaplasaydı zamanla
  ayrışırlardı — kendi bulutunun altından kayan bir gölge, tek ekran
  görüntüsünde fark edilmeyen türden bir bug. Sürüklenme JS'te BİR KEZ
  hesaplanıp ikisine de uniform olarak veriliyor.
- **Kuşların JS tarafı yok.** Yörünge, yön ve kanat çırpma tamamen vertex
  shader'da, her vertex'in taşıdığı kuş indeksinden türüyor.
- **Kare başına ayırma yok:** `driftClouds` ve `cloudShadowUniforms` çağıranın
  verdiği tampona yazıyor (testle kilitli).

**Yol boyunca üç şey öğrenildi (detay `docs/DEVLOG.md`):**
1. `?cb=N` cache-buster'ı YALNIZ index.html'i tazeliyor; `src/*.js` ayrı URL'ler
   ve Chrome'da cache'te kalıyorlar. Kalıcı çözüm: `scripts/serve.py`
   (`Cache-Control: no-store`). Artık `python -m http.server` KULLANMA.
2. Gökyüzü ilk turda hiç görünmedi çünkü `fitCamera` yalnız araziyi çerçeveliyordu
   ve ortho frustum gökyüzünü tamamen kırpıyordu — GL hatası yok, konsol temiz.
   `SM.Sky.ceiling` artık kameranın bilmesi gereken tek yer.
3. Sonra da görünmedi çünkü `uMode` iki shader'da farklı varsayılan hassasiyetle
   tanımlıydı (`int` → vertex highp, fragment mediump) ve program SESSİZCE
   link olmuyordu. Depoda bunun aynısı `uTime` ile bir kez yaşanmış. Shader
   hataları artık `window.__glShaderErrors`'a da yazılıyor.

## Önceki tur — M3 (2026-09-06)

⚠️ **Bu dosya 2026-09-02'de donmuştu ve YANLIŞ yönlendiriyordu.** "M3 fırça
düzenleme — başlamadı" yazıyordu; fırça aslında `aa3b1cf` ile 2026-09-02'de
inmişti (Codex delegasyonu). Ayrıca 2026-09-03'teki beş commit (WebGL2 voxel
orbit, auto-rotate, Firefox `uTime` düzeltmesi) hiçbir belgede yoktu. İkisi de
bu turda kapatıldı.

**M3 tamamlandı.** Eksik olan tek parça nehir aracıydı; yazıldı.

- **Yedi araç:** Raise / Lower / Smooth, Water / Land, **Draw river**,
  Paint biome. Fırça boyu 1-12, güç 0.1-1, canlı imleç,
  Undo / Redo / Reset to generated. Yalnız üstten görünümde.
- **Nehir tasarımı:** kanal, havuz değil (genişlik 1/3/5/7 hücre — diğer
  fırçaların diski bilerek kullanılmıyor, o zaten `water` aracının işi). Yatak
  banklarının ALTINA oyuluyor, derinliği `strength` belirliyor. Bank referansı
  kanalın DIŞINDAKİ halka — hücrenin kendisi alınsaydı tekrarlı darbeler
  dipsiz hendek kazardı. Yatak `seaThresh`in üstünde kalıyor (altına inseydi
  `deriveTile` hücreyi kıyı sayıp nehir kimliğini silerdi). Lava söndürülüyor.
- **Saf/kirli ayrımı:** planlayıcı `SM.planRiverChannel` + `SM.riverHalfWidth` +
  `SM.riverBedDrop` `src/grid.js`'de, DOM'suz. Uygulama yarısı (undo kaydı,
  water/biome bayrakları, repaint) `main.js`'de.

**Yol boyunca iki gerçek bug bulundu ve düzeltildi:**
1. Geri alma kaydı `lava` alanını tutmuyordu → nehir lavayı söndürünce undo onu
   geri getiremiyordu (geri alınan volkan yüzeyi altında parlamaya devam ederdi).
2. İlk genişlik eğrisi fırça boyu 1-4'ün hepsini tek hücreye eşliyordu — slider'ın
   ilk üçte biri ölü yol, 3 hücrelik genişlik ulaşılamaz. `--river`ın bastığı
   genişlik eğrisinden görüldü.

## Doğrulama (bu turda çalıştırıldı)

- `bash scripts/checks.sh` → temiz (10 JS)
- `node tools/headless.js --river` → **9 kontrol OK** (darlık, monotonluk, tüm
  genişliklerin erişilebilirliği, yatak banklardan aşağıda, deniz seviyesinin
  altına inmiyor, tekrarlı darbelerde yakınsama, determinism, harita kenarı)
- `node tools/headless.js --mesh` ve normal mod → değişmedi (124034 üçgen)
- **Tarayıcı, gözle + ölçerek** (localhost + cache-buster, `?cb=N`): araç
  listede; 21/21 örnek nokta nehir rengine döndü (#3f7fa6); undo tam geri aldı,
  redo birebir geri getirdi; konsol temiz; WebGL2 bağlamı hatasız; çizilen kanal
  voxel görünümünde oyulmuş bir su yolu olarak okunuyor; altbilgi "(edited)".

## 2026-10-14 — Kışın kar yağar

**Ne yapıldı:** Uğur *"kar yağdıralım"* dedi. 2026-10-06'daki mevsim kışın kar
çizgisini indiriyordu ama yağmur bulutları biyoma göre yağmur yağdırmayı
sürdürüyordu: karlı tepeye, donmuş göle yağmur. Artık zemin kışın karlıysa
(ya da tatlı su donmuşsa) yağmur kara döner (`61c6837`). Aynı gün iki küçük
borç kapandı: bayat "işaretli kademe" yorumları ve kimsenin okumadığı
`renderer=voxel` link parametresi (`811c297`); ölçüm manifesti `e9cf0dc`
sonrası yeniden üretildi (`1ee9917`).

**Neden bu yaklaşım:** Yağışın türü zaten tile başına bir dokudan
okunuyordu (seviye + ne yağar); bulut sürüklendikçe her damla altındaki
zemine bakıyor. Kar kararı için ikinci bir kural yazmak yerine renderer'ın
kendi kar miktarı kullanıldı (`SM.Season.tileAmounts`, eşik yumuşak kenarın
ortası, 0.5): ekranda beyaz görünen yer kar alır, sınır birebir. Biyomun türü
ayrı saklanıyor ve dokunun tür baytı ondan yeniden yazılıyor, yani yaza
dönünce harita ilk hâline tam döner. Doku yüklemesi slider bırakılınca, tek
`texSubImage2D` (320²'de ~2 ms); sürüklerken mevsim yine yalnız uniform.
Bulutun rengi ve şimşek kurulduğu türde bırakıldı: bulutlar haritayı
geçiyor, tür zaten damla başına karar veriliyor.

**Doğrulama:** `--weather`'a dört kontrol (beş seed'de renderer kuralıyla
birebir eşleşme, yaz değişmez ve kıştan dönünce geri gelir, 2.5 → 3 monoton,
bağlantı) ve mutasyonla kırmızı. Headless Edge (SwiftShader), seed 808,
sabit zaman, kamera donmuş göl + karlı tepe üstündeki yağmur bulutunda:
önce kışın yağmur çizgileri, sonra beyaz kare taneler; yaz iki sürümde
piksel piksel aynı. `checks.sh` temiz, canlıda her dosya karşılaştırıldı.

**Açık:** gerçek GPU ve telefonda, akarken bakılmadı; kışın "yağmur bulutu"
grisinin kar yağdırırken nasıl durduğu Uğur'un gözüne kaldı.

## 2026-10-06 — Akan nehirler, volkan dumanı, vadi sisi, şimşek, mevsimler

**Ne yapıldı:** Uğur beş özelliği onayladı ve her birinin ayrı yayınına izin
verdi. Sırayla, her biri kendi commit'i ve canlı yayını: akan nehirler
(`840100e`), volkan dumanı (`f81bb03`), vadi sisi (`ebd782e`), şimşek
(`ab243ce`), mevsim slider'ı (`e9efaaf`). Her birinin kendi harness'ı var
(`--flow`, `--smoke`, `--fog`, `--lightning`, `--season`), hepsi
`checks.sh`'e bağlı; yeni kontroller mutasyonla denendi (yönü ters çevir,
denizi sislendir, kar bulutundan çaktır, kenarı kaldır…: kırmızı).

**Neden bu yaklaşım:**

*Nehirler.* İlk sürüm akışı yalnız `river` biyomuna verdi ve haritada neredeyse
hiçbir şey akmadı: 320²'de ~150 nehir tile'ı var, gerisi settle pass'inin `lake`
diye etiketlediği basamak havuzları. Bu haritalarda nehir bir zincir: küçük
havuzlar seviye seviye iniyor, aralarında şelaleler. O yüzden akış etiketten
değil geometriden: tek seviyeli tatlı su gövdesi, çıkışı (alçak su, deniz,
kenar) varsa ona doğru akıyor; havuzdan giriş → çıkış yoluna yakın geçiyor,
göl etiketli tile yalnız giriş/çıkışa yakınsa akıyor (büyük gölün ortası
durgun). Desende iki tuzak gözle görüldü: fragman başına hız deseni
kıvırıp ince şeritlere çekiyordu (akış hızlanınca/dönünce kareler
makaslanıyor), hızı çeyrek tile blok başına bir kez okumak düzeltti; benekler
blok kenarında kesiliyordu, yolu tam bloklara yuvarlamak düzeltti ve hareket
rüzgâr çizgileri gibi "kare kare" oldu. Akan üst yüzler indeks tamponunun
sonuna taşındı ve ayrı varyantla çiziliyor: desenin bedelini başka hiçbir
fragman ödemiyor.

*Duman.* Bulutların dili: eksen hizalı küpler. Küp solarak değil küçülerek
dağılıyor; böylece hepsi tek opaklıkta ve bulutların derinlik-ön-geçişi
(her piksel bir kez karışır) sıralama olmadan çalışıyor. Rüzgâr ikinci bir
model değil: rüzgâr çizgilerinin alanı menfezde örnekleniyor. İlk denemede
duman tek bir yığın gibiydi (büyük küpler üst üste); küçültüp dağıtmak ve
rüzgârla daha fazla yatırmak dumanı okunur yaptı. Kenara yakın volkanda duman
haritanın boşluğuna taşıyordu; kenar ötesinde küçülüyor (rüzgâr ve bulutlar
gibi). Gece ilk sürümde turuncu ışık yalnız alt yüzlerdeydi, yukarıdan bakan
kamera onları görmüyor; yan yüzler de aldı.

*Sis.* İlk sürüm sisi vertex yüksekliğine göre verdi: her duvar tepeden
dibe sislendi ve her kıyı yarının dibinde sissiz denize inen beyaz bir perde
çıktı. Sis tile başına, bütün sütun için tek değer oldu (bloklu, voxel gibi).
Varyant yalnız sis varken; öğleden sonra hiç derlenmiyor bile. Son ölçümde
gece 22:00'de (0.3 sis) kare ~9 ms yavaştı ve sis gece düzeltmesinin altında
görünmüyordu: 22:00-2:30 arası sissiz yapıldı (`ebf56b9`).

*Şimşek.* "Nöbet tetiklemesin" ölçüye çevrildi: dakikada en çok 5 çakma,
çakmalar arası en az 3 sn, hiçbir saniyede ikiden fazla parlama (`--lightning`
30 dk × 4 haritada sayıyor). Durumsuz: çakma zamanın saf fonksiyonu.
`prefers-reduced-motion`'da ışık parlaması yok.

*Mevsim.* Harita verisine dokunmamak şart: grid, biyom, seed aynı kalıyor;
her şey bir tile baytı dokusundan ve bir slider değerinden. Kar çizgisi
üretecin kendi formülünden (`biome.js classify`): kış o çizgiyi indiriyor.
İlk sürüm rengi fragman başına hesapladı ve SwiftShader'da kış kareyi ~17 ms
yavaşlattı; ölçünce ~10 ms'nin fragman karışımlarından geldiği çıktı. Renk
vertex'e taşındı (`vColor`), ek varying gerekmedi, bedel ~3-9 ms'ye indi ve
yazın sıfır. Kraterin karlandığı görüldü: lav karlanmıyor.

**Doğrulama:** her özellik için `bash scripts/checks.sh` temiz,
`publish-site.sh` → canlı = commit, değişen her JS dosyası canlıda sha256 ile
aynı. Headless Edge (SwiftShader) ekran görüntüleri: üç seed, gündüz/gece,
yakın çekimler, önce/sonra; canlı sayfada da (kış sabahı, çakma) shader hatası
yok. Önce/sonra performans dönüşümlü (sayılar `CURRENT.md`).

**Açık:** gerçek GPU ve telefon; akarken his (akış, duman, şimşek yalnız sabit
karelerle görüldü); mevsim ile yağış uyumu (`TODO.md` NEXT; 2026-10-14'te
yapıldı).

## 2026-10-05 — Kulübeler gitti, rüzgâr kenardan çıkar, bulutların tipi var

**Ne yapıldı:** Uğur canlı sürüme baktı: kulübeleri beğenmedi; rüzgâr
çizgileri birden sönmesin, haritadan çıkana kadar yaşasın; yağmur bulutları
da öbürleri gibi (daha yavaş) gezsin; bulutlar daha çeşitli olsun: farklı
yükseklik, pofuduk, küçük bulut kümeleri. Dört commit: kulübeler ve pencere
ışığı kaldırıldı (`0937cba`), rüzgâr kenara kadar (`450a87b`), bulut tipleri
ve doku gölge (`da0b8b7`), hava bulutları geçiyor (`6f1c1e2`).

**Neden bu yaklaşım:** Rüzgârda "durumsuz" kalmak şarttı (ekran görüntüsü
tekrarlanabilsin). Değişken ömürlü nesiller durumsuz hesaplanamaz, çünkü
hangi neslin sürdüğünü bilmek öncekilerin hepsini toplamayı gerektirir. Çözüm
harita başına önceden hesap: her çizgiye 6 yol, her biri doğuştan kenara
kadar; nesil süresi yolun süresi, 6 yol bir döngü. Yan kazanç: kare başına
entegrasyon bitti. Çizgi kenarda "sönmüyor", nokta nokta kenarın ötesinde
kayboluyor; nesil ancak son noktası da gidince bitiyor (`--wind` 300 sn'de
bunu ve başı haritadayken alfanın hiç düşmediğini ölçüyor).

Bulut çeşitliliği lob sayısını artırdı (küme 7 lob). Bir önceki turda 7 fazla
lob gölge döngüsünde ~25-30 ms yemişti; o yüzden gölge önce dokuya taşındı:
JS her bulut hareketinde lobları yarım çözünürlüklü bir dokuya çiziyor, shader
tek okuma yapıyor. Sonuç tersine döndü: gündüz kare SwiftShader'da ~50 ms
hızlandı. Tipler tam voxel: lob artık bir katman tavanı (`top`) taşıyor, yüksek
bir kubbe alçaktan kesilince stratus levhası çıkıyor; kümülüs kuleleri dar
tutuldu ki 4-6 katman yukarıdan bakınca da uzun okunsun.

Hava bulutları gezince altlarındaki biyom değişiyor; zaten tile başına doku
vardı (ne yağar + zemin seviyesi), yani bulutu serbest bırakmak yetti. Ayrıca
harita dışına yağış ve sönen buluttan yağış kapatıldı.

**Doğrulama:** her commit'te `bash scripts/checks.sh` → temiz; `--wind`,
`--sky` (dört tip, doku = analitik elips ≤ 1/255), `--weather` (hız aralığı,
dönüş, sönme), `--night` (yalnız lav) yeni kontrollerle; her biri bilerek
bozulup kırmızı görüldü. Headless Edge: genel görünüm, küme ve kümülüs yakın
çekimi, hava bulutu 8 sn aralıklı dizi, kenardan çıkan çizgi dizisi, gece lav.
Önce/sonra perf dönüşümlü.

**Açık:** gerçek GPU; bulut tiplerinin ve küçülen bulut örtüsünün Uğur'un
gözüne uyması; uzun ömürlü çizgilerin yoğunluk hissi.

## 2026-10-05 — Kulübeler, lavın ışığı, bulutlardan yağan yağmur, akan rüzgâr

**Ne yapıldı:** Uğur yeni özelliklere kendi PC'sinde baktı ve dört şey
istedi, sonra bir beşinci: lav neden parlamıyor; yağmur ve kar yarı saydam
bulutlardan yağsın; rüzgâr hızlıysa uzun, yavaşsa kısa çizgi olsun, ani
dönmesin, animasyonu bir tık sıklaşsın; ve "ev koymuyoruz ki niye
parlamalar var": yerleşim tile'larındaki pencere ışıkları gitsin, yerine
voxellerden yapılmış sabit bir kulübe gelsin, onun penceresi parlasın.
Commit'ler: rüzgâr (`b63070b`), kulübeler (`7bc509d`), gece ışıkları
(`d959a4c`), bulutlu yağmur/kar (`38aa281`), hava bulutu gölgesi kalktı
(`e0355b6`).

**Neden bu yaklaşım:** Rüzgârda "ani dönüş" bir ölçüye çevrildi: çizilen
her çizginin ardışık iki parçası arasındaki açı bölü uzunluk. Eski kodda bu
1100°/tile'ı geçiyordu; çoğu harita kenarında kenar boyunca kayan
çizgilerden ve alanın tek hücrelik kırıklarından. Çözüm üç katman: alan
daha geniş yumuşatıldı, entegrasyon tile başına en çok 14° dönebiliyor
(alan ne yaparsa yapsın) ve çizilen noktalar iki kez yumuşatılıyor; kenarda
yol bitiyor. Uzunluk zaten hıza bağlıydı ama hız alanı dardı (çoğu 0.5-0.7);
şimdi çizgi yolunun sabit bir zaman penceresini kaplıyor ve hız alanı vadi
tabanı, yamaç ve seed'li geniş esinti bölgeleriyle 0.32-1.35 arası. "Bir tık
fazla kare" için baş artık tam adım atlamıyor: zaman 1/12 s'ye kuantize,
çizgi entegrasyon noktaları arasında kesirli kayıyor (4.8 → 12 güncelleme/s),
hâlâ zamanın saf fonksiyonu.

Lav gece aslında ışıyordu ama ışıması gece renk düzeltmesinin İÇİNDE
kalıyordu; düzeltme onu karartıyordu, bloom ise yalnız yerleşimi görüyordu.
Gece varyantında lav ışığı düzeltmeden sonra ekleniyor ve bloom'a giriyor.
Bloom kaynağının kamera durunca yeniden kullanılması korunmak istendi; lav
nabzı zamanla değiştiği için kaynak renk yerine miktar yazıyor: R pencere,
G lav, B/A lav × nabız fazının cos/sin'i. Bulanıklaştırma doğrusal olduğundan
birleştirme sin(wt+φ) = sin wt·cos φ + cos wt·sin φ ile her tile'ın nabzını
bulanık kanallardan geri kuruyor; 8 bit saklamayla hata 0.002.

Kulübe tek bir sabit model (3×3, 5 kat, kazıklı); her parçası bir harita
voxel'i. Yerleşim üretim hattının son pass'i: son kademeler belli olduktan
sonra, düz, kuru, yaşanabilir, suya yakın yerler; seed'li. Mesh'e yalnız dış
kabuk giriyor; pencere voksellerinin dış yüzü ışık bayrağını taşıyor, yani
gece pencere varyantı yalnız 12 üçgen çiziyor.

Yağmur bulutunda asıl soru bulut hareket edince ne olacağıydı. Açık hava
bulutları haritayı geçiyor; bir kar bulutu aynı şeyi yapsa çöle giderdi.
Hava bulutları yerinde, yavaşça salınıyor; parçacıklar buluta göre
konumlanıyor ve altlarındaki zemini ve ne yağacağını küçük bir dokudan
okuyorlar, böylece bulut nereye kayarsa yağmur oradan, doğru zemine düşüyor.
Bulut, gölgesi ve yağmuru tek bir `cloudsAt` çağrısından besleniyor.

**Dikkat çeken:** Hava bulutuna açık bir gölge verildi, sonra sayfa içinde
aç/kapa ile ölçüldü: SwiftShader'da kare başına ~25-30 ms. Sebep arazi
shader'ının bulut lob döngüsü: her fragmanda koşuyor ve lob sayısı ~12'den
~19'a çıkmıştı. Bulut zaten saydam ve altını tonluyor; gölge kaldırıldı.
Ölçümler gürültülü (aynı makinede başka işler de vardı); bu yüzden önce/sonra
sayfaları dönüşümlü ve birden çok tur ölçüldü, maliyet kararları sayfa içi
aç/kapa ile verildi.

**Doğrulama:** her commit'te `bash scripts/checks.sh` → temiz. `--wind`'e
büküm, uzunluk-hız ilişkisi ve güncelleme hızı; yeni `--huts`; `--night`
(bayrak yalnız kulübe pencerelerinde, hiçbir yerleşim tile'ında değil, lav
ışıması yalnız lavda, fazör geri kurma hatası); `--weather` yeniden yazıldı.
Her yeni kontrol bilerek bozulup kırmızı görüldü. Headless Edge (SwiftShader,
CDP, elle adımlanan saat): önce/sonra kare dizileri, gece/gündüz yakın
çekimler, üstten kulübe, telefon düzeni.

**Açık:** gerçek GPU ve telefon; rüzgârın 12 Hz'te gözle hissi; hava
bulutlarının yoğunluğu/opaklığı ve kulübe renkleri Uğur'un gözüne kalmış.

## 2026-10-05 — Telefon: harita önce, iki parmak zoom, ☰ panel

**Ne yapıldı:** Uğur telefonda canlı siteye baktı: kötü görünüyor, zoom
kötü çalışıyor, panel küçülebilsin. Üç commit: ☰ ile küçülen panel
(`7b76615`), telefon düzeni (`e5c1fc4`), dokunmatik gezinme (`bb2caae`).

**Neden bu yaklaşım:** Önce ölçüldü (headless Edge, cihaz öykünmesi, CDP
dokunmatik olayları). Sorun "kötü görünüm" değil yokluktu: hiç telefon
düzeni yoktu, 312 px panel 390 px ekranda haritaya 78 px bırakıyordu; hiç
dokunmatik dinleyici yoktu, iki parmak haritayı değil sayfayı büyütüyordu.
Panel telefonda çekmeceye döndü, harita tam ekran oldu; `#stage`'e
`touch-action: none` verilip pointer olayları bağlandı, ama panelde sayfa
zoom'u erişilebilirlik için bırakıldı. ☰ düğmesi tek eleman ve hep aynı
yerde (`position: fixed`), çünkü "yerinde ve boyutu sabit" istendi; sayfa
zoom'u bile onu büyütmesin diye `visualViewport` ile geri ölçekleniyor.
Kıstırma matematiği DOM'suz bir dosyada (`src/touch.js`): iki parmağın
ortası ve aralığı karelere bölünür, her kare arasında parmak altındaki nokta
parmak altında tutulur. İzometrik kamera ortografik ve `zoom` yarı genişlik;
çözüm mevcut `panVector`'dan geçiyor, doğrulaması ise ondan bağımsız bir
izdüşümle yapılıyor ki ikisinde aynı işaret hatası birbirini örtmesin.

**Dikkat çeken:** Panel kayarken WebGL tuvalinin boyutu her karede
değişiyor; tuvali yeniden boyutlamak onu siler, çizim bir sonraki kareye
kalırsa bir boş kare görünür. Bu yüzden yeniden boyutlama ve çizim
`ResizeObserver` içinde, düzen ile boyama arasında. Masaüstünün aynı
kaldığını göstermek için piksel farkı alındı: başlıktaki ☰ sütunu başlığı
0.25 px kısaltmıştı ve altındaki her şey alt piksele kayıyordu (yalnız
dönmüş ok işareti farklı çıktı); yükseklik 88.75 px'e sabitlendi.
CDP'de bir tuzak: `touchEnd` yalnız listelediği parmağı kaldırır, bir
`touchMove`'dan parmak çıkarmak onu kaldırmaz.

**Doğrulama:** her commit'te `bash scripts/checks.sh` → temiz; yeni
`--layout` harness'i (panel, kompakt düzen, 200 rastgele kıstırma), her
kontrol bilerek bozulup kırmızı görüldü. Önce/sonra ekran görüntüleri ve
CDP dokunmatik kayıtları 390×844, 360×740, 844×390, 1376×808.

**Açık:** gerçek telefon ve iOS Safari; zoom'lu sayfada görsel viewport
kaydırması; gerçek GPU'da kayma akıcılığı.

## 2026-10-05 — Ölç, sonra ekle: performans paneli, gece ışıkları, köpük, rüzgâr, hava, araziye uyan dalga

**Ne yapıldı:** Önce ölçüm aracı, sonra yedi görsel/davranış işi, her biri
tek commit: performans paneli (`e8da874`), yerleşimlerde gece ışıkları +
bloom (`127a590`), kıyı köpüğü (`7265a2a`), araziyi izleyen rüzgâr
çizgileri (`a2f542a`), biyoma göre yağmur ve kar (`385e9e3`), varsayılan
harita 320² (`ae4e264`), bilaxten.art gibi davranan tema ve dil
(`d64982c`), kıyıya doğru halkalanan dalgalar (`95c08a5`). İlk plandaki
ağaç sallanması Uğur'un kararıyla rüzgâr çizgilerine döndü.

**Neden bu yaklaşım:** Panel önce geldi, çünkü sonraki her işin bedeli
onunla söylenecekti. Sayım kaynakta: renderer her çizim ve ayırmayı bir
sayaçtan geçiriyor, harness sayaçsız çağrıyı kırmızı yapıyor; yani yeni bir
geçiş sayılardan sessizce düşemiyor. Gece ışıklarında asıl iş görünür
olmalarıydı: gece rengi CSS ile WebGL'in ÜSTÜNE uygulanıyordu ve her ışığı
gri-kahveye boyuyordu. Düzeltme, aynı formülü ışıklar yanarken shader'a
almak ve ışığı düzeltmeden sonra eklemek oldu; formülün CSS'le aynı olduğu
harness'te, ekranın aynı kaldığı piksel farkıyla (≤4/255) gösterildi.
Bloom'un parlak geçişi bir eşik değil, yalnız yerleşimi yazan bir shader
varyantı: kar ya da güneşli kum yanlışlıkla parlamıyor. Dalgalarda tek
kural ortak kenarları birlikte oynatmaktı; değerler bu yüzden tile'da
değil grid köşesinde.

**Dikkat çeken:** SwiftShader'da gündüz çerçevesi önce ~20 ms yavaşladı ve
sebep hiç çalışmayan gece koduydu. Yazılımsal rasterizer dallanmanın iki
yanını da maskeyle çalıştırıyor; deney kopyalarıyla bölerek bulundu (gece
bloğu ~18 ms, renk düzeltmesi ~4 ms). Çözüm derlenmiş varyantlar ve
yerleşim üçgenlerini index buffer'ın sonunda kendi aralığına almak; sonra
gece de gündüz de eski hızına döndü. Rüzgâr alanında iki hata görüntüyle
yakalandı: normalleştirilmemiş curl noise hâkim rüzgârı boğuyordu, vadi
yönü seçimi rüzgâra dik vadilerde işaret değiştirip çizgileri bir noktada
durduruyordu.

**Doğrulama:** her commit'te `bash scripts/checks.sh` → temiz; yeni
harness'ler `--perf`, `--night`, `--wind`, `--weather`, `--mesh`'e köpük ve
dalga kontrolleri; her biri önce bilerek bozulup kırmızı görüldü. Headless
Edge'de (SwiftShader) önce/sonra ve gece/gündüz ekran görüntüleri, aynı
sayfada dönüşümlü A/B ile kare süresi.

**Açık:** gerçek GPU, telefon, Firefox/Safari; animasyonlar yalnız sabit
karelerle görüldü; bloom bulutların önünde de parlıyor (kaynak geçişi
bulut çizmiyor).

## 2026-10-05 — Unity kapalı, Boşluk+sürükle, ortala, çeşitli bulutlar

**Ne yapıldı:** Uğur'un dört isteği, dört commit. Unity export düğmesi
şimdilik gizli, kod ve testi yerinde (`b7fd80e`). Boşluk basılıyken
sürükleme iki görünümde de kaydırıyor (`8c0c60b`). Açı çipine "ortala"
düğmesi (`527f137`). Bulutlar artık birbirine benzemiyor ve gölgeleri
kendi şekillerinde (`e456dcf`).

**Neden bu yaklaşım:** Unity'yi silmek yerine bayrak: geri gelmesi tek
satır, `--export` bağın kopmadığını da denetliyor. Boşluk için global
dinleyici, ama metin alanı ve select'e dokunmadan; düğmenin tıklaması
keyup'ta tetiklendiği için keydown ile birlikte keyup da engelleniyor.
Ortala yeni bir kadraj hesaplamıyor, yeni haritanın kullandığı
`fitCamera`'yı çağırıyor — gökyüzü dahil, her açıda geçerli olan çerçeve;
açı korunuyor. Bulutlar için en ucuz ama en çok fark yaratan şey
çeşitliliği tesadüfe bırakmamak oldu: boyut ve yükseklik tabakalı
dağıtılıyor, yani her gökyüzü küçük ve büyük bulutu birlikte taşıyor.
Şekil, bulutu 1-3 elipsoit lobun birleşimi yapmaktan geliyor; aynı loblar
gölgeye de veriliyor (lob başına bir elips), böylece gövde ve gölge tek
kaynaktan. Bedeli lob döngüsü (6 yerine en çok 18 adım); buna karşılık
mesh'ten iç yüzler atıldı ve bulut üçgeni üçte bire indi.

**Dikkat çeken:** Eski bulut seed'i her haritada sabit 1337'ydi — "bulutlar
benziyor" kısmen buydu: farklı haritalar aynı gökyüzünü taşıyordu. İkinci
sebep hash'ti: `seed ^ salt` üstüne çıplak LCG, ardışık tuzlar ilişkili
değerler veriyordu. Bulutlar büyüyünce eski solma aralığı (iki yarıçap
öteye) haritanın yanında gri bir hayalet bıraktı; ekran görüntüsünde
görüldü, solma bulutun kendi erimine indirildi.

**Doğrulama:** `checks.sh` temiz; `--sky` yeni kontroller (8 seed: hacim,
şekil, kalınlık, yükseklik çeşitliliği; seed başına farklı gökyüzü; gölge
ve gövde aynı şekil; tavan; iç yüz yok; üçgen bütçesi). Headless Edge'de
CDP girdi olaylarıyla etkileşim ve ekran görüntüleri.

**Açık:** gerçek GPU ve gerçek klavye; bulutların akarken hissi.

## 2026-10-05 — Su dalgası: siyah yarıklar kapandı, dalga okunur oldu

**Ne yapıldı:** Uğur iso görünümde suyun yalıyar dibinde inip çıktığını
ve inerken aradaki boşluğun siyah göründüğünü bildirdi. Kök neden geometri:
yüzey dinlenme kademesi etrafında oynuyor, komşu her yüz o kademede
bitiyordu; çukurda sütunun boş içine yarık açılıyor, arka plan rengi
görünüyordu. Ayrıca tile başına kıyı sönümü iki komşu su tile'ının ortak
kenarını farklı oynatıp aralarında da ince siyah çizgi açıyordu
(`073cf21`). Ardından dalga daha görünür yapıldı (`92c546f`).

**Neden bu yaklaşım:** Üç seçenek vardı: derinlik/temizleme hilesi (yarığı
gizler, nedenini değil), suya her yöne etek, ya da yüzeyi yalnız aşağı
oynatıp suya bakan duvarları çukura kadar uzatmak. Sonuncusu seçildi: tepe
dinlenme kademesi olunca suyun üstündeki hiçbir yüz değişmiyor, yalnız
alttaki duvarlar `WAVE_DIP` kadar uzuyor — yeni quad yalnız suyla aynı
kademedeki kara ve kenar halkası için (457 quad, %0.7). Boşluğu dolduran
renk, Uğur'un istediği gibi üstteki bloğun kendi yan rengi. Sönüm kalktı
çünkü artık gerekmiyor ve ortak kenarı bozan oydu. Dalganın okunurluğu
için tile başına gürültü yerine aynı dalga fonksiyonunun tile merkezindeki
değeri parlaklık oldu: ışık ve yükseklik aynı şeyi söylüyor, titreme yok.

**Doğrulama:** `checks.sh` temiz; `--mesh`'te yeni "çukur yarık açmaz"
kontrolü (eski renderer'da 3842 delik + 398 çıplak kenar ile kırmızı).
Headless Edge (SwiftShader): aynı kamera ve sabit anlarda önce/sonra —
arka plan renkli piksel 21-907 → 0.

**Açık:** gerçek GPU'da ve akan animasyonda gözle bakılmadı.

## 2026-10-05 — Arayüz iki dilli: TR / EN

**Ne yapıldı:** Uğur'un kararı — bilaxten.art'ta görünen her şey Türkçe ve
İngilizce, sağ üstte küçük bir *TR / EN* ile. Cartula'nın paneli yalnız
İngilizceydi. Şimdi tek bir sözlükten (`src/i18n.js`, 158 anahtar) iki
dilde geliyor; panel başlığında sitedekiyle aynı görünüşte TR / EN
(`ab8e83b`). Yeni `--i18n` harness'i (`8f41d15`) iki dili eşit tutuyor.

**Neden bu yaklaşım:** Sitenin kendi sayfaları her metni iki `<span
lang>` ile çift yazıyor; burada bu işlemezdi çünkü metnin yarısı JS'te
kuruluyor (slider değer kelimeleri, istatistik, aşama metinleri, biyom
adları). Bu yüzden anahtar sözlüğü: statik metin `data-i18n*` kancasıyla,
dinamik metin `T(key)` ile. Dil değişince `apply` kancalıları, main.js'in
dinleyicisi kendi yazdıklarını yeniden yazar — yalnız metin; `SM.generate`
çağrılmaz, harita/kamera/fırça geçmişi yerinde kalır (CDP ile sayıldı: 0).
İstatistik satırı eskiden bir İngilizce dizgeyi regex'le yamıyordu
(`land \d+%`); artık sayılar saklanıp her dilde baştan kuruluyor.
Seçim bilaxten.art'la ortak `bx-lang` anahtarında; ilk boyamadan önce
`<html lang>` doğru, çünkü Türkçe büyük harf (`text-transform: uppercase`)
`i`'yi `İ` yapıyor — grup başlıkları DÜNYA / İKLİM / BİYOMLAR olarak doğru,
İngilizce modda `lang="en"` olduğundan PIPELINE bozulmuyor.

**Dikkat çeken:** Türkçe metinler çoğu yerde daha uzun. İzometrik
ipucu ekranın altında yaw denetimiyle aynı satırda; ilk çeviri 1280 px'te
ona çarptı (ölçüldü: sağ kenar 657, denetim 654). "sürükle: döndür ·
shift+sürükle: kaydır · tekerlek: yakınlaş · Q/E: 90°" ile 647'ye indi.
İngilizce ipucu da daha dar pencerelerde aynı çarpışmayı yaşıyor (eskiden
beri).

**Doğrulama:** `checks.sh` temiz; `--i18n` önce kırmızı (silinmiş TR
anahtarı, kancasız `<p>` ve `title`; eski İngilizce `index.html`'de ~95
bulgu), sonra yeşil. Headless Edge (CDP), `tr` ve `en-US` tarayıcı dili,
koyu + açık tema: konsol hatası yok, panelin dört kaydırma konumu iki dilde
ekran görüntüsüyle bakıldı.

**Açık:** gerçek tıklama ve telefon genişliği denenmedi; birkaç terim
(Hillshade, AO, Seed…) `TODO.md`'de Uğur'un gözüne bırakıldı. Dışa
aktarılan dosyalar bilerek İngilizce.

**Sonraki adım:** gözden geçirme → `scripts/publish-site.sh`.

## 2026-10-05 — Yeniden adlandırma: StilizedMaps artık Cartula

Proje adı StilizedMaps iken Cartula oldu (kod, belgeler, scriptler). Canlı demo https://bilaxten.art/cartula/ adresine taşınıyor. localStorage anahtarları (`sm-*`) değişmedi.

## 2026-10-05 — Derin kod incelemesi: bayat yükseklik, export hizası, ters gölge bulgusu

**Ne yapıldı:** Yeni özellik yok; terrain, mesh, export ve gökyüzü kodu
eleştirel okundu. Dört düzeltme (`5383f75`, `4c2830b`, `f195513` + checks.sh),
üç bulgu karar için `TODO.md`'ye yazıldı.

**En öğretici bulgu — iki doğru:** `generate` yüksekliği özel bir kopyada
(`e`) işliyor ve pass pass `grid.elevation`'a geri yazıyor. 7c (iç su
temizliği) toplu geri yazmadan SONRA çalışıyor ve kendi yazmasını unutmuş.
Kademe `e`'den hesaplandığı için voxel görünüm kusursuzdu; bayat değeri
yalnız `grid.elevation` okuyanlar gördü (üstten hillshade, hover rakımı,
fırçalar, Unity yükseklik haritası). Varsayılan haritada karanın %11'i.
Bunu mevcut hiçbir test yakalayamazdı çünkü hepsi `level`/`biome`/`water`
üzerinden bakıyordu. Yakalayan şey, export için "su düzleminin altında kaç
kara hücresi var" diye saymak oldu — bir tüketicinin gözünden bakınca çıktı.

**Neden bu yaklaşım:** Her düzeltme önce kırmızı görülen bir kontrolle
geldi (P8 beş seed'de kırmızı; hiza kontrolü eski eşlemede 61503@23,23;
CRLF kontrolü sahte blob'la). `snapYaw`'da test hatayı KİLİTLEMİŞTİ
(`snapYaw(316) === 270`) — yeşil test doğru davranışın kanıtı değil.

**İkinci tur (Uğur: "önerdiğin gibi düzelt, geri alınabilir olsun"):**
ışık/gölge yönü uyuşmazlığında gölge yürüyüşü çevrildi (`1cd3abb`) — Lambert,
bulut gölgesi ve arazi gölgesinden ikisi zaten aynı yöndeydi, tek olanı
değiştirmek en küçük görsel değişiklikti. Dikey pan (`8dcc9c6`), iç deniz
dolgusunun biyomu (`e9cf0dc`), ışıksız albedo (`9d69dce`), tek hücre
boyayıcı (`6ee275d`), ölü kod (`1ec1911`). Her biri tek commit; alternatifler
`CURRENT.md`'de. Canvas kodu için tarayıcı yerine Node'da sahte canvas'la
çizim çağrısı günlüğü karşılaştırıldı — refactor'ün piksel değiştirmediğini
tarayıcısız kanıtlamanın yolu bu oldu.

**Değişen dosyalar:** `src/generate.js`, `src/export.js`, `src/main.js`,
`src/render/voxel3d.js`, `src/render/topdown.js`, `tools/headless.js`,
`scripts/checks.sh`, `README.md`, `AGENTS.md`, `CURRENT.md`, `TODO.md`.

**Doğrulama:** `bash scripts/checks.sh` temiz; headless Edge'de iki görünüm
hatasız açıldı, ekran görüntüsüne bakıldı. Etkileşim denenmedi.

**Sonraki adım:** `TODO.md` NOW — gece kararlarına gözle bakıp onayla ya da
ilgili commit'i `git revert` et.

## 2026-10-04 — Dolgu havuzları deniz tabanı yüksekliğini taşıyordu
*(geriye dönük yazıldı 2026-10-18; kaynak: `b298496`, `51f6963`)*

**Ne yapıldı:** Kapalı iç suyu kara yapan pass 7c, çalışma yüksekliğini deniz
seviyesinin üstüne kaldırıyordu ama sonucu `grid.elevation`'a geri yazmıyordu.
Bayraklar, biyom ve voxel kademesi doğruydu, bu yüzden voxel görünüm sağlam
duruyordu; `grid.elevation`'ı okuyan her şey (üstten gölgeleme, hover metresi,
fırça yumuşatma, Unity heightmap) deniz seviyesinin 0.43'e kadar altında bir
çanak görüyordu. Varsayılan haritada (seed 1337, 192²) 2929 tile, karanın %11'i.
7c artık yüksekliği yazıyor; kullanılmayan `BIG_LAKE` sabiti silindi.
09-29'da ayrıca Unity export'un bayt sırası için araştırma notu `TODO.md`'ye
eklendi (`row 0 = güney, flip yok` iddiası yalnız Unity'de denenerek doğrulanır).

**Değişen dosyalar:** `src/generate.js`, `tools/headless.js`, `TODO.md`.

**Neden bu yaklaşım:** Hata veriyi kaynağında düzeltmek gerekiyordu; her
tüketicide ayrı yama (hover, fırça, export) AGENTS.md §3'teki tek doğru kaynak
ilkesini bozardı. `--geo P8` ile kilitlendi: hiçbir kara tile'ı deniz eşiğinin
0.06'dan fazla altında saklanamaz — düzeltmeden önce 5 seed'in hepsinde
kırmızıydı (en kötü 0.419), sonra yeşil (en kötü 0.056).

**Doğrulama:** `--geo` P8 önce/sonra ölçüldü. Üstten gölgelemenin kendisi canvas
çıktısı olduğu için tarayıcıda bakılmadı. Unity'de içe aktarma denenmedi.

**Sonraki adım:** Derin kod incelemesi (bir sonraki kayıt, 10-05).

## 2026-09-23 — Panel gözden geçirme, World type, koyu tema, Random düğmesi
*(geriye dönük yazıldı 2026-10-18; kaynak: `f6462d3`…`ab421d5`, `daily/2026-09-23`)*

**Ne yapıldı:**
- **Panel gözden geçirme** (`9422651`): her generatör slider'ı 3 seed'de
  aralığı boyunca ölçüldü. *Island falloff* sessizce yanlıştı — deniz eşiği
  falloff'u yok sayıyordu, slider karayı %65'ten %10'a eritiyordu (ikinci bir
  Sea slider'ı). Eşik artık falloff'u içeriyor, falloff hiç sıfıra inmiyor
  (en çok ×0.15). Sea etiketi gerçek kara payını yazıyor ("62% land" yazıp
  gerçekte %70'ti). *Moisture scale* kaldırıldı (en zayıf etki). World type
  hazır ayarları: Continents / Single island / Frozen / Arid / Tropical.
  Slider'lara tooltip, Distortion → Coast warp, Terrain scale → Feature scale.
- **World type verisi** `src/worldtypes.js`'e taşındı (`9e793e1`), `--worldtypes`
  harness'ı eklendi (Arid'in `mbias`'ı geçici 0'a çekilince kontrol kırmızıya düştü).
- **Random düğmesi** (`f6462d3`): shuffle + Regenerate kalktı, yerine zar ikonlu
  tek *Random* (kısayol R). Bulutlar haritaya girerken/çıkarken solup beliriyor
  (`SM.Sky.cloudFade`), bulut gölgesi de onunla soluyor.
- **Koyu tema + logo** (`0f1bdb7`, `23cd455`): panel renkleri CSS token'ı oldu,
  izometrik voxel ada logosu paletten üretiliyor (`tools/make_logo.py`), favicon
  olarak da kullanılıyor. Harita zemini temayı izliyor, temadan bağımsız zemin
  düğmesi var (`795f183`).
- **Satır sonları** (`827054a`): `.gitattributes` (`* text=auto`) + normalize;
  Windows/Mac karışık çalışmada diff gürültüsü olmasın.
- README'ye dahili tarayıcıda `file://` önizleme notu (`ab421d5`); `40a50d`
  `CURRENT.md` devri.

**Değişen dosyalar:** `src/generate.js`, `src/main.js`, `src/worldtypes.js`,
`src/render/sky.js`, `src/render/voxel3d.js`, `index.html`, `css/style.css`,
`assets/logo.svg`, `tools/headless.js`, `tools/make_logo.py`, `scripts/checks.sh`,
`.gitattributes`, `README.md`.

**Neden bu yaklaşım:** Slider'ı "çalışıyor görünüyor" diye bırakmak yerine her
birinin gerçek etkisi ölçüldü; ikisi aynı şeyi yapıyorsa (Sea / Island) biri
dürüstleştirildi. Archipelago ve Pangaea denendi ama ada konsolidasyonu kuralı
ikisini de bozduğu için eklenmedi. Regenerate'in kendine özgü işlevi yoktu —
ayar değişince harita zaten yeniden üretiliyor; düzenlemeleri silmek için
Edit → Reset to generated var.

**Doğrulama:** `--geo` P7 (eski generatörde kırmızı: 0.5'te 40-47 puan kara
kaybı), `--worldtypes`, `--sky` (2 yeni kontrol). 5 world type ve Custom ↔ geri
eşleşme tarayıcıda denendi, shader hatası yok.

**Sonraki adım:** Portfolyo yol haritası 1-5 kapandı; kalan: ölçüm paketinin
görsel yarısı (Uğur).

## 2026-09-22 — Kod taraması: fırça, nehir yatağı, şelale, deniz derinliği; portfolyo yol haritası 1-5
*(geriye dönük yazıldı 2026-10-18; kaynak: `9ef72c6`…`da7ad22`, `CURRENT.md` geçmişi)*

**Ne yapıldı:**
- **Tarama #1 — fırça/tatlı su** (`8b427be`): yeniden türetme saf oldu
  (`SM.deriveEditedTile`). Tatlı su yükseklik fırçalarında tatlı su kalır; deniz↔kara
  yalnız fırçanın yönünde eşik geçilince değişir (eski kod hafif Raise'de sahili
  su basıyordu — TODO'da yazmayan ikinci bug). `--edit` harness'ı eski mantıkta 6/7 kırmızı.
- **Tarama #4** (`0c8ced4`): izometrikte Undo/Redo mesh'i yenilemiyordu;
  bfcache dönüşünde ölü canvas; `webglcontextlost/restored` toparlaması.
- **Tarama #2 — nehir yatağı/şelale** (`92149f4`, `f1b8c8c`, `2d5d566`): Uğur
  **hibrit** seçti: 2 kademe düşüş kusur sayılıp yatak oyulur (`gradeRiverBeds`),
  3+ kademe tasarlanmış şelale olarak `SM.tagWaterfalls` ile geometriden
  etiketlenir (lip=1 / landing=2). Renderer yarısı ayrı worktree'de yazıldı
  (`aFall` vertex attribute'u, aşağı akan şeritler, iniş köpüğü) ve birleştirildi.
- **Deniz derinliği renkle** (`5e210e2`, `05b291c`): Uğur "çukur koyma, derin
  yeri koyulaştır" dedi; deniz tek düz yüzey, `SM.seaColor` ile derinliğe göre
  ton; önce 6 bant, "bu kadar ton kullanmayalım" üzerine paletten 3 bant.
- **Portfolyo yol haritası** (`8fa32c9`, `854cff4`, `4e17688`, `522058e`):
  pipeline adım adım modu (üretimi 10 aşamada gez, `SM.PIPELINE_STAGES`);
  Unity export tek zip (r16 heightmap, albedo, biyom maskesi, `map.json`;
  `src/export.js` saf, `--export` harness'ı); render debug görünümleri (AO,
  normal, yükseklik, albedo, gölge, şelale — tek `uDebugView` uniform'u).
- `.nojekyll` (`d8e40de`); Pages önbellek karışması TODO'ya yazıldı (`da7ad22`).

**Değişen dosyalar:** `src/generate.js`, `src/grid.js`, `src/biome.js`,
`src/export.js`, `src/main.js`, `src/render/topdown.js`, `src/render/voxel3d.js`,
`index.html`, `css/style.css`, `tools/headless.js`, `scripts/checks.sh`,
`README.md`, `TODO.md`, `CURRENT.md`.

**Neden bu yaklaşım:** Hibrit şelale kararı: tüm düşüşleri şelale yapmak
2 kademelik kusurları "özellik" diye saklardı, hepsini oymak tasarlanmış
şelaleleri silerdi. Akışa dayalı eski `markWaterfalls` silindi çünkü
`grid.flow` yalnız orta hatta var, nehir tile'larının ~%75'inde yok;
geometri her zaman var. Deniz derinliği mutlak referansla (harita başına
percentile değil) boyanıyor: aynı derinlik her seed/boyutta aynı ton.

**Doğrulama:** `--edit` (7 kontrol), `--export` (7 kontrol; zip Python
`zipfile` ile bağımsız doğrulandı), `--mesh` baseline 124430 → 123314,
tarayıcıda `buildVoxelMesh` sayacı ve 7 debug modu. Animasyonlu şelale gözle
izlenmedi. Unity içinde export denenmedi.

**Sonraki adım:** Tarama #3 (P2 "ada aynı kalır", iç deniz boyut eşiği; karar
Uğur'da) ve #5; shader cilası Uğur'la.

## 2026-09-15 — Kod taraması: iklim kuşağı dünya-uzayına, nehir/göl seviyesi
*(geriye dönük yazıldı 2026-10-18; kaynak: `9207d5b`, `ed68f3b`)*

**Ne yapıldı:** Kod taramasının ilk dört bulgusu kapandı.
- **Bulgu 1** (`9207d5b`): `latBand` grid-göreli `y/h` ile hesaplanıyordu, komşu
  satırdaki sıcaklık/nem ise dünya-uzayında; "harita büyüdükçe aynı nokta aynı
  kalır" vaadi kara/su için doğruydu, biyom için değildi (128²↔192² biyom
  örtüşmesi seed başına %35-76). `latBand` `wyOf(y)` kullanıyor, katsayı 192²
  referansıyla türetildi. Biyom örtüşmesi her seed'de +10-13 puan (örn. 90210:
  %57 → %68, 777: %76 → %89).
- **Bulgu 2-4** (`ed68f3b`): nehir/göl `grid.level`'ı kendi elevation'ından
  türetiliyor (önceden hepsi deniz düzlemine yapışıyordu, `markWaterfalls`
  ile çelişiyordu); `--geo` P4 testi bu yüzden hep `climbs=0` görüyordu, yani
  hiçbir şey kanıtlamıyordu — şelaleler hariç tutuldu, eşik ölçülen tabana
  göre (%0-7.8) %10'a kalibre edildi; `setMesh` dispose kontrolü GL kaynağı
  yaratmadan önce yapılıyor, `pagehide` sonrası renderer null'lanıyor.
- Manifest `manifest-2026-09-15.json` olarak yeniden üretildi. Bulgu 5-7
  görsel doğrulama gerektirdiği için bu turda atlandı.

**Değişen dosyalar:** `src/generate.js`, `src/main.js`, `src/render/voxel3d.js`,
`tools/headless.js`, `docs/measurements/README.md`,
`docs/measurements/manifest-2026-09-15.json`.

**Neden bu yaklaşım:** `--geo` P2 yalnız su/kara örtüşmesini ölçüyordu ve biyom
kaymasını yakalayamadı; teste biyom örtüşmesi (≥%40, düzeltme öncesi 35-76,
sonrası 45-89 arası) eklendi ki bu sınıf bug bir daha sessiz kalmasın. Testin
eşiği, düzeltme öncesi ölçümde kırmızı verecek şekilde seçildi.

**Doğrulama:** `node --check`, `--geo/--sweep/--river/--sky/--shaders`,
`scripts/checks.sh` temiz. WebGL tarafı (bulgu 4) headless'ta denenemedi.

**Sonraki adım:** 09-22 taraması (bir sonraki kayıt).

## 2026-09-08 — Gerçeklik Borcu P3: coğrafi iddialar property teste bağlandı
*(geriye dönük yazıldı 2026-10-18; kaynak: `a217232`)*

**Ne yapıldı:** README'deki coğrafi iddialar ölçülebilir hâle geldi.
`node tools/headless.js --geo` 5 seed üzerinde: deniz seviyesi ↑ ⇒ kara ↓ (±2pp),
128²↔192² merkez örtüşmesi ≥%92, her nehir denize/göle/kenara ulaşır, nehirler
voxel seviyesinde >1 kademe tırmanmaz, kule = 0. `--sweep` artık yalnız yazdırmıyor,
assert ediyor ve sıfır olmayan çıkış kodu veriyor; ikisi `checks.sh`'e bağlandı.
`--geo` seed 11'de "nehir hiçliğe akıyor" bug'ını yakaladı → `pruneRiverStubs`
(çıkışa ulaşmayan 4 tile'dan kısa nehir parçaları budanıyor). Yol, fantezi etiket
ve şelale pass'leri `decorations` bayrağı arkasına alındı (varsayılan kapalı,
hiçbir renderer çizmiyordu, bake ucuzladı). Paylaşım linki fırça editlerini
taşımıyor → "Copied (settings only)"; edit sonrası istatistik gerçek kara %'sini
gösteriyor. İlk ölçüm paketi: `docs/measurements/` + `--manifest`
(3 seed × 192²/448², `manifest-2026-09-08.json`).

**Değişen dosyalar:** `tools/headless.js`, `scripts/checks.sh`, `src/generate.js`,
`src/main.js`, `docs/measurements/README.md`, `docs/measurements/manifest-2026-09-08.json`,
`TODO.md`.

**Neden bu yaklaşım:** Vaka çalışmasında "ada aynı kalır, nehir denize ulaşır"
gibi cümleler yazılacaktı; kanıtsız iddia portfolyoda risk. Testin kendisi bug
bulabildi (seed 11), yani yalnız süs değil. Görsel yarı (PNG, orbit klip)
tarayıcıda üretilmek zorunda; headless'ta WebGL/canvas yok.

**Doğrulama:** `scripts/checks.sh` temiz; `--river/--mesh/--sky/--shaders/--sweep/--geo` OK.

**Sonraki adım:** Kod taraması (09-15).

## 2026-09-06 — Eski 2D izometrik yol tamamen kaldırıldı (+ PNG export düzeldi)

**Ne yapıldı:** Uğur "önerdiğin çözümleri yapalım... 4 yönlü 2D image'ı tamamen
kaldıralım, 2D olarak sadece top view kalsın" dedi. Denetim turunda rapor edilen
ölü ağırlık silindi: **-917 satır, +124.**

**Silinenler:**
- `src/render/iso.js` (371 satır) — canvas izometrik renderer.
- `main.js`'te 18 fonksiyon (~460 satır): `rotateGridView`, `makeCloudCells`,
  `makeWeather`, `makeSmokeState`, `makeFlocks`, `prism`, `drawFoam`,
  `stepWeather`, `drawCloudShadows`, `drawClouds`, `smokeParticle`,
  `drawSmokeGroup`, `drawBirds`, `tickIso`, `isoOpts`, `clearRotCache`,
  `scheduleRotBakes`, `revealIso` + `camRot`/`rotCache`/`isoJustBaked`/
  `wantReveal`/`animHash` durumu.
- `?renderer=iso` kaçış kapısı ve dört yönlü (N/E/S/W) bake önbelleği.

**Neden şimdi:** "Faz 5" olarak planlanmış ama hiç yapılmamıştı. Voxel yolu onu
her açıdan ikame etmişti (360° kamera, AO, cast shadow) ve M4 ile kendi bulut/
kuş katmanını da kazandı — yani depo İKİ paralel bulut sistemi taşıyordu.
Üstelik eski yolun hiçbir testi yoktu (`headless.js` `iso.js`'i yüklüyordu ama
`renderIso`'yu hiç çağırmıyordu), yani sessizce bozulabilirdi.

**Korunanlar (dikkatle ayrıldı):** `#riverfx` overlay, `tick`, `tickTop`,
`startRiverAnim` — bunlar ÜSTTEN görünümün nehir parıltısı ve lav nabzı için de
kullanılıyor; yalnız iso dalları çıkarıldı.

**WebGL2 yoksa ne olur:** artık geri düşülecek bir yol yok. `refresh()` görünümü
üstten görünüme alıyor, `Isometric` sekmesini devre dışı bırakıp sebebini
yazıyor. Sessizce üstten görünüm çizmek yanlış olurdu — kullanıcı "Isometric"e
basmışken üstten harita görür ve nedenini bilmez.

**YOL BOYUNCA BULUNAN GERÇEK BUG:** `exportPng` izometrik görünümde
`console.warn('not available yet (Faz 5)')` deyip geri dönüyordu — ve izometrik
VARSAYILAN görünüm olduğu için **"Export PNG" düğmesi çoğu kullanıcı için
sessizce hiçbir şey yapmıyordu.** Voxel renderer'a `capture()` eklendi.
⚠️ `glCanvas.toDataURL()` burada ÇALIŞMAZ: bağlam `preserveDrawingBuffer`
olmadan kuruluyor, dışarıdan piksel istendiğinde tampon çoktan gitmiş oluyor ve
sonuç boş çıkıyor. O bayrağı açmak bir kez basılan düğme için her kareye maliyet
bindirirdi; onun yerine `capture()` AYNI tick içinde render edip `readPixels`
ile okuyor (GL alttan üste okur, satırlar çevriliyor).

**Doğrulama:** `checks.sh` temiz, headless beş mod da temiz. Tarayıcıda:
varsayılan görünüm izometrik (WebGL), `SM.renderIso` yok, üstten görünüm ve
riverfx overlay sağlam, iki yönde geçiş çalışıyor, konsol temiz. PNG export
ÖLÇÜLEREK doğrulandı — izometrik 1873×1319 gerçek içerikli PNG (eskiden hiçbir
şey), üstten 1152×1152 bozulmadan.

## 2026-09-06 — M4 bitti: voxel bulutlar, bulut gölgesi, uçan kuşlar

**Ne yapıldı:** M4'ün kalan iki maddesi (uçan kuşlar, bulut gölgesi) WebGL voxel
görünümüne eklendi. Yeni saf katman `src/render/sky.js` + `--sky` headless modu
(20 kontrol). Bulutlar eski iso yolunda boyanmış sprite'lardı; burada dünya
uzayında gerçek voxel geometri, yani orbit kamera etraflarında dönüyor.

**Tasarım kararları:**

- *Bulut gölgesini ARAZİ shader'ı çiziyor.* Gölge yere düşer, yani onu çizmesi
  gereken arazi. Arazi shader'ının dünya konumu yok ama `vCellUV`'si var
  (haritada 0..1), o yüzden gölge o uzayda ifade ediliyor — ekstra bir gölge
  haritası ya da ikinci geçiş gerekmedi.
- *Tek kaynak kuralı.* Bulut GÖVDESİ gökyüzü programında, GÖLGESİ arazi
  programında çiziliyor. İkisi sürüklenmeyi ayrı hesaplasaydı zamanla
  ayrışırlardı ve sonuç "kendi bulutunun altından kayan gölge" olurdu — tek
  ekran görüntüsünde görünmeyen, yalnız harekette fark edilen bir bug.
  Sürüklenme JS'te bir kez hesaplanıp ikisine de uniform veriliyor.
- *Kuşların JS tarafı yok.* Buluttan farklı olarak kuşun nerede olduğunu sahnede
  başka hiçbir şey bilmek zorunda değil, o yüzden yörünge/yön/kanat çırpma
  tamamen vertex shader'da, vertex'in taşıdığı kuş indeksinden türüyor. Tek
  buffer, tek draw call, JS'te sıfır iş.
- *Kare başına ayırma yok.* `driftClouds` ve `cloudShadowUniforms` çağıranın
  tamponuna yazıyor; sözleşme testle kilitli.

**ÜÇ TUZAK — hepsi "hiçbir şey görünmüyor, hata da yok" ile başladı:**

1. **Cache.** `index.html?cb=N` YALNIZ HTML'i tazeliyor. `src/*.js` ayrı
   URL'ler ve `python -m http.server` cache header'ı göndermediği için Chrome
   onları saklıyor — tarayıcıda eski kod koşuyordu. Bu tuzak bu projede
   2026-09-02'de de saatler yemişti. Kalıcı çözüm bu turda geldi:
   **`scripts/serve.py`**, `Cache-Control: no-store` gönderiyor. Bundan sonra
   yerel test bununla açılmalı, `python -m http.server` ile değil.
2. **Frustum kırpması.** Gökyüzü kuruldu, yüklendi, çizildi — ve ortho frustum
   onu tamamen kırptı, çünkü `fitCamera` yalnız ARAZİYİ çerçeveliyordu. GL
   hatası yok, konsol temiz, sonuç boş gökyüzü: "özellik hiç yazılmamış" gibi
   görünen bir başarısızlık. `SM.Sky.ceiling` artık gökyüzünün ne kadar
   yükseldiğini bilen tek yer ve `fitCamera` onu okuyor.
3. **Sessiz shader link hatası.** `uMode` uniform'u iki shader'da tanımlıydı ama
   `int`in varsayılan hassasiyeti vertex'te `highp`, fragment'te `mediump` —
   GLSL ES'te bu bir LINK HATASI. `makeSkyProgram` null dönüyor, `buildSky`
   sessizce çıkıyor, hiçbir şey olmuyordu. ⚠️ **Depoda bunun tam aynısı daha
   önce yaşanmış:** `fix(render): uTime precision mismatch broke WebGL2 link on
   Firefox`. İki kez ısırdığı için artık shader derleme/link hataları
   `console.warn` YANINDA `window.__glShaderErrors`'a da yazılıyor — sayfa
   yüklenirken olan bir hata, konsol okuyucusu bağlanana kadar kaybolur.

**Doğrulama:** `scripts/checks.sh` temiz (12 JS), `node tools/headless.js`
normal/`--sky`/`--river`/`--mesh` dördü de temiz. Tarayıcıda gözle ve ölçerek:
bulutlar sürükleniyor, kuşlar kanat çırparak dönüyor, ve bulut anahtarı
kapatılıp açılarak gölgenin gerçekten araziyi karartığı iki ekran görüntüsü
karşılaştırılarak doğrulandı.

## 2026-09-06 — M3 kapandı: nehir fırçası + belge sürüklenmesinin düzeltilmesi

**Ne oldu:** Uğur "M3 fırçayı falan da yapmış olmamız lazım, kontrol eder misin"
dedi. Kontrol ettim: **fırça editleme zaten yapılmıştı** — commit `aa3b1cf`
"Codex: M3 fırça editleme" (2026-09-02). Ama HİÇBİR belge bunu kaydetmemişti:
`README.md` hâlâ `- [ ] M3`, `CURRENT.md` "başlamadı", `TODO.md` NOW M3'ü hâlâ
üç adaydan biri olarak listeliyor, bu dosyada kayıt yok, vault tarafındaki
thread + otomatik hafıza notu da "sırada M3" diyordu. Kod dört gün önce
ilerlemiş, anlatı yerinde saymış.

**Eksik olan tek parça nehir aracıydı.** README'nin M3 tanımında "nehir çiz"
geçiyordu ama kodda `tool === 'river'` diye bir dal yoktu; diğer altı araç
(Raise/Lower/Smooth/Water/Land/Paint biome) + Undo/Redo/Reset tamdı. Uğur
"nehir aracını yaz, M3'ü kapat" dedi.

**Nehir aracı — tasarım kararları:**

- *Nehir bir KANAL, havuz değil.* Diğer fırçaların ağırlıklı diski bilerek
  kullanılmıyor: fırça boyu 12'de disk 25 hücre genişliğinde bir su kütlesi
  boyardı, ki o zaten `water` aracının işi. Kanal genişliği fırça boyundan
  türüyor ama dar kalıyor — 1, 3, 5, 7 hücre.
- *Yatak banklarının ALTINA oyuluyor.* Düz mavi bir şerit boya gibi okunuyor;
  kesilmiş bir kanal voxel görünümünde nehir gibi okunuyor. Derinliği `strength`
  belirliyor (hafif dokunuş dere, ağır dokunuş boğaz).
- *Bank referansı kanalın DIŞINDAKİ halka.* Hücrenin kendisi alınsaydı tekrar
  eden fırça darbeleri kendi kendini aşağı yürütüp dipsiz bir hendek kazardı.
  `--river` testi tam olarak bunu ölçüyor: 8 darbeden sonra toplam sürüklenme
  2.1e-8 (yatak derinliği 0.040) — yani ilk darbeden sonra sabitleniyor.
- *Nehir deniz seviyesinin ÜSTÜNDE tatlı su.* Yatak `seaThresh`in hemen üstüne
  kırpılıyor; altına inseydi `deriveTile` hücreyi kıyı olarak yeniden
  sınıflandırıp nehir kimliğini sessizce silerdi.
- *Lava söndürülüyor* — üretecin kendi kuralının aynısı (`generate.js` adım 7a).

**Yol boyunca bulunan gerçek bug:** geri alma kaydı (`makeEditRecord`) `lava`
alanını TUTMUYORDU. Nehir aracı lavayı söndürdüğü için undo lavayı geri
getiremezdi — geri alınan volkan yüzeyi altında parlamaya devam ederdi. Kayda
`lava` eklendi.

**Testin yakaladığı ikinci şey:** ilk genişlik eğrisi `round(radius/3) - 1` idi
ve fırça boyu 1-4'ün hepsini tek hücreye eşleyip doğrudan beşe atlıyordu — yani
slider'ın ilk üçte biri ölü yol, 3 hücrelik genişlik ise ulaşılamaz. `--river`
genişlik eğrisini bastığı için görüldü; `floor((radius - 1) / 3)` ile dördü de
erişilebilir oldu.

**Doğrulama:** `node tools/headless.js --river` (9 kontrol: darlık, monotonluk,
tüm genişliklerin erişilebilirliği, yatağın banklardan aşağıda olması, deniz
seviyesinin altına inmemesi, tekrarlı darbelerde yakınsama, determinism, harita
kenarı), `--mesh` ve normal mod değişmedi, `scripts/checks.sh` temiz.
**Tarayıcıda gözle ve ölçerek doğrulandı** (localhost + cache-buster): araç
listede, 21/21 örnek nokta nehir rengine döndü (#3f7fa6), undo tam geri aldı ve
redo birebir geri getirdi, konsol temiz, WebGL2 bağlamı hatasız, çizilen kanal
voxel görünümünde oyulmuş bir su yolu olarak okunuyor.

**Not:** `CURRENT.md` 2026-09-02'de donmuştu ve 2026-09-03'teki beş commit
(WebGL2 voxel orbit/auto-rotate/Firefox düzeltmesi) hiçbir yerde kayıtlı
değildi. Bu tur onları da kayda geçirdi.

## 2026-09-02 — Konik yanardağ + anim layer fix + gün-döngüsü slider'ı

**Yanardağ:** silindir → konik. `coneDrop = vRad·(landSpan/levels)·0.9`
(~1 kademe/tile), `pow(vt, 0.8)` profil, tepeden tabana iniyor, araziye
karışıyor. Krater rim'in 1.6 kademe altında (içine göllenmiş).

**Animasyon layer sıkıntısı:** per-tile `clearRect` overlap yüzünden kümeli
tile'lar (krater lav gölü) birbirini kırpıyordu. Artık tüm animasyonlu
tile'ları kapsayan tek bounding-box temizlik + painter's order (gx+gy)
yeniden çizim. Ortak `prism()` helper'ı. Lav voxel'leri hareketsiz, sadece
glow nabzı.

**Gün-döngüsü slider'ı (`#sun`, 0-24, vars. 14:00):**
- `sunModel(hour)` → iso gölge yönü/uzunluğu/gücü + ekran rengi wash + canvas
  filtresi. Gündüz 6:00-18:00.
- İso gölge ön-geçişi artık `sun.dx/dy/rise/strength` alıyor: alçak güneş =
  uzun koyu gölge, güneş doğu→batı süpürüyor. `change`'de yeniden bake.
- `#daynight` div (`mix-blend-mode: multiply`) + `#map` CSS filtresi:
  gece koyu mavi, şafak/gün batımı sıcak turuncu, öğlen nötr. `input`'ta
  canlı (yeniden render yok), `change`'de gölge yeniden bake.
- Volkan lav'ı gece dramatik parlıyor.

**Doğrulama:** headless determinism OK, 0 kule; tarayıcıda gece/şafak/öğlen
denendi, overlay+filter+shadow doğru, konsol temiz. Volkan konisi seed 12'de
net (rim→taban 8→0). Animasyon hareketi otomasyonda gözlenemez.

## 2026-09-02 — UI makeover (rafine cila) + PNG export + paylaşım linki

Uğur: "ui makeover yapacağız bir de güzel gözüksün" + border/lav/krater
düzeltmeleri (ayrı commit).

**UI:** `index.html` + `css/style.css` baştan yazıldı. Aynı layout, rafine:
- Tasarım token'ları (`:root` — bg/panel/line/accent...). Vurgu: sıcak amber
  `#eba14a` (lav/güneş çağrışımı, koyu zeminde güçlü).
- Header (amber mark + tagline), segment kontrol (Top-down / Isometric).
- Parametre grupları `<details>` — katlanabilir, chevron'lu.
- Özel range slider: accent dolgu (`--fill` %'si JS'te `input` olayında
  boyanıyor, webkit gradient track), büyüyen thumb, focus ring.
- Legend 2 sütun grid. Alt bar: stats + **Export PNG** + **Copy link**.
- `#stage` radial gradient zemin, hover kartı blur'lu.

**Export PNG:** `map` (+ iso'da `riverfx`) geçici canvas'a kompoze → `toDataURL`
→ `<a download>`. **Copy link:** tüm parametreler querystring'e, `navigator.
clipboard`; sayfa açılışında `location.search` okunup input'lara uygulanıyor
(seed'li harita paylaşımı).

**Not:** `python -m http.server` cache header'ı göndermiyor, Chrome agresif
cache'liyor — bu oturumdaki "stale screenshot" sorununun kaynağı buydu.
Tarayıcı testi cache-buster query (`?cb=N`) ile yapıldı.

**Doğrulama:** yeni UI render'landı, segment aktif durumu amber, slider
dolguları doğru, export toDataURL 304KB PNG üretiyor, share URL 167 char,
konsol hatasız.

## 2026-09-02 — Voxel border, daha büyük yanardağlar, voxel lav akışı

Uğur: "lav akışını da border'ı da voxel yapman lazım. yanardağları da daha
yüksek ya da daha geniş yapabilirsin gerçek dünyadaki gibi."

- **Voxel border:** iso'daki plinth+rim stroke kaldırıldı. Ana döngü artık
  `-MB..W+MB` (MB=1); harita dışındaki halka için koyu kömür (`[32,36,44]`,
  üst `×1.4` okunur) voxel prizmalar çiziliyor — üstü kenar reliefine yaslanıyor
  (min level 2), yan yüzler zemine kadar. Painter's order'da terrain ile
  çizildiği için doğru occlude oluyor. Canvas + origin 1 tile pay büyütüldü.
- **Yanardağlar gerçek-dünya ölçeği:** vRad 5-8 → 8-15 (geniş taban), rim
  lift 0.055 → 0.13 (yüksek), koni profili `rimE - (t²)*coneDrop` (dik üst
  koni), krater 0.055 çökük. Lav akışı 3-8 → 6-14 tile + yana 1 tile genişleme
  (akıntı gibi okusun). Kule yok, determinism OK.
- **Voxel lav animasyonu:** LAMP 3→6, LSPEED 1.4→2.4, ayrı `lslab` (lh·0.5),
  crest lavadan beyaz-sıcağa lerp, kabuk yan yüzlerinde hafif iç glow.

**Doğrulama:** headless determinism OK, 0 kule, her tohumda lav+volkanik
(volkanik footprint 135→337). Tarayıcı canvas örneklemesi: iso render tam,
border ~69k kömür piksel (ön kenarlarda zemin-plinth), lav ~2k turuncu
piksel. Otomasyon screenshot'ları büyük canvas + animasyonda bazen stale
geliyor — canvas `getImageData` ile doğrulandı.

**Sonraki:** M3 fırça editleme; border kontrastı isteğe göre ayarlanabilir.

## 2026-09-01 — Coğrafi kurallar tur 2 (Codex delegasyonu), lav, iso gölge + border, takımada konsolidasyonu

**Ne yapıldı:** Uğur: sıradaki coğrafi kurallar turu + "kodlama işini codexe
devret" + iso'da border görünmüyor + nehir animasyonunda occlusion (kameraya
görünmeyeni render etme) + lav + iso gölge + "su artınca minik minik adalar
oluşmasın, önce ada sayısı azalsın sonra tek adaya insin" + shell'leri arka
planda aç.

**Codex'e devredildi** (`.claude/scripts/codex-delegate.sh --write`,
`generate.js` + `biome.js`), sonra satır satır doğrulandı ve elle ayarlandı:
- **Takımada konsolidasyonu (6d):** deniz yükseldikçe minimum ada boyutu
  eşiği boyut dağılımı içinde yukarı süpürüyor — önce serpinti, sonra küçük
  adalar, sınıra gelince yalnız ana kara kalıyor. Codex'in sabit sayı
  tavanı (`maxIslands`) 0.45→0.55 arası kara %64→%19 uçurumu yaratmıştı;
  yumuşak boyut eşiğine çevrildi (`minKeep`, `consT*consT` eğrisi). En büyük
  gövde daima korunuyor. Sweep: 9→8→5→2→3→1→1 ada.
- **7e invaryant:** hidrolojiden sonra nehir/fiyort'un kestiği parçalar
  eşiğin altındaysa batırılıyor (sabit sayı değil). Batan parçalar
  komşusuna göre deep/shallow.
- **Kıta sahanlığı (hidroloji) düzeltmesi:** BFS artık harita kenarını
  "kıyı" saymıyor → dikdörtgen shelf hattı gitti, derin su kenara ulaşıyor.
- **Plato (3c), karasallık (5c, BFS ile okyanus uzaklığı → iç bölge sıcaklık
  daha uçlu + nem -0.15), fiyort (6e), kıyı oku+lagün (6f), delta/haliç
  (7b, tohum bitine göre biri), riparian yeşillik (7d, nehir/göl 2 kare
  tamponu +nem yeniden sınıflandırma).**
- **Lav:** `biome.js`'e `lava` + `volcanic` eklendi (son sıraya, index'ler
  sabit). Volkanik koniler (0-2 tohumlu, sıradağ+sıcak+kurak; her haritada
  ≥1'e ayarlandı), krater lav gölü, kısa lav akışı. `grid.lava` Uint8Array
  `generate()` içinde.

**Nano (render/animasyon):**
- **İso border:** floor-düzlemi görünmez çizgi yerine — iki ön kenarda koyu
  plinth (zemine kadar) + dört kenarda reliefe yaslanan kalın koyu rim.
- **İso gölge:** yönlü gölge ön-geçişi (güneş ekran sol-üst); occluded
  kareler üst yüz ~%34, yan ~%18 kararıyor.
- **Nehir occlusion culling:** `iso.js`'te geometrik test —
  `L_ön >= L + (TH2/LH)(2k-1)` ise üst yüz gizli → animasyon listesinden
  düşür. Lav için de.
- **Lav animasyonu:** `#riverfx` overlay'de — koyu kabuk yan yüzleri, glow
  ile parlak sarıya lerp'lenen erimiş üst, yavaş şişme.
- **Üstten görünüm nehir animasyonu:** `#riverfx` artık top view'da da
  görünür; nehir karelerinde akıntı yönünde kayan parıltı, lav turuncu nabız.

**Hangi dosyalar:** `src/generate.js` (+~430 satır), `src/biome.js`,
`src/render/iso.js`, `src/render/topdown.js`, `src/main.js`, `css/style.css`,
`tools/headless.js` (yeni test harness).

**Doğrulama:** headless — determinism OK, 0 kule, ada sayısı monoton
düşüyor (1'e), her tohumda lav+volkanik, gen 60-185ms (192²), 325ms (320²).
Tarayıcıda — top+iso temiz, konsol hatasız, dikdörtgen shelf gitti, derin su
kenara ulaşıyor, border+plinth görünür, gölge var, volkan+lav akışı görünür.
Batan adalardan kalan sığ shoal lekeleri var (deniz bankları — kabul
edilebilir). Animasyon otomasyonda gözlenemedi (bg-tab rAF throttle).

**Açık işler / sonraki:** shoal lekelerini tam derine çevirmek; 320²+ perf
(~325ms); kıstak/takımada belirgin özellik değil (emergent). Fırça editleme
(M3) hâlâ bekliyor.

**Sonraki tur seçenekleri:** M3 fırça editleme, veya lav akışı animasyonunu
nehir gibi voxel-küp yapmak, veya shoal temizliği + perf.

## 2026-09-01 — Voxel nehir animasyonu, daha az su, vadiler, göl taşması, İngilizce UI

**Ne yapıldı:** Uğur: su kuralı daha strict (daha az su), nehir animasyonu
"küpler halinde, yüksekten alçağa akan", UI İngilizce, "deniz seviyesi" →
deniz-kara oranı, harita kenarına siyah border, + sıradaki kurallar.

- **Daha az su:** seaLevel 0.42→0.38. İç su artık YALNIZCA nehir-bağlantılı
  gövde olarak yaşıyor (BIG_LAKE eşiği kaldırıldı) — açıklanamayan iç deniz
  yok. Bir nehir kapalı havzaya akarsa orada **göl** oluşuyor (pit→lake
  flood, ≤60 kare). Sonuç: water% ~38→~30, göller 100-450 kare (gerçek
  nehir-beslemeli göller).
- **Voxel nehir animasyonu:** nehir kareleri artık küçük su küpleri.
  `#riverfx` overlay canvas'ında (terrain canvas'ına dokunulmuyor) her kare
  bir prizma (üst + 2 yan yüz); yükseklik `sin(t*SPEED - elev*K)` ile
  salınıyor — dalga tepesi düşük rakıma doğru ilerliyor = yüksekten alçağa
  akış. Küp tabanı sabit, üstü inip kalkıyor. 30fps, dirty-rect.
- **Vadi oyma:** nehir izleri `e`'ye V-vadi kazıyor (yarıçap 2, nehir ve
  yakın kıyı aşağı çekiliyor) — su yüzeyde durmuyor, vadiden akıyor.
- **Göl taşması:** her göl en alçak kıyı noktasından bir çıkış nehriyle
  boşalıyor (steepest descent).
- **UI İngilizce:** tüm etiketler, biyom adları, hover ("+818 m · moist
  0.53 · 22°C"), stats ("land 62%"). `lang="en"`.
- **Deniz-kara oranı:** "Deniz seviyesi" → "Sea ↔ land — X% land".
- **Siyah border:** iso'da haritanın floor düzlemi hattı tek koyu çizgiyle
  çiziliyor.

**Hangi dosyalar:** `src/generate.js`, `src/main.js`, `src/render/iso.js`,
`src/biome.js`, `index.html`, `css/style.css`.

**Doğrulama:** headless — determinism 0, 0 kule, water% 29-36, göller
100-450, gen ~55-106ms. Tarayıcıda — 192² temiz harita, İngilizce UI,
vadilerde nehirler, siyah border, pan 300 güncelleme 0.6ms (overlay
izolasyonu çalışıyor), konsol temiz. Animasyon otomasyonda bg-tab rAF
throttle yüzünden gözlenemedi (kod yolu sağlam, tick atıyor).

**Sonraki tur:** deltalar, fiyortlar, kıyı okları/lagünler, platolar,
kıstaklar, takımadalar, haliçler, karasallık, riparian yeşillik, üstten
görünüm nehir animasyonu.


## 2026-09-01 — Perf + iç su temizliği + dendritik nehirler

**Ne yapıldı:** Uğur "kasmaya başladı kontrol edemiyorum" + "deniz/ada
çevresi değilse çok su olmasın, iç kısımda nehir/göl olsun ama 500 su
birikintisi olmasın" dedi + "sonraki tura başla".

- **Perf:** 256²→192² varsayılan (slider max 448). **Nehir animasyonu ayrı
  bir overlay canvas'a** (`#riverfx`) taşındı — büyük terrain canvas'ı bake
  sonrası hiç dokunulmuyor, compositor onu statik texture olarak tutuyor,
  pan/zoom bedava. Overlay'de her frame sadece nehir karelerinin küçük
  dirty-rect'leri temizlenip yeniden çiziliyor. 30fps sınırı. >600 nehir
  ya da >16MP haritada kapalı.
- **İç su temizliği (7b pass):** hydrology sonrası — okyanus olmayan, nehir
  olmayan her su gövdesi flood-fill'le ölçülüyor; `< MIN_LAKE (10)` VE
  nehre değmiyorsa karaya dolduruluyor (elevation deniz üstüne, biome
  classify'dan). Sonuç: <10 kareli iç su gövdesi ~onlarca → ~1 (o da
  nehir bağlantılı). Land artık lekesiz.
- **Dendritik nehirler:** iz sürme artık merge'de KIRILMIYOR — kaynaklar
  denize kadar iniyor (steepest descent zaten birleşen kanalı takip eder),
  her tile'da `accum` (kaç kaynak geçti) sayılıyor. Genişletme accum'a göre:
  headwater 1 kare, `accum>=3` → 2, `accum>=6` → 3 kare geniş. Nehir mansaba
  doğru büyüyor.

**Hangi dosyalar:** `src/generate.js`, `src/main.js`, `index.html`,
`css/style.css`.

**Doğrulama:** headless — determinism 0, 0 kule, <10 kareli iç su ~1,
192² gen ~80ms (256²'de ~200ms'di), 448² ~360ms. Tarayıcıda — 192² temiz
harita, dendritik nehirler (mansapta geniş trunk), overlay canvas kurulu +
transform eşleşiyor, konsol temiz.

**Sonraki tur (devam):** deltalar, V/U vadiler, göl taşması (outlet nehir),
fiyortlar, kıyı okları/lagünler, platolar, kıstaklar, takımadalar, haliçler,
voxel-yükseklik nehir dalgası, üstten görünüm nehir animasyonu.


## 2026-09-01 — Kalın nehirler, büyük harita, zirve baskınlığı

**Ne yapıldı:** Uğur "nehirleri daha kalın, harita fantasy map gibi büyük,
yüksek dağ varsa yanında dağ olma olasılığı düşük" dedi.

- **Kalın nehirler:** iz sürme sonrası genişletme pass'i — nehir karesinin
  kıyı komşuları da nehir olur (elevation'ı fazla yüksek değilse), `flowStep
  > 26` olan aşağı-akış kareleri 2 kare genişler. River tile ~30 → ~130,
  görünür şekilde kalın.
- **Büyük varsayılan harita:** 160²→256², slider adımı 16→32. Gen ~130-260ms,
  iso canvas budget otomatik tile küçültüyor. Epic fantasy dünya ölçeği.
- **Zirve baskınlığı (prominence):** repair sonrası pass — elevation yerel
  maksimumları bulunur, en yükseğinden başlanır, her biri `DOM_R=13` yarıçapta
  bir "baskınlık kuyusu" açar: `cap = pkElev - 0.045 - dist*0.0135`, üstündeki
  rakip yükseltiler `e*0.18 + cap*0.82` ile aşağı çekilir → omuz/boyun olurlar.
  `claimed` dizisiyle bir zirvenin kapsadığı alandaki başka zirveler atlanır.
  Sonuç: kümelenmiş benzer-yükseklik zirve %20 → %8, dağlar yalnız duruyor.
- Deniz seviyesi (referans örneklemesi) sample loop'undan önceye alındı,
  prominence pass'i `seaThresh`'i biliyor.

**Hangi dosyalar:** `src/generate.js`, `index.html`.

**Doğrulama:** headless — determinism 0, 0 kule, kümelenmiş zirve %6-11,
256² gen ~130ms, 512² ~350ms, river tile ~130. Tarayıcıda — 256² fantasy
harita ölçeği, kalın nehirler, sıra dağlar dominant zirvelerle, konsol temiz.

**Not:** prominence bazı yüksek terrain'i alçalttığı için snow %1.5-2'ye
düştü — dominant zirveler hâlâ karlı, ama genel kar azaldı. Gerekirse
snowLine/RIDGE_H ile geri çekilir.

**Sonraki tur:** dendritik nehir kolları, deltalar, vadiler, fiyortlar,
platolar, voxel-yükseklik nehir dalgası.


## 2026-09-01 — Coğrafi kurallar tur 1: sıra dağlar, kıta sahanlığı, yağmur gölgesi, gerçek rakım, nehir akışı

**Ne yapıldı:** Uğur "hepsini yapalım" (menüdeki coğrafi kurallar) + "rakımı
gerçek metrelerle göster" + "nehirleri denize dökülene kadar animasyonlu" dedi.
Aşamalı — bu tur yapısal + iklim kuralları, sonraki tur dendritik nehirler/
deltalar/fiyortlar/platolar.

- **Dağlar SIRA halinde** (`makeRidgeField`): 2-4 gezinen polyline (fay hattı),
  bir mesafe alanına (128²) pişirilir, `heightAt` içinde `pow(rb,1.5) * RIDGE_H`
  ile arazi yükseltilir. Blob değil, zincir dağlar. Referans örneklemesi de
  ridge'leri hesaba katıyor.
- **Kıta sahanlığı:** su kıyıdan ~9 kare boyunca deniz düzleminde (level 0,
  shelf), sonra shelf kırığında derinleşir. Derin deniz artık istisna —
  shelf denizleri sığ okur (Uğur'un isteği), açık okyanus derin.
- **Yağmur gölgesi + orografik:** tohumlanmış hâkim rüzgâr yönü; her kara
  karesi 20 adım rüzgâr yukarı taranır, dağ varsa nem düşer (lee tarafı kurak),
  windward yamaç nem alır. Ayrı bir climate pass'i (moisture → rain shadow →
  temp + classify).
- **Ağaç/kar sınırı** (`classify`): snowLine sıcaklığa göre — kutuplara doğru
  alçalır, ekvatora doğru yükselir. treeLine = snowLine - 0.15; arası
  tundra/çıplak.
- **Gerçek rakım:** `SM.elevationMeters` — deniz seviyesi 0, kara +4200m'ye,
  okyanus tabanı -5500m'ye. Hover: "Ova · +818 m · nem 0.53 · sıc 22°".
  Sıcaklık da °C.
- **Nehir akış animasyonu** (izo): nehir kareleri statik bake'e çizilir, ayrıca
  main.js bir rAF döngüsünde her kareyi küçük bob (±2px, sinüs) + akıntı yönünde
  ilerleyen shimmer ile yeniden çizer. Smear'ı önlemek için önce snapshot'tan
  restore. `grid.flow` (yön 1-8) + `grid.flowStep` (kaynaktan adım) üretimde
  saklanıyor. Büyük haritalarda (>12MP) kapalı.
- **Daha az yumuşatma:** 3x3 blur kaldırıldı, SPIKE 0.05.
- **Yeniden dengeleme:** RIDGE_H, yağmur gölgesi, sıcaklık, cliff eşikleri
  ayarlandı — dünya artık ılıman/çeşitli (forest/grassland/plains baskın,
  snow %3-6, cliff seyrek).

**Hangi dosyalar değişti:** `src/generate.js` (ridge alanı, climate yeniden
yapılandırma, shelf, flow), `src/biome.js` (snowLine/treeLine), `src/render/
iso.js` (nehir listesi), `src/main.js` (rAF nehir animasyonu, metre hover).

**Doğrulama:** `node --check` temiz, headless — determinism 0, 0 kule,
metre değerleri makul, 512² gen 362ms. Tarayıcıda — sıra dağlar + yağmur
gölgesi kuru bölgeler + çoğunlukla sığ deniz + nehirler görünüyor, hover
metre/°C, iso nehir animasyonu tick atıyor (otomasyonda bg-tab rAF throttle
yüzünden tam görülemedi ama kod yolu sağlam), konsol temiz.

**Açık işler (sonraki tur):** dendritik nehir ağı (kollar birleşir, aşağı
genişler), deltalar, V/U vadiler, fiyortlar, kıyı okları/lagünler, platolar,
kıstaklar, takımadalar, göl taşması, haliçler, karasallık, riparian yeşillik,
üstten görünümde de nehir animasyonu, voxel-yükseklik nehir dalgası (şu an
sadece küçük bob + shimmer).

**Sonraki adım:** Uğur'un geri bildirimi.


## 2026-09-01 — Kurallı üretim: dünya-uzayı, erozyon, hidroloji, nehirler

**Ne yapıldı:** Uğur "sistem tamamen rastgele olmasın, gerçek coğrafya gibi
kurallı olsun; tek karelik kuleler oluşmasın; boyut büyüyünce özellikler
sabit kalıp harita kenardan büyüsün; su bu kadar düzensiz alçalamaz; 2D
görüntüleme bozuk; boyut max 512" dedi. Üretim hattı adlandırılmış pass'lere
bölünüp kurallı hale getirildi.

- **Dünya-uzayı noise + domain warp.** `nx = x/w` normalize yerine
  `wx = (x - merkez) / REF` — özellikler sabit boyutta, harita büyüyünce
  kenardan yeni dünya açılır (ada aynı kalır, okyanus büyür — data'da
  doğrulandı: island 128²→18%, 192²→8%, 288²→4% kara, ada ~sabit tile).
  Domain warp (düşük frekans, `warp` slider'ı) organik kıyılar için.
- **Sabit kontrast eğrisi** (per-map min/max normalize yok) — boyuttan
  bağımsız, fBm'in orta yığılmasını açar, net kıtalar.
- **Deniz seviyesi: sabit referanstan mutlak eşik.** REF bölge (falloff'suz)
  örneklenip percentile → eşik. Harita büyüse de kıyı sabit (`seaThresh`
  0.443, tüm boyutlarda aynı).
- **repair pass'i (erozyon):** SPIKE=0.028 (bir kademenin altında) ile
  tek-tile diken/çukur klamp + 3x3 hafif yumuşatma. Ayrıca voxelize sonrası
  5 pass "hiçbir kare komşusundan >1 kademe yüksek olamaz". **Sonuç: 0 kule**
  (rug 0.35–1.0, tüm seed'lerde).
- **de-speckle:** 1-tile adalar batar, 1-tile göletler dolar (koşullu).
- **Su hidrolojisi.** `grid.level` işaretli; su seviyesi kıyıda 0 (deniz
  düzlemi), kıyıdan uzaklık BFS'iyle dışa doğru kademeli alçalır
  (komşu su kareleri arası max fark = 1, düzgün). Kıyı land (level 1)
  artık sadece 1 kademe yukarıda → kule değil.
- **Nehirler.** Yerel yükseklik maksimumlarından steepest-descent ile
  denize/göle/kenara iz sürülür, vadilerden akar, `river` biyomu. Sayı
  harita alanı × `rivers` slider'ıyla ölçekli.
- **Göller.** Kenardan ocean flood-fill; ulaşılamayan su = `lake` biyomu.
- **2D bug:** `renderTopDown` canvas boyutu döndürmüyordu → `fitCam` NaN →
  transform uygulanmıyordu. Düzeltildi.
- **Boyut:** slider 128–512 (varsayılan 160). Büyük haritalarda top-down
  tile ve iso canvas budget otomatik küçülür.

**Hangi dosyalar değişti:** `src/generate.js` (yeniden yazıldı),
`src/biome.js` (+river/+lake), `src/grid.js`, `src/render/topdown.js`,
`src/render/iso.js`, `src/main.js`, `index.html`.

**Doğrulama:** `node --check` temiz. Headless — determinism 0, 0 kule,
su fark 1, ada büyüme davranışı, 512² gen ~340ms. Tarayıcıda (Chrome):
2D fit doğru, iso'da su baseni + nehirler + kademeli derinlik + kuleler
yok, ada modu 240²'de küçük ada + büyük okyanus (ekran görüntüsü), konsol
temiz, iso regen ~125ms, pan/zoom 0ms (CSS transform).

**Açık işler:** yakın tepe birleştirme (2 zirveyi tek dağa), nehir
genişliği/delta, iso hover, kamera döndürme, M3 fırça.

**Sonraki adım:** Uğur'un geri bildirimi.


## 2026-09-01 — M2 cila turu: perf, çeşitlilik, su derinliği, kamera

**Ne yapıldı:** Uğur'un M2 geri bildirimi — iso "kasıyor", 2D'ye de pan/zoom
gelsin, harita daha çeşitli olsun, iso yükseltileri çok düz, su da dağlar
gibi zeminin altına insin, harita boyutu değişsin (piksel sabit).

- **Perf: kamera artık CSS transform.** Eskiden her mousemove'da ~19MP canvas
  drawImage ile blit ediliyordu → jank. Şimdi harita bir kez tam çözünürlükte
  `#map`'e çiziliyor, pan/zoom = `map.style.transform = translate() scale()`
  (compositor, sıfır redraw — 200 yazım 0.2ms). Redraw sadece regenerate/
  view-switch/exag-değişimi. **Chrome GPU-accel eşiği** (~9-10MP) keşfedildi;
  iso canvas budget'ı `MAX_CANVAS_PX = 8e6` ile sınırlı, aşarsa tile küçülüyor.
  160² regen ~90-115ms.
- **2D + iso ortak kamera.** İkisi de sürükle-pan + tekerlek-zoom. Hover
  ekran→tile dönüşümü kamera transform'undan geçiyor (top view).
- **Su derinliği (Uğur'un isteği).** `grid.level` artık Int8 (işaretli):
  kara +1..+11, su -1..-3 (kıyıdan uzaklaştıkça derin). Iso'da su zeminin
  ALTINA oturuyor, kıyıda uçurum + deniz basen görünümü.
- **Yükseklik abartısı.** `levels` 8→10, `level = round(pow(landFrac,0.85)*
  levels)+1` (orta yükseklikler yayılıyor), iso `levelHeight = 13 * exag`.
  Yeni "Yükseklik abartısı (izo)" slider'ı (0.6–3, vars. 1.6).
- **Harita çeşitliliği.** 11→18 biyom (yalıyar/bataklık/çayır/çalılık/tayga/
  kızıl kaya/çıplak eklendi), classify yeniden yazıldı (daha çok dal).
  Eğim tabanlı yalıyar (dik kıyı = kaya). Sıcaklık modeline noise wobble +
  taban ısı (kutuplar daha az donuk). `SM.biomeShade` — nem/yükseklik/hash
  ile biyom-içi renk varyasyonu (büyük bölgeler düz görünmüyor).
- **Boyut.** Varsayılan 96²→160², slider 128–176 (piksel sabit, harita
  büyüyor). Iso `#map` tam iso extent'inde tek büyük canvas, offscreen yok.

**Hangi dosyalar değişti:** `src/biome.js`, `src/generate.js`, `src/grid.js`,
`src/render/topdown.js`, `src/render/iso.js`, `src/main.js`, `index.html`,
`css/style.css`.

**Doğrulama:** `node --check` temiz, headless — determinism 0, 18 biyom,
level -3..11, aralık dışı yok. Tarayıcıda (Chrome, localhost): perf ölçüldü
(pan 0ms, regen ~90ms, GPU eşiği doğrulandı), su basen görünümü + abartılı
yükseklikler + çeşitli biyomlar ekran görüntüsüyle onaylandı, konsol temiz
(eski koddan bir onHover NaN bug'ı çıktı, `!(a && b)` bounds check + `!b`
guard ile düzeltildi).

**Açık işler:** iso'da hover, kamera döndürme, M3 fırça, M4 animasyon.

**Sonraki adım:** Uğur'un geri bildirimi — sonra M3 (fırça) ya da iso cilası.


## 2026-09-01 — M2: izometrik voxel projeksiyon

**Ne yapıldı:** İzometrik görünüm eklendi. Panel'e Üstten/İzometrik toggle,
sürükle-pan, tekerlek-zoom (imlece doğru yakınlaşma). Grid aynı kaldı —
iso yalnızca ikinci bir projeksiyon.

**Hangi dosyalar değişti:** `src/render/iso.js` (yeni), `index.html`
(toggle + iso.js + isohint), `src/main.js` (view mode state, iso pan/zoom,
render routing), `css/style.css` (viewtoggle, `body.iso` modu).

**Neden bu yaklaşım:** Her tile 3 dörtgen (üst diamond 2:1 iso + W ve E yan
yüzleri, `1-|noise|` değil sabit gölge çarpanı 0.70/0.52 — low-poly ışık
hissi). Painter's algorithm = satır-major (y sonra x) döngü, standart iso
oryantasyonda arkadan öne doğru sıralıyor. Yükseklik = `grid.level + 1`
(su 0'da, kara en az 1 kademe yukarıda → her kıyıda 1 basamak uçurum).
**Statik bake:** tüm arazi bir kez offscreen `<canvas>`'a çizilir (~96²'de
tek seferlik maliyet), ekran `drawImage` ile pan/scale uygulayıp blit eder
— pan/zoom sırasında yeniden çizim yok, sadece blit. `regenerate` bake'i
geçersiz kılıyor (`iso = null`). Zoom drawImage ölçeğiyle (yeniden bake
yok); 64px tile'da bake, çoğunlukla downscale → keskin kalıyor.

**Doğrulama:** `node --check` tüm dosyalarda temiz. Tarayıcıda (Chrome,
localhost): top→iso toggle, iso render (voxel diorama, kar tepeleri, yan
yüz gölgeleri), sürükle-pan, tekerlek-zoom, top'a dönüş, iso'dayken random
seed → yeni harita re-bake — hepsi çalışıyor, konsol hatasız. Ekran
görüntüleriyle doğrulandı.

**Açık işler:** iso'da hover ile biyom okuma (ters projeksiyon gerekir),
kamera döndürme (4 yön), M3 fırça düzenleme, M4 animasyon.

**Sonraki adım:** M3 (fırça düzenleme) ya da iso görünümüne cila
(hover/döndürme) — Uğur seçecek.


## 2026-09-01 — M1 playtest geri bildirimi: kategorili panel + hover + dağlılık/deniz düzeltmesi

**Ne yapıldı:** Uğur M1'i denedi, üç istek geldi: paneli kategorilere ayır +
daha fazla parametre ekle, mouse map üzerindeyken biyomu göster, dağlılık ve
deniz seviyesi birbirinden ayırt edilemiyor — düzelt. Panel dört gruba ayrıldı
(Dünya/Yükseklik/İklim/Görünüm), beş yeni slider eklendi (Detay/octaves,
Sıcaklık eğilimi, Nem eğilimi — Dağlılık ve Deniz seviyesi zaten vardı ama
davranışları değişti). Canvas üzerinde mouse hover ile biyom/koordinat/
yükseklik/nem/sıcaklık okuma eklendi.

**Hangi dosyalar değişti:** `src/generate.js` (üretim hattı yeniden yazıldı),
`src/biome.js` (classify imzası landFrac'e geçti), `src/noise.js` (+`fbmRidged`),
`index.html`, `css/style.css`, `src/main.js`.

**Neden bu yaklaşım — asıl düzeltme iki gerçek bug'dı:**
1. **Deniz seviyesi artık yüzde tabanlı (percentile threshold).** Eskiden
   ham (min-max normalize) yükseklik değeriyle karşılaştırılıyordu; fBm
   toplamının dağılımı ortada yığılan bir çan eğrisi olduğu için slider'ın
   uçlarında (çok düşük/yüksek deniz seviyesi) görünür etkisi azdı. Artık
   slider DOĞRUDAN "haritanın yüzde kaçı su olsun" — üretilen haritada
   ölçülen kara% her zaman slider'la birebir eşleşiyor (test: sea=0.20 →
   %80 kara, sea=0.60 → %40 kara, tam isabet).
2. **Dağlılık artık ridged-noise karışımı, üstel değil.** Eski `mountainy`
   üssü normalize edilmiş yüksekliğe uygulanıyordu — deniz seviyesiyle aynı
   eksende çakışıyordu, ayırt edilemiyordu. Yeni `ruggedness` parametresi
   ikinci bir ridged fBm katmanını (`1-|noise|` katlanmış, sivri sırt
   görünümü) taban araziyle karıştırıyor. **Bulunan ikinci bug:** landFrac
   (dağ/kaya/kar eşiği) teorik maksimum 1'e göre normalize ediliyordu, ama
   ridge karışımı arttıkça haritanın GERÇEK tepe noktası hiç 1'e ulaşmıyordu
   (rugged=1.0'da gerçek max ~0.86) — yani dağlılık arttıkça kar/kaya sınıfı
   sessizce geriliyordu, tam tersi beklenenin. Düzeltme: landFrac artık
   haritanın gerçek ölçülen tepe noktasına göre normalize ediliyor.

**Doğrulama:** Node'da headless — sea level yüzdesi tam isabetli (3 değer
test edildi), determinism ve aralık kontrolü geçti. Tarayıcıda (Chrome,
localhost sunucu üzerinden): kategoriler render oluyor, hover okuması
doğru biyom/koordinat basıyor, dağlılığı 0.35→1.00 çekince harita görünür
biçimde parçalanıp sivrileşiyor (ekran görüntüsüyle doğrulandı), konsol
hatasız.

**Açık işler:** M2 (izometrik voxel), M3 (fırça düzenleme), M4 (animasyon).

**Sonraki adım:** M2 — izometrik voxel projeksiyon.


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
