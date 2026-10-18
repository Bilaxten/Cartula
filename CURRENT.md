# CURRENT.md

Sonraki ajanın okuduğu **ilk** dosya. Diff'ten okunamayan şeyi tutar: niyet.
Şablon ve doldurma kuralları için `handoff` skill'i.

---

**Güncellendi:** 2026-10-14
**Dal:** `master`
**Çalışma alanı:** temiz

> 2026-10-05: Proje StilizedMaps iken **Cartula** olarak yeniden adlandırıldı; canlı demo https://bilaxten.art/cartula/ adresine taşınıyor.

## Bu oturum — Galaxy A32 gerçek cihaz kontrolü (2026-10-18)

Kod değişmedi. Telefon (A32, 90 Hz) kablosuz adb ile Mac'e bağlandı; Jelly
tarayıcısının WebView'ı CDP ile ölçüldü. Sonuçlar ve ekran görüntüleri
`docs/device-checks/2026-10-18-a32/`, ayrıntı `TODO.md` NOW başındaki madde.
Özet: yükleme/konsol/kaydırma temiz, dokunma kuralları tutuyor, kış, gölge ve
şimşek çalışıyor; 320² izometrikte 31-36 fps (GPU darboğaz). Açık: dokunma
ipucu metni bayat (`hint.iso.touch`).

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

## Görünüm mimarisi — TEK CÜMLE

**İzometrik = WebGL2 voxel. 2D = yalnızca üstten görünüm. Başka yol yok.**

Eski canvas izometrik renderer (`src/render/iso.js`, dört yönlü bake edilmiş
görüntü + rotasyon önbelleği + kendi bulut/duman/kuş/foam animasyonu) 2026-09-06'da
SİLİNDİ — "Faz 5" olarak planlanıp hiç yapılmamıştı. Toplam ~830 satır. Gerekçe:
voxel onu her açıdan ikame etti (360° kamera, AO, cast shadow, kendi gökyüzü
katmanı), hiçbir testi yoktu ve iki paralel bulut sistemi bakım yüküydü.

⚠️ **WebGL2 yoksa izometrik görünüm de YOK.** Geri düşülecek bir yol kalmadı;
`refresh()` görünümü üstten görünüme alır, `Isometric` sekmesini devre dışı
bırakır ve sebebini yazar. Sessizce üstten görünüm çizmek yanlış olurdu.
`?renderer=iso` kaçış kapısı kaldırıldı; `?view=top` hâlâ geçerli.

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

## Milestone durumu

- ✅ M1 üretim + üstten görünüm
- ✅ M2 izometrik voxel projeksiyon (2026-09-03'te WebGL2 voxel'e taşındı)
- ✅ Coğrafi kurallar tur 1+2
- 🔄 Animasyon kısmi — nehir dalgası, lav glow, gün/gece, kamera döndürme var
- ✅ **M3 fırça düzenleme (2026-09-06)**
- ✅ **M4 animasyon (2026-09-06)** — voxel bulutlar, bulut gölgesi, uçan kuşlar

## Bilinen durum

**Depo:** `master`, temiz, `origin/master` ile senkron.

**Tarayıcı doğrulaması: `python scripts/serve.py 8000`, başka bir şey değil.**

⚠️ `python -m http.server` KULLANMA ve `?cb=N` cache-buster'ına GÜVENME.
Query string YALNIZCA onu taşıyan dosyayı tazeler: `index.html?cb=5` HTML'i
yeniler ama `src/main.js` ve `src/render/*.js` ayrı URL'lerdir ve `http.server`
cache header'ı göndermediği için Chrome onları saklar. Tarayıcıda eski kodu
görüp "özellik çalışmıyor" sanırsın. Bu tuzak bu projede İKİ KEZ zaman yedi
(2026-09-02 saatlerce, 2026-09-06 M4 turunda üç tur). `scripts/serve.py`
`Cache-Control: no-store` gönderiyor ve sorunu kökten bitiriyor.

Doğrulamayı ekran görüntüsüne değil ÖLÇÜME dayandır (`getImageData`, DOM
sorgusu, `window.__glShaderErrors`); ekran görüntüsü yalnız "genel görünüm
doğru mu" sorusu için.

## Sonraki adım

**M1-M4 bitti, vaka çalışması `bilaxten.art` `site` dalında** (2026-09-22).
Kuyruğun başı: `TODO.md` NOW'daki gece düzeltmelerine gözle bakmak (2026-10-05).

Küçük ve bağımsız bir cila maddesi de kuyrukta: fırçalar yalnız üstten
görünümde çalışıyor ama varsayılan açılış voxel — araç seçilince sekmeye
otomatik geçmek düşünülebilir (karar verilmedi).
