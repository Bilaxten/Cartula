# DEVLOG

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
