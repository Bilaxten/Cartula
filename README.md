# Cartula

Formerly StilizedMaps (renamed 2026-10-05).

Prosedürel, stilize harita üreteci. Dağ / ova / deniz / orman / çöl / tundra
biyomları noise'dan türetilir; harita hem **üstten** hem **izometrik voxel**
görünümüyle çizilir. Üretimden önce kurallarla ayarlanır, üretimden sonra
fırçayla düzenlenir. İzometrik görünümde animasyon (akan nehir, uçan kuşlar).

Vanilla HTML + CSS + JS. Framework yok, build adımı yok. Harita yüzeyi tek
`<canvas>` üzerinde çizilir; paneller normal DOM.

## Çalıştırma

`index.html` dosyasını tarayıcıda aç (çift tıkla). Yerel sunucu gerekmez.

Tek istisna: bazı uygulamaların dahili tarayıcısı `file://` sayfasını statik
önizleme olarak gösterir — CSS/JS/görsel yüklenmez, sayfa çıplak HTML görünür.
Orada `python scripts/serve.py 8000` çalıştırıp `http://localhost:8000` aç
(önbelleksiz sunucu; `python -m http.server` değil).

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
7. **hydrology** — kıyıdan uzaklıkla düzgün su derinliği, yokuş-aşağı nehirler;
   denize/göle/kenara ulaşmayan küçük nehir parçaları budanır. **Yatak
   derecelendirme** (`gradeRiverBeds`): komşu nehir tile'ları arasında 2
   kademelik basamak kalmaz — yatak aşağı oyulur (ardışık basamaklar yukarı
   doğru bir boğaz açar); 3+ kademe tasarlanmış **şelale** olarak kalır
   ve voxel görünümde çizilir (düşen su yüzü: sütun başına fazlı, aşağı akan
   beyaz şeritler; iniş havuzunda köpük — `aFall`, doğrulaması
   `node tools/headless.js --falls`). Ağız
   oyucusunun çapraz kanallarından kalan tek-tile çukurlar doldurulur
8. **voxelize** — ayrık kademeler: kara +, **deniz düz bir yüzey (0) — derinliği
   geometri değil RENK gösterir** (`SM.seaColor`, `biome.js`: deniz tabanının
   gerçek derinliğinden 3 bant — paletin sığ/orta/derin mavisi — + kıyı tonu; iki görünüm ve editör
   aynı fonksiyonu kullanır), **tatlı su (nehir/göl) kendi yüksekliğinde +**; kule klamp.
   Yükseklik→kademe tek tanım: `SM.quantLandLevel` (`src/grid.js`), editör de
   aynısını kullanır. Ardından şelaleler son kademelerden GEOMETRİYLE
   etiketlenir (`SM.tagWaterfalls`, `grid.js`; editör her fırça/undo sonrası
   yeniden etiketler)
9. **yerleşimler** — düz, ılıman, tatlı suya yakın alanlar (topdown'da çizilir)

`decorations` bayrağı (varsayılan **kapalı**) yol / fantezi etiket
pass'lerini açar — **hiçbir renderer bunları çizmiyor**, o yüzden varsayılan
harita ürettiğini tam olarak gösterir ve bake ucuz kalır.

**Coğrafi vaatler kırmızı/yeşil property testlere bağlı** (`scripts/checks.sh`
koşturur): `node tools/headless.js --geo` (5 seed — deniz seviyesi monotonluğu,
kıtasal büyüme örtüşmesi ≥%92, her nehir bir çıkışa ulaşır, her nehir
kenarı ≤1 kademe ya da etiketli bir şelale — tek istisna, sayısı basılan göl
taşma eşiği (göl nehrin 2 üstünde; göller sabit çapa) —, nehir akış yönünde
>1 tırmanmaz, kule = 0, hiçbir kara hücresinin saklanan yüksekliği deniz
eşiğinin 0.06'dan fazla altında değil) ve `--sweep` (7 deniz seviyesi — kara
monotonluğu, ada konsolidasyonu, determinizm). Ölçüm paketi: `docs/measurements/`.

**İlk yükleme: worker + katman katman açılış** (`src/gen-worker.js`,
`src/genclient.js`, `src/intro.js`; `startIntro` / `adoptGrid`, `main.js`).
Sayfa hemen çizilir; ilk harita bir Web Worker'da üretilir (classic worker,
`importScripts` ile `noise → biome → grid → generate`: sayfayla aynı dosyalar,
aynı sıra — grid modeli tek doğru kaynak, pass'ler `generate.js`'te, hiçbiri
kopyalanmadı). Worker, `SM.generate`'in kayıt kancasıyla beş pass'i bitirdikçe
yollar (ham noise → dağlar → deniz seviyesi → iklim/biyom → nehirler) ve bitmiş
grid'i transfer eder. Ana thread her pass'i küçük bir karede (ekrana yetecek en
küçük tile) çizer ve lansman filmindeki gibi bir mürekkep çizgisi yukarıdan
aşağı süpürerek bastırır (280 ms süpürme + 50 ms bekleme; çizgi `--accent`,
yeni renk yok). Sıra: **noise → dağlar → deniz → biyom → nehirler → bitmiş
harita**. **Üstten görünümde** son kare gerçek `renderTopDown`. **İzometrikte
(varsayılan, insanların beklediği yer) animasyon 3B voxel dünyanın kendisinde**
(Uğur 2026-10-19: *"animasyon 3d voxel üzerinde olsun"*; *"render olmak zorunda değil"*),
aşağıda. **Atlama:** haritaya dokunmak / tuşa basmak, `regenerate()` (her slider/seed
değişikliği — eşzamanlı, animasyonsuz, intro iptal), `prefers-reduced-motion`
(worker yine kullanılır, pass istenmez, harita hazır olunca doğrudan çıkar).
Worker yoksa ya da başlamazsa (`file://`, engelli betik) aynı `SM.generate` ana
thread'de bir kare çizildikten sonra koşar (aynı grid, aynı animasyon).
**İzometrik yükleme animasyonu** (`startVoxelIntro`, `voxel3d.js` `setIntro` /
`setIntroSlab` / `setIntroImage`). Kamera tüm süre boyunca izometrik kalır. Sıra
(Uğur 2026-10-19: *önce düz renkli harita, sonra yükselti*): (0) **Plaka**: haritanın ayak izinde **neredeyse siyah (#131313)** düz bir voksel
plaka, üstünde **soluk açık gri hücre ızgarası** (koyu zeminde okunsun diye çizgiler
artık siyah değil: albedo'yu %30 açık griye (0,62) doğru karıştırır), alçak bir
**nefes** (kamera ± %0,6 sinüs); yalnız ilk ~450 ms. Izgara çizgileri
`INTRO_GRID_GLSL`: tam birimlerde çizgi, hücre birkaç pikselin altına inince ince ızgara
solar, her 4. ve 16. çizgi kalır. (1) **Düz haritayı boya**: harita *düz* haldeyken
renkler köşelerden ve kenarlardan gelir, boyanmamış bölge orta civarında kapanır ama
**daire gibi değil**: merkeze uzaklık önce büyük bir alçak frekanslı gürültüyle
**domain warp** edilir (±0,6), sonra geniş bir gürültüyle (±0,33) bükülür, en sonda
5 oktavlı fraktal (±0,2) kenarı pürüzlendirir (`introFront`). Kenar **sert ve kaba**:
bant ya da yumuşatma yok, **hücre merkezinde** değerlendirilip ilerlemeyle sert
eşikle (`step`) kıyaslanır, yani kenar voksel ızgarasını izler (mesh'te köşe başına
değil karo başına, plakada hücre başına, aynı fonksiyon ve aynı hücre; el
değiştirmede kenar kaymaz). Gürültü kayması harita seed'inden (aynı harita hep aynı
boyanır). Bütün renkler birlikte (su da yalnız mavi hücreler), ızgara bu sırada
görünür kalır; ön izleme görüntüleri yalnız boyanmış yerde görünür. Bitmiş harita
worker'dan gelene kadar renkler **worker'ın kendi pass'lerinden**: ham yükselti
(`sample`), kara/deniz (`sea`), biyomlar (`climate`) `SM.Intro.pixels` ile düz bir
RGBA görüntüye çevrilir (hücre başına bir texel), plakanın üstünde gösterilir ve
görüntüler birbirine 600 ms'de eriyerek geçer. Mesh gelince plaka kalkar, mesh aynı
görüntüden başlar (`uIntroImage`) ve 700 ms'de kendi renklerine erir; ışık da aynı
(düz tepede AO/gölge/dalga gölgesi yok, `uIntroLight`), yani el değiştirmede renk ya da
parlaklık sıçraması olmaz. (2) **Izgara söner** boya kapanırken (boya ve yükselişin başıyla bindirilmiş). (3) **Yükselti
boya bitmeden ~300 ms önce başlar** (kapanan lekenin üstünde, ölü boşluk yok),
**boyanın tersi sırayla**: en son boyanan yer (ortada kapanan leke) ilk yükselir,
boyanın başladığı köşeler ve kenarlar en son. Sıra aynı çarpık/gürültülü cephe
alanından türetilir (`order = ((1,5 - introFront) / 1,48)^1,5`: üs, orta bölgeden de
geniş bir alanın hemen kalkmasını sağlar; köşe noktasında değerlendirilir, komşu
kolonlar köşelerini paylaştığı için çatlak açılmaz); her kolonun kendi yükselişi
smootherstep (yayılma 0,62, kolon süresi 0,38·yükseliş; `introRiseScale`, geometri
yeniden kurulmaz). Sular
kendi seviyesinde kalır: kara denizin etrafında yükselir (deniz yüzeyi 0'da durur),
göl ve nehirler kendi zeminleriyle yükselir; ayrı bir su animasyonu yoktur. AO, gölge ve
dalga gölgesi yükselişle birlikte devreye girer; lav yükselirken parlar. (4)
**Bulutlar** merkezden kenara büyür (`uCloudGrow`). Çizelge (ilk boyadan, ms): boya
0-2400, ızgara 2000-2900, yükseliş 2100-3800, bulut 3300-4500. Yükseliş mesh ister:
zaman saati kapıda (`GATE` = yükselişin başı) düz ve renkli haritada nefes alarak
bekler. Yavaş cihazda saat kapıya kadar yavaşlar (en çok x0,4; her pass'in geldiği
an mesh varışını tahmin ettirir), yani bekleyiş renkli düz haritada geçer, renksiz
plakada değil. Bitişte uniform'lar kapanır ve değerler tam normal render'a iner.
**Mesh, gölge görüntüsü, rüzgâr alanı, hava ve duman worker'da kurulur**
(`SM.buildIsoExtra`). Seed bayt bayt aynı (üretim koduna dokunulmadı).
**Yeni harita da aynı animasyonla gelir**: *Random*, seed alanı (kapanınca/Enter) ve
dünya tipi seçimi eski haritayı bırakıp (`renderer.clearMesh`, eski rüzgâr/yağmur/
duman gizli) aynı animasyonu oynatır; slider bırakmaları anlıktır (tekrar tekrar
denenir), üstten görünüm ve `prefers-reduced-motion` de öyle.
Atla: dokun / tuş / `prefers-reduced-motion`; kameralı
paylaşım bağlantısı ve üstten görünüm eski yolda kalır.

Doğrulama: `node tools/headless.js --intro` — worker betiği sahte worker
kapsamında sürülür, grid ve pass kayıtları ana-thread çıktısıyla **bayt bayt**
aynı olmalı; oynatıcı sırası/atla/iptal; kablolama. Tarayıcıda gözle bakılması
gerekir (süpürme tuvalde çizilir).

**Pipeline adım adım modu** (panel → *Pipeline* → *Step through generation*):
mevcut haritanın ayarlarıyla üretim bir kez kayıtla yeniden koşulur
(`SM.generate(cfg, record)`) ve 10 aşama (`SM.PIPELINE_STAGES`: ham noise →
dağlar → deniz eşiği → iklim/biyom → kıyı → fiyort/volkan → nehirler →
riparian → yatak derecelendirme → voxel) slider / ◀ ▶ / ←→ ile gezilir.
Kayıtsız üretim ek maliyet ödemez; kayıt haritayı değiştirmez (`--geo` P6).

**Unity export — açık** (Uğur 2026-10-19; 2026-10-05'te kapatılmıştı, Unity 6'da
doğrulanınca yeniden açıldı). Arayüzde *Export for Unity (.zip)* düğmesi görünür
(TR/EN). Kapatmak: `src/main.js`'te `UNITY_EXPORT_ENABLED = false` — gizli satır
(`#exportUnityRow`, `index.html`) saklanır ve düğme bağlanmaz, başka bir şey
değişmez. `--export` bu bağın kopmadığını da denetler. Özellik: `src/export.js`, bağımlılıksız
STORE zip: `heightmap.r16` (16-bit LE RAW, 2ⁿ+1 — Unity *Import Raw*, satır 0 =
güney, flip yok), `albedo.png` (hücre başına 1 px), `biome.png` (R biyom, G
kademe, B su), `map.json` (deniz seviyesi, lejant, nehir/göl/yerleşim/şelale),
`README.txt` (içe aktarma adımları). Düzenlenmiş haritayı dışa aktarır.
Yükseklik örnekleri hücre MERKEZİNE oturur (`u·W − 0.5`), yani yükseklik
haritası hücre başına 1 px'lik dokularla aynı alanı kaplar: Terrain genişliği
= ızgara genişliği (m) verilirse tam 1 m/hücre.
Doğrulama: `node tools/headless.js --export` (köşe/yön, hücre-merkezi
hizası, CRC, zip dizini). Unity 6'da (6000.6.2f1) içe aktarılıp doğrulandı
(2026-10-19): satır yönü (satır 0 = güney, flip yok), bayt sırası (Windows) ve
1 m/hücre ölçek doğru; ayrıntı `TODO.md`.

**Render debug görünümleri** (View → *Render debug view*, yalnız izometrik):
aydınlatmanın tek bir terimini izole eder — ambient occlusion, normaller,
yükseklik (voxel kademe), albedo (ışıksız), güneş gölgesi, şelale yüzleri.
Tek `uDebugView` uniform'u, yalnız fragment aşamasında (çapraz-aşama
hassasiyet tuzağı yok); debug modunda gökyüzü çizilmez.

**Panel (2026-09-23 gözden geçirme, her slider 3 seed'de ölçülerek):**
*World type* hazır ayarları (Continents / Single island / Frozen / Arid /
Tropical — değerler ölçümle seçildi; slider oynatılınca *Custom*). Saf
ayarlar + eşleştirme mantığı `src/worldtypes.js`'te (`SM.WorldTypes`),
DOM'suz; doğrulaması `node tools/headless.js --worldtypes` (her ayarın
slider min/max/step aralığında olduğu, eşleştirmenin kendine döndüğü, bir
slider oynatılınca *Custom* okuduğu, her anahtarın paylaşılan link'e
girdiği, ve küçük bir haritada ölçülen etki — frozen/arid/tropical'in
beklenen biyom payını gerçekten değiştirdiği). *Sea
level* etiketi üretilen haritanın GERÇEK kara payını gösterir (eskiden
`1 − seaLevel` yazıyordu: "62%" dediği harita %70 karaydı). *Island* artık
karayı eritmez, merkezde toplar (deniz eşiği falloff'u hesaba katar; `--geo`
P7). *Moisture scale* kaldırıldı (en zayıf etki, %20-25). Temperature /
Rainfall / Rivers kelimeyle okunur; her slider'ın tooltip'i ne yaptığını söyler.

**Yeni harita (Uğur 2026-10-19):** tek düğme, *Random* / *Rastgele* (kısayol `Shift+R`):
rastgele bir dünya tipinden başlar, her üretim slider'ını aralığının en fazla dörtte biri
kadar oynatır (uçlardaki %10 dışarıda; deniz seviyesi 0.30–0.62, altında harita %80–90 kara
çıkıyordu) ve yeni seed verir. Harita boyutu değişmez. *Regenerate* kalktı: aynı kod zaten
her zaman aynı haritayı verir, yeniden kurmak bir şey değiştirmezdi.

Fırça düzenlemelerini geri almak Edit → *Reset to generated*.

**Seed haritanın tamamıdır** (Uğur 2026-10-19: *"ayarlar değişince seed de
değişecek, seed ayarları da temsil edecek"*). Seed tek bir kısa, kopyalanabilir
kod, tiresiz: `1k3m90bx74h2dq8wn5ztc`. İçinde rastgele taban (32 bit) **ve** her
üretim ayarı var: harita boyutu, deniz seviyesi, engebe, çarpıtma, yükselti
ölçeği, oktav, ada, sıcaklık/nem eğilimi, nehirler ve mevsim (54 bit, her
slider'ın adım indeksi olarak) + 14 bitlik doğrulama. `1` sürüm karakteri; alfabe
32 sembol (`i l o u` yok; `o`→`0`, `i`/`l`→`1`, `u`→`v` okunur, büyük/küçük harf
önemsiz; yapıştırılan kodun tire ve boşlukları atılır,
kod hiçbir yerde tireyle gösterilmez ya da yazılmaz). Mantık `src/seed.js`'te (`SM.Seed`), DOM'suz.
- Herhangi bir ayar değişince kod **hemen** değişir (slider sürüklenirken de).
- Koda yazmak/yapıştırmak: kod **alan kapanınca** (odak çıkınca, telefonda klavye kapanınca) ya da
  Enter'da uygulanır, her tuşta değil; o koddaki bütün ayarları kontrollere uygular ve haritayı üretir. Geçersiz kodda neden yazılır
  (boş, karakter, uzunluk, sürüm, doğrulama tutmadı, eski sayısal seed) ve hiçbir
  şey değişmez; mesaj TR/EN.
- Alanın sağındaki *Kopyala* düğmesi uygulanmış kodu panoya alır (taslak değil); güvenli
  olmayan bağlamda `execCommand` yedeği, ~1,5 sn "Kopyalandı" geri bildirimi.
- Yeni kodu yalnız *Random* verir (yeni taban + yeni ayarlar); aynı kod her zaman aynı haritadır
  (Uğur: "aynı seed aynı sonucu versin"). *Regenerate* düğmesi ve `R` kısayolu yok.
- Harita **kodun saf fonksiyonu**: aynı kod her seferinde, her üretimden sonra
  ve ayar → kod → çözümle → üret yolundan da aynı grid'i verir
  (`node tools/headless.js --seed`, grid'in her tipli dizisinin baytı üzerinden
  parmak izi). Üretim yolunda `Math.random`, `Date`, `performance`, sıra-bağımlı
  `for…in` yok; alt seed'ler `seed ^ sabit`. `Math.sin/cos/pow` motorlar arasında
  son bitte ayrışabildiği (V8, JavaScriptCore, SpiderMonkey) için üretim yolu
  `SM.dmath`'ı kullanır: yalnız `+ - * /` ve `sqrt` ile kurulu seriler
  (ECMAScript bu beşini birebir yuvarlanmış garanti eder), motora göre değişmez.
- **Eski sayısal seed'ler (`1337`) artık çalışmaz** (Uğur: gerek yok) ve `dmath`
  yüzünden aynı sayıdan eski harita da birebir çıkmaz. Eski paylaşım bağlantısı
  (`?seed=777&sea=0.5`) hâlâ açılır: sayı taban olur, bağlantıdaki ayarlar
  uygulanır. Yeni bağlantı yalnız `seed=<kod>` (+ görünüm: `view`, kamera,
  `isoexag`, `sun`) taşır; *Copy link*, indirilen PNG adı, Unity zip adı ve
  `map.json` (`seed`: kod, `seedBase`: sayı) aynı kodu kullanır.
- **Doğrulanan:** Node (V8) ve Edge (V8) aynı kod için aynı parmak izini verir.
  **Doğrulanmayan:** Safari/JavaScriptCore ve Firefox/SpiderMonkey bu makinede
  yok; üretim yolu yalnız garantili işlemler kullandığı için aynı çıkması
  beklenir ama ölçülmedi. Mevsim yalnız görünümdür: kodla taşınır, haritayı
  değiştirmez. Seed'siz kalan tek `Math.random`: *Random*'un yeni
  taban ve ayar seçimi (girdi üretir, harita değil). Sahne animasyonu (bulut,
  yağmur, rüzgâr, dalga) haritanın seed'inden doğar ama saate göre akar; aynı
  harita farklı karede farklı görünür, bu görünümdür.

> **Edit paneli şimdilik gizli** (Uğur 2026-10-13): kod ve testler duruyor; geri açmak için `src/main.js` içinde `EDIT_ENABLED = true`.

**Kamera kısayolları:** izometrikte sürükle = döndür, **Boşluk+sürükle** ya da
Shift+sürükle = kaydır, tekerlek = yakınlaş, Q/E = 90° snap. Üstten görünümde
sürükle = kaydır (*Pan* aracı); **Boşluk+sürükle her araçta kaydırır**, fırça
seçiliyken bile (2026-10-05). Boşluk basılıyken imleç el (grab / grabbing),
sayfa kaymaz, odaktaki düğme ya da kutucuk basılmaz; metin/sayı alanında ve
açılır listede Boşluk kendi işini yapar.
Alttaki açı çipinde, slider'ın solundaki **ortala** düğmesi kaydırmayı ve
yakınlaşmayı sıfırlar: harita yeni üretilmiş gibi bütünüyle kadraja girer
(`fitCamera`, gökyüzü dahil), açı (yaw ve eğim) korunur (2026-10-05).

**Yan panel ☰ ile küçülür** (Uğur 2026-10-05). Panelin sol üst köşesindeki ☰
düğmesi paneli kapatır ve açar; kapalıyken ekranda yalnız o kalır: aynı yerde,
aynı boyutta, yarı saydam (0.55) turuncu (`--accent`, Rastgele düğmesinin
rengi), üstüne gelince / odakta / dokununca tam opak. Harita yakınlaşsa ya da
kaysa da yerinden oynamaz (haritanın değil ekranın parçası); telefonda sayfa
iki parmakla büyütülse bile `visualViewport` ile geri ölçeklenir. Durum
`<html data-panel>`'de, ilk boyamadan önce `index.html`'deki satır içi betik
koyar: kayıtlı seçim (`localStorage` `sm-panel`), yoksa telefon boyutunda
kapalı, diğer her yerde açık. Geçiş 0.2 sn (`prefers-reduced-motion`'da yok),
kapalı panel `visibility: hidden` (sekme sırasından çıkar). Gerçek `<button>`,
`aria-expanded` + `aria-controls`, TR/EN etiket (*Paneli aç / kapat*). Panel
kayarken harita ortasını ve ekrandaki ölçeğini korur; WebGL karesi
`ResizeObserver` içinde aynı karede yeniden boyutlanıp çizilir (boş ya da
gerilmiş kare yok). `node tools/headless.js --layout`.

**Telefon düzeni** (Uğur 2026-10-05: *"mobilde kötü gözüküyor"*). Önceden
telefon düzeni hiç yoktu: 312 px panel yerinde durdu, 390 px telefonda haritaya
78 px kaldı (360 px'te 48 px), açı çipi 36 px'e ezilip ekrandan taştı.
Şimdi **kompakt ekranda** (`(max-width: 700px), (max-height: 500px)`; aynı
sorgu `index.html`, `main.js` `COMPACT_QUERY` ve `style.css`'te) harita bütün
ekranı alır, panel üstüne açılan bir çekmecedir (`min(340px, %100 − 48px)`):
yanındaki karartılmış haritaya dokunmak ya da Esc kapatır (açılır pencere
kuralı; masaüstündeki sabit panel açılır pencere değil, ikisini de yok sayar).
Her kontrol en az 44 px (☰, sekmeler, TR/EN, düğmeler, giriş alanları,
slider'lar, kutucuklar, grup başlıkları, çip düğmeleri); giriş alanları 16 px
yazı (iOS odakta sayfayı büyütmesin); çentik ve ev çubuğu için `safe-area`
boşlukları (`viewport-fit=cover`); yükseklik `100dvh` (adres çubuğu). Yatay
telefonda çekmecenin tamamı tek parça kayar. Masaüstü görünümü aynı kaldı:
başlık dışında piksel piksel aynı (başlık yüksekliği 88.75 px korundu).
`--layout` bu düzeni de denetler (kompakt blok silinince kırmızı).
Açı çubuğu (Uğur 2026-10-13: *"iconlar sliderın üstüne gelecek kadar
yaklaşmış"*) her ekranda tek bir grid: düğme | slider | açı | düğme. İki düğme
aynı boyda (telefonda 44 px yuvarlak, hapın içinde her yandan 4 px), boşluklar
sabit 10 px, açı yazısı sabit genişlikte (`4.5ch`), slider kalan yeri alır;
grid sütunları üst üste binemez. Telefonda çubuk safe-area boşlukları arasında
ortalanır (yatayda çentiğe girmez), en fazla 360 px.

**Dokunmatik gezinme** (Uğur 2026-10-05: *"zoom kötü çalışıyor"*). Önceden
haritada yalnız fare dinleyicileri vardı: telefonda tek parmak sürüklemek hiçbir
şey yapmıyor, iki parmak bütün SAYFAYI (paneliyle) büyütüyordu, kamera hiç
değişmiyordu. Şimdi `#stage`'de pointer olayları ve `touch-action: none`
(haritadaki hareketler uygulamanın; panelde sayfa yakınlaştırması erişilebilirlik
için açık): **tek parmak** = o görünümün fare sürüklemesi (izometrikte döndür,
üstten görünümde kaydır ya da seçili fırça), **iki parmak** = yakınlaş
(`SM.Touch`, `src/touch.js`, DOM'suz: parmakların altındaki harita noktası
parmakların altında kalır; 2026-10-19'dan beri kaydırma iki parmakla değil
*Kaydır* düğmesiyle, aşağıda). İkinci parmak tek parmak hareketini olduğu
yerde bitirir (300 ms'den genç fırça darbesi geri alınır: kıstırmanın başıydı);
kıstırmadan bir parmak kalkınca kalan parmak (2026-10-13'ten beri) **hiçbir şey yapmaz**, asla
döndürmez ya da boyamaz. Parmak kümesi her değiştiğinde hareket yeniden
tabanlanır, sıçrama yok. Üstten görünümde Pan aracıyla kısa dokunuş tile
kartını gösterir. iOS'un kendi `gesturestart`'ı engellenir. Dokunmatik
cihazda ipucu da dokunmatik (`hint.*.touch`). `--layout` matematiği koşar:
200 rastgele hareket, izometrikte panVector'dan bağımsız bir ortografik
izdüşümle.

**Kaydır düğmesi** (Uğur 2026-10-19, gerçek telefon: *"pan düzgün çalışmıyor,
direkt buton olarak yapar mısın"*). İki parmakla kaydırma (932ddbc) geri alındı;
yerine yalnız dokunmatik ekranda görünen (`@media (any-pointer: coarse)`, masaüstü
fare görmez) bir aç/kapa düğmesi: sağ üstte *Pan* / *Kaydır*, `aria-pressed`, açıkken
turuncu çerçeve (yeni renk yok). **Kapalı** (varsayılan): tek parmak o görünümün
kendi sürüklemesi (izometrikte döndür), iki parmak yalnız zoom. **Açık**: tek parmak
iki görünümde de haritayı kaydırır (izometrikte shift+sürükle yolu), ikinci parmak
bir şey yapmaz, yani zoom kapalı; tekrar basınca kapanır. İpucu (`hint.*.touch.pan`)
ve düğmenin başlığı duruma göre değişir. Gerçek ekranda doğrulandı (Edge dokunmatik
emülasyonu, CDP parmakları): kapalıyken kıstırma zoom yapar, açıkken yapmaz; açıkken
tek parmak üstten görünümde `#map` dönüşümünü, izometrikte kamerayı kaydırır ve yaw
değişmez.

**Gerçek telefonda kıstırma** (Uğur 2026-10-13, Galaxy S25 FE: *"çalışıyor ama
garip"*). Matematik doğruydu (parmak altındaki nokta CDP'de 0 px kayıyor);
garip olan hareketin etrafıydı. Gerçek parmaklar birlikte inmez: ilki 30-100 ms
önce iner ve kayar; izometrikte bu kayma **döndürmeydi** (412 px telefonda
0.87°/px). Kıstırmaların çoğu haritayı ekran ortası etrafında birkaç derece
çevirerek başlıyordu (CDP: 12 px kaymada yaw 10.5°, eğim 1.2°), parmakların
altındaki nokta kayıp gidiyordu, her yeniden tutuşta yine. İkinci parmak açı
çubuğuna denk gelirse kıstırmaya katılmak yerine slider'ı itiyordu (CDP: 160°).
Şimdi izometrikte tek parmak döndürmesi 8 px eşiği geçince, parmağın o anki
yerinden başlar (sıçrama yok); ikinci parmak inince 300 ms'den genç döndürme
fırça darbesi gibi geri alınır; harita hareketi sürerken açı çubuğuna inen
parmak haritanındır (dokunma olayları iptal: slider ve düğmeler onu görmez).
Kasıtlı döndürme (300 ms'den uzun) korunur, çubuk tek başına dokunmayla çalışır.

**İki parmak yalnız yakınlaştırır** (Uğur 2026-10-13, üçüncü deneme: *"kaydırma
olmasın, zoom in/zoom out yaparak çözeriz, iki parmak sadece zoom yapabilsin"*).
Önce kaydırıp zoom'u eşikle kilitleyen ara çözüm (aynı gün) telefonda kötü
hissettirdi, kaldırıldı. Şimdi iki parmak **yalnız zoom** yapar: parmakların
orta noktası kayınca harita kaymaz; zoom, kıstırmanın **başladığı** orta noktaya
sabitlenir (hareket boyunca değişmez) ve parmak arası oranını eşiksiz izler.
Başka yere gitmek için uzaklaşıp orada yakınlaşılır. Kıstırmadan bir parmak
kalkınca kalan parmak(lar) bütün parmaklar kalkana kadar **hiçbir şey yapmaz**
(sona doğru kazara kaydırma ya da döndürme yok). Tek parmak aynı: izometrikte
döndürür (8 px eşik, ikinci parmak inince 300 ms'den genç döndürme geri alınır),
üstten görünümde kaydırır. Sayfa yine hiç büyümez/kaymaz; hareket sürerken açı
çubuğuna inen parmak haritanındır. Oran önce bölünür: değişmeyen aralık tam 1.

**Bulutlar fade in/out:** bulutlar haritaya girerken belirir, çıkarken solar
(`SM.Sky.cloudFade`); solma bulutun kendi erimi boyunca sürer, kenarı haritadan
çıkınca tamamen gitmiş olur (2026-10-05'e kadar iki yarıçap öteye uzuyordu,
uzun bulutlar haritanın yanında gri bir hayalet bırakıyordu). Başa dönme
noktasında opaklık tam 0, gölge de bulutla birlikte solar. **Bütün bulutlar
yarı saydam** (2026-10-13, Uğur): açık hava bulutu 0.78 (`SM.Sky.CLOUD_ALPHA`),
hava bulutları kendi değerinde, hepsi solmayla çarpılır. Saydam voxel bulut
iki geçişle çizilir (önce yalnız derinlik, sonra en öndeki yüzey
karıştırılarak); iki saydam bulut üst üste binince uzaktaki önce çizilmeli, o
yüzden bulutlar (açık + hava) **tek tek, bakış yönünde arkadan öne
sıralanarak** çizilir, her biri kendi derinlik geçişiyle (`drawClouds`). Bedeli:
bulut çizim çağrısı 2 + 2×hava → 2×(açık + hava), en çok 18. `--sky`, `--weather`.

**Bulut çeşitliliği** (2026-10-05, Uğur: bulutlar birbirine benziyordu): her
harita kendi gökyüzünü haritanın **seed**'inden alır (`mesh.seed` →
`SM.Sky.cloudInstances`; eskiden her haritada sabit 1337). 4-6 bulut; her biri
1-3 elipsoit **lob**un birleşimi (ana gövde + yan kabarıklar), rüzgâr yönünde
(çoğu) ya da ona dik 1-2.1 kat uzun, 1-3 voxel katman kalın (büyük bulut daha
kalın, yan loblar daha alçak — kubbe tepe), farklı yükseklikte; yüksek bulut
biraz daha hızlı sürüklenir, yön ortak. Boyut ve yükseklik **tabakalı**
dağıtılır: her gökyüzü küçük kabarıklarla büyük kümeleri karıştırır.
**Gölge şekli bulutla aynı:** lob başına bir yumuşak elips (aşağıda: artık bir
dokuya çiziliyor). Mesh yalnız
dış kabuğu üretir (iki dolu voxel arasındaki yüz atlanır): 192²'de bulut
üçgeni 16 668 → ~5 500, 448²'de 96 660 → ~27 000. `--sky` denetler: 8 seed'de
hacim oranı ≥ 2.5, iki bulut aynı voxel şeklinde değil, kalınlık ve yükseklik
karışık, her seed farklı gökyüzü, her bulut sütunu gölge düşürür ve her gölge
çekirdeğinin üstünde bulut var, gövde arazinin üstünde ve `SM.Sky.ceiling`
altında, iç yüz çifti yok, üçgen sayısı eski bütçenin altında.

**Bulut tipleri** (2026-10-05 üçüncü tur, Uğur: *"daha farklı şekilde bulutlar
... yükseklik voxel sayısı farklı ... pofuduk bulutlar ... küçük küçük birden
fazla buluta sahip bulut kümeleri"*): her bulut seed'den bir **tip** alır
(`SM.Sky.cloudShape`); bir gökyüzünün ilk dört bulutu dört farklı tiptir:
- **stratus**: uzun, geniş, düz levha, 1-2 katman (yüksek kubbe alçaktan
  kesilir), yanında 1-2 levha;
- **kümülüs**: 1-2 katman düz taban üstünde 2-4 yuvarlak kule, en uzunu 4-6
  katman: düz alt, topak topak üst;
- **pofuduk**: küçük, yüksekliği genişliği kadar top, 1-2 tümsek;
- **küme**: 3-7 ayrı küçük kabarık, tek grup hâlinde sürüklenir (ilk üçü
  üçgende, diğerleri boş yer bulursa).
Hava bulutları ağır **nimbus** tipini kullanır (geniş 2 katman taban + 3-4
kule). Lob artık `top` (katman tavanı) da taşır; katman tavanı 3 → 6, lob
tavanı 3 → 7. Yalnız tam voxel, iç yüzler atlanır. Bulut üçgeni 320²'de
14-18k → 5-10k (bulutlar daha küçük ve çeşitli).
**Gölge artık doku:** lob sayısı arttı, arazi shader'ındaki lob döngüsü her
fragmanda koştuğu için (bir önceki turda ~7 fazla lob ~25-30 ms yemişti)
gölge JS'te yarım çözünürlüklü bir R8 dokuya çizilir (`SM.Sky.rasterShadow`,
lob başına aynı yumuşak elips, max ile birleşim) ve shader onu tek seferde
doğrusal okur; doku yalnız bulutlar/güneş/ölçek değişince yeniden çizilir.
`--sky`: her gökyüzünde dört tip, stratus 1-2 katman, kümülüs 4-6, pofuduk
en küçük, küme 3-7 değmeyen kabarık; dokunun her texel'i analitik elipslere
eşit (≤ 1/255).

**Arayüz dili: Türkçe + İngilizce** (2026-10-05). Panelin başlığındaki
*TR / EN* düğmeleri arayüzü yeniden yüklemeden, haritayı yeniden üretmeden
çevirir. Tek sözlük `src/i18n.js` (`SM.I18N`): `index.html`'deki metinler
`data-i18n` / `data-i18n-title` / `-aria-label` / `-placeholder` / `-alt`
kancalarıyla, main.js'in kurduğu metinler (slider değer kelimeleri,
istatistik, ipuçları, adım adım modunun aşama metinleri, biyom adları)
`T(key)` ile gelir; `data-i18n-js` "bu metni main.js yazıyor",
`translate="no"` "çevrilmez" (Cartula, TR / EN) demektir. Seçim
bilaxten.art'ın geri kalanıyla ortak: `localStorage` anahtarı `bx-lang`
(`tr` / `en`), kayıt yoksa İngilizce (2026-10-05'ten beri; önceden
tarayıcı diline bakıyordu). i18n.js `<head>`'de yüklenir, `<html lang>` ilk
boyamadan önce doğrudur. Dil değişince görünen metin bilaxten.art'taki gibi
~0.65 sn'de soldan sağa yeniden "yazılır" (harf başına `span`, yalnız
opaklık; sonra özgün metin düğümü geri konur, yerleşim kımıldamaz);
performans paneli ve hover kartı hariç, `prefers-reduced-motion`'da anında.

**Tema** (2026-10-05): kayıt yoksa koyu. Önce bilaxten.art'ın anahtarı
`bx-theme` okunur (aynı köken), sonra Cartula'nın eski `sm-theme`'i;
değişince ikisi de yazılır, site ile demo aynı temada açılır. Geçişte
arayüz renkleri 0.6 sn'de yumuşar (`html.theme-fade`), güneş/ay ikonu
sitedeki gibi birbirine döner, sahne arka planı iki katman olarak çapraz
geçer ve WebGL'in temizleme rengi aynı sürede ara renklerden geçer.
Çerçeve çizme animasyonu (sitedeki `html.redraw`) Cartula'da yok: buradaki
düğmeler köşe çerçevesi stilini kullanmıyor.
Dışa aktarılan dosyalar (PNG, Unity .zip, `map.json`, `README.txt`) veri
sayılır, İngilizce kalır; `biome.js` ve `PIPELINE_STAGES`'teki `label` /
`desc` İngilizce kaynak olarak durur. Doğrulama: `node tools/headless.js
--i18n` (iki dilde aynı anahtarlar, `index.html`'de kancasız görünür metin
yok, main.js'te DOM'a doğrudan yazılan metin yok).

**Performans paneli** (2026-10-05; *P* ya da View → *Performance panel*):
sahnenin sağ üst köşesinde son 120 çizilen karenin rAF aralığı (ortalama +
en kötü), FPS, `render()` içindeki CPU süresi, tarayıcı veriyorsa GPU süresi
(`EXT_disjoint_timer_query_webgl2`), son karenin çizim çağrısı ve üçgen
sayısı, GPU belleği **tahmini** (renderer'ın ayırdığı buffer/doku/
renderbuffer baytları + tuvalin çizim tamponu, MSAA sayısıyla). Sayım
kaynakta: renderer her `drawElements`/`drawArrays`/`bufferData`/doku
ayırmayı `src/perf.js`'teki sayaçtan geçirir; `--perf` `src/render/`'da
sayaçsız bir çağrı bulursa kırmızı. Panel kapalıyken kare başına hiçbir
şey ölçülmez ya da sayılmaz.

**Gece ışıkları + bloom** (2026-10-05; aynı gün iki tur daha, Uğur: *"bu
parlamalar ne ve neden lavlar parlamıyor? ... biz ev koymuyoruz ki niye
parlamalar var?"*, sonra *"hutları beğenmedim kaldıralım"*): geceleyin **yalnız
lav** ışır. Yerleşim tile'larındaki pencere noktaları kaldırıldı (orada ev yok);
aynı gün eklenip kaldırılan kulübelerin pencereleriyle birlikte pencere ışığı
kodu da (`aTown`, pencere varyantı) tamamen gitti. Lav ışıması gece varyantında
gece düzeltmesinden SONRA, 1.3 katı eklenir (eskiden düzeltmeyle kararıyordu)
ve bloom'a girer; ışık 17:00-19:00 arası güçlenir, 5:00-7:00 arası söner
(`SM.nightAmount`, `time.js`). Bloom: arazi 1/4 çözünürlükte "yalnız ışık"
varyantıyla yeniden çizilir (tam derinlik, tepe arkasındaki lav gizlenir);
kaynak renk değil MİKTAR yazar: R lav, G/B lav × nabız fazının cos/sin'i. İki
tur ayrılabilir Gauss, sonra kanvasa toplanarak eklenir; birleştirme nabzı
sin(wt+φ) = sin wt·cos φ + cos wt·sin φ ile bulanık kanallardan yeniden
kurar, yani her lav tile'ının halesi kendi tile'ıyla atar ama kaynak
zamandan bağımsız kalır: kamera durunca bulanık sonuç yeniden kullanılır
(`--night` 8-bit saklamayla hatayı ölçer: 0.002). Gündüz bunların hiçbiri
çalışmaz ya da ayrılmaz; framebuffer eksikse bloom kendini kapatır, lav
ışığı kalır.
⚠️ Işıklar yanarken gece renk düzeltmesi CSS'ten (`#daynight` + filtre)
shader'a geçer (aynı formül, fark ≤4/255): CSS örtüsü WebGL'den SONRA
uygulandığı için ışıkları gri-kahveye boyuyordu; shader'da ışık
düzeltmeden sonra eklenir. Gündüz yol CSS'te kalır. Arazi shader'ı
derlenmiş varyantlardan oluşur (gündüz / gece / bloom kaynağı; 2026-10-06'dan
beri ayrıca `RIVER` ve gerektiğinde `FOG` / `SEASON` birleşimleri, aşağıda):
SwiftShader dallanmanın iki tarafını da çalıştırdığı için ölü gece kodu
gündüz ~18 ms yiyordu.

**Kıyı köpüğü** (2026-10-05): deniz ve göl tile'larının üst yüzünde, karaya
değen köşede 1 olan köşe bayrağı (`mesh.foam`); komşu tile'lar köşeyi
paylaştığı için çizgi kesintisiz. Shader çeyrek adımlara keser (bloklu);
ne kadar açılacağını tile'ın dalga değeri belirler (tepe gelirken genişler).
Nehirlerde yok. Renk paletin kar tonu. Değer `vFallCoord` ile taşınır (su
üstünde kullanılmayan varying), yeni varying yok.

**Dalgalar araziye uyar** (2026-10-05, Uğur: *"terraine uyumlu şekilde
dalgalanıp sönümlenecek"*): harita başına karaya uzaklık alanı (iki geçişli
chamfer); faz = k·uzaklık + seed'li biraz gürültü, yani tepeler her kıyıya
doğru halkalar hâlinde ilerler. Genlik karaya değen yerde 0 (sönümlenir),
kıyıdan hemen açıkta tam, açık denizde sakin bir tabana iner. Değerler grid
KÖŞELERİNDE: bir köşedeki her vertex aynı sayıyı okur, ortak kenarlar
birlikte hareket eder (yarık yok). Tile merkezindeki değer tepe gölgesini ve
köpüğü sürer. Vertex başına 4 bayt (`mesh.wave`); `--mesh` denetler.

**Rüzgâr çizgileri** (2026-10-05; View → *Wind lines*, varsayılan açık):
cel-shaded oyunlardaki rüzgâr izleri gibi ince, iki ucu sivri, belirip
sönen açık çizgiler. Akış alanı harita başına (`src/render/wind.js`):
iki kez yumuşatılmış arazi, seed başına bir hâkim yön; dik yerde yokuş
yukarı payı atılır, kalan vadi eksenine (rüzgâra en yakın eşyükselti yönü,
hizalanmayla ağırlıklı) bükülür, biraz alçağa çekilir, biraz diverjanssız
curl noise. Simülasyon değil, vadi rüzgârlarının gözlenen davranışına benzeyen
bir sezgisel. Çizgiler durumsuz (seed, çizgi, zaman → konum), 64 × 24 nokta,
kare başına ayırma yok, zeminin en az 0.9 kademe üstünde (`--wind`).
Uğur'un ikinci turu (2026-10-05): **uzunluk hıza bağlı** — çizgi yolunun
sabit bir ZAMAN penceresini kaplar, yani uzunluğu = yerel hız × pencere;
hız alanı 0.32-1.35 (dik yamaç ve rüzgârı söndüren dümen yavaş, vadi tabanı
ve seed'li geniş esinti bölgeleri hızlı), uzun çizgiler kısaların ~3 katı.
**Ani dönüş yok** — alan iki kez daha geniş yumuşatılır, yol tile başına en
çok 14° döner, çizilen noktalar iki kez [1 2 1] ile yumuşatılır; harita
kenarında yol durur ve çizgi söner (eskiden kenar boyunca kayıp keskin
dönüyordu). `--wind` çizilen çizgilerin en keskin bükümünü ölçer
(≤ 18°/tile; önceki kod 1100°/tile üstü veriyordu). **Saniyede 12 güncelleme**
— zaman 1/12 s'ye kuantize, çizgi entegrasyon noktaları arasında kesirli
adımla kayar (önceden baş tam adım atlıyordu: saniyede 4.8); hâlâ zamanın
saf fonksiyonu, hâlâ "kare kare" bir el animasyonu görünümü.
Üçüncü tur (Uğur: *"rüzgarlar mapten çıkana kadar devam etsinler fade out
olmasınlar birden"*): **sabit ömür yok**. Her çizgi için harita başına 6 yol
önceden hesaplanır (seed'li doğuş noktası, akışla haritanın kenarına kadar,
sonra dümdüz dışarı) ve döngüyle oynatılır; bir neslin süresi = yol uzunluğu.
Çizgi doğarken 1 sn'de belirir, sonra kenardan çıkana kadar yaşar: kenarı geçen
her nokta 1.2 tile içinde kaybolur, yani çizgi kenardan "kayıp çıkar"; nesil
ancak bütün noktaları kaybolunca biter. 1100 adımda (~229 s) kenara
varamayan yol (kapalı havza, girdap) orada kesilir ve son 4 sn'de söner.
Kare başına iş azaldı (her karede yeniden entegrasyon yok: 0.25 → 0.03-0.05
ms), alan + yollar 320²'de ~150 ms (önce ~120), yollar ~1.7 MB. `--wind`:
başı haritadayken hiçbir çizginin alfası düşmez (durgun yollar hariç), her
nesil bittiğinde bütün noktaları kenarın 1.2 tile ötesindedir, 64 yuvanın
ortalama 63'ü görünür.

**Yağmur ve kar** (2026-10-05; View → *Rain & snow*, varsayılan açık):
harita seed'inden 2-3 hava bölgesi; ilki haritada soğuk kara varsa ona,
diğerleri ıslak karaya (orman, yağmur ormanı, bataklık). İkinci tur (aynı gün,
Uğur: *"yağmur ve kar yarı saydam bulutlardan yağsın"*): **her bölgenin kendi
bulutu var** ve bölge = bulutun ayak izi. Bulut, açık hava bulutlarıyla aynı
voxel lob yapısında (`SM.Sky.buildCloudMesh`) ama **yarı saydam** (yağmur 0.64,
kar 0.54: altındaki harita okunur; 2026-10-13'e kadar 0.58 / 0.48), daha alçakta
(geçtiği satır bandındaki en yüksek zeminin 4 kademe üstü) ve belirgin biçimde
daha gri: paletin kar beyazı kaya grisine karıştırılır — yağmur %62, kar %40
(2026-10-13, Uğur: açık hava bulutlarından belirgin gri olsun; önce %42 / %16);
yeni renk yok. Her parçacık bir
buluta ait, bulutun altından başlar, lobları içinde düşer, değdiği zeminde söner.
Hava bulutları (üçüncü tur, Uğur: *"yağış yapan bulutlar da daha yavaş şekilde
hareket edebilir diğer bulutlar gibi"*) açık hava bulutları gibi haritayı x
boyunca geçer ve aynı şekilde döner (bir kenarda söner, ötekinde belirir),
yalnız daha yavaş: açık hava bulutunun tipik hızının %40-60'ı (320²'de
~1.4-2.1 tile/s). t = 0'da bölgesinin üstündedir. Parçacıklar buluta bağlı;
bulut ve yağmuru aynı `SM.Weather.cloudsAt` sayısını okur, harita dışına
yağış düşmez, yağış bulutla birlikte söner. Şekli ağır **nimbus** tipi. Bulut hareket ettiği için altındaki
zemin değişir: vertex shader tile başına 2 baytlık küçük bir dokudan (seviye +
ne yağar) okur: tundra/kar/tayga üstünde kar, çöl/mesa/lav üstünde hiçbir şey,
kalan her yerde yağmur. **Mevsimle** (2026-10-14, Uğur: *"kar yağdıralım"*):
kışın, renderer'ın indirdiği kar çizgisinin altında kalan (mevsim kar miktarı
≥ 0.5, `SM.Season.tileAmounts`, aynı kural) ya da tatlı suyu donmuş tile'da
yağmur kara döner; çöl/mesa/lav kuru, deniz yağmurlu (donmuyor), soğuk
biyomlar zaten kar. Biyomun türü `baseKind`'da saklı; `SM.Weather.applySeason`
dokunun tür baytını ondan yeniden yazar ve katman *Season* slider'ı
**bırakılınca** tek `texSubImage2D` ile yükler (sürüklerken yalnız uniform;
320²'de ~2 ms). Bulutun kendisi kurulduğu türde kalır (rengi, saydamlığı;
şimşek yine yalnız yağmur bulutundan). **Gölge yok** (karar): bulut saydam ve altındaki
zemini zaten tonluyor; 0.6 güçte açık gölge denendi, arazi shader'ının lob
döngüsü her fragmanda koştuğu için SwiftShader'da 1280×800'de kare başına
~25-30 ms yedi, karşılığında bulutun yanına ikinci bir koyu leke koyuyordu.
*Rain & snow* kapalıyken bulut ve parçacıklar birlikte kalkar. En çok
900 parçacık, harita başına tek statik buffer; düşüş vertex shader'da
zamandan hesaplanır. Kar, rüzgâr çizgileriyle aynı hâkim rüzgârla biraz
sürüklenir (`--weather`).

**Akan nehirler** (2026-10-06, `src/render/flow.js`): nehirler, basamaklı
çağlayanların havuzları ve şelale diplerindeki havuzlar yokuş aşağı akar.
Bu haritalarda "nehir" kısa `river` parçaları + seviye seviye inen küçük
havuzlardan (settle pass'i geniş yayılmaları `lake` diye etiketliyor) oluşan
bir zincir; bu yüzden akış GEOMETRİDEN, **gövde** başına kararlaştırılır (tek
seviyede 4-komşulu tatlı su parçası): çıkışı (daha alçak su, deniz, harita
kenarı) olan gövde çıkışa BFS uzaklığı boyunca akar, havuzda giriş → çıkış en
kısa yoluna yakın kalır ve ondan 3 tile uzakta durulur; `lake` etiketli bir
tile yalnız suyun girdiği/çıktığı yere 3 tile yakınsa akar (büyük gölün ortası
durgun, deniz hiç akmaz). Çıkışı olmayan gövdede nehir tile'ları üretecin kendi
yokuş-aşağı adımını (`grid.flow`, orta hatlarda; genişletilmiş yatak en yakın
orta hattan kopyalar) kullanır. Şelale dudağı düşüşün üstünden akar; iniş
tile'ının 2 adım çevresi dışa doğru yayılıp köpürür. Akış hiçbir zaman kıyıya
ya da bir basamak yukarı koşmaz (o bileşen atılır). Hız eğimden: gövdenin
çıkıştaki düşüşü / uzunluğu. Değerler grid KÖŞELERİNDE, (W+1)×(H+1) RGBA8
doku (hız + köpük); durgun suya değen köşede hız 0, desen kenarda solar.
Çizim: akan tile'ların üst yüzleri indeks tamponunun SONUNA taşınır ve
`RIVER` varyantıyla ayrı çizilir (köşeler, vertex'ler, üçgen kümesi aynı; tek
fazla çizim çağrısı) — başka hiçbir fragman desenin bedelini ödemez. Desen
klasik çift fazlı flow map: çeyrek tile köpük benekleri + yarım tile
dalgacıklar akış boyunca taşınır, yarım döngü kaymış iki katman çapraz
geçişle sıfırlanmayı gizler; hız çeyrek tile blok başına bir kez okunur ve yol
tam bloklara yuvarlanır, benek hep bir blok (voxel ızgarasında, kesik değil;
rüzgâr çizgileri gibi "kare kare"). `--flow`.

**Volkan dumanı** (2026-10-06, `src/render/smoke.js`): en az 3 tile'lık her
lav alanı kraterinden (en yüksek lav tile'larının ortası; en çok 4) tüter.
Duman bulutların voxel dili: 18 eksen hizalı küp; doğar, yükselir (yavaşlayarak),
büyür ve KÜÇÜLEREK dağılır (solarak değil: hepsi tek opaklık, bulutların
derinlik-ön-geçişi sıralamasız çalışır). Rüzgâr, rüzgâr çizgilerinin kendi
alanı (`SM.Wind`), menfezde örneklenir: duman dik çıkar, yükseldikçe rüzgâr
yönüne yatar. Harita kenarını 1.5 tile geçen küp yok olur; tepe, kameranın
çerçevelediği gökyüzünün (`SM.Sky.ceiling`) altında kalır. Renk palet
karışımı: menfeze yakın kül (volkanik kaya → kaya grisi), yukarıda açık (kaya
→ kar); gece alçak küpler alttan lav rengiyle aydınlanır (gece düzeltmesinden
sonra eklenir, lav nabzıyla titrer). Harita başına tek statik buffer, yol
vertex shader'da zamanın fonksiyonu (rüzgârla aynı 12 Hz); lavsız haritada
hiç çizim yok. `--smoke`.

**Vadi sisi** (2026-10-06, `src/render/fog.js`): sabahları vadilerde, nehir
vadilerinde ve dağ eteğindeki alçak yerlerde sis. Yalnız *Time of day*
yönetir: şafakta (6:00-8:00) en kalın, öğleye doğru kalkar, öğleden sonra
yok, akşamüstü hafif (şafak sisinin 0.3'ü), 22:00'de biter, 2:30'dan şafağa
doğru yeniden yükselir; eğri süreklidir. Gece saatleri bilerek sissiz: gece
düzeltmesinin altında görünmüyor, varyantı SwiftShader'da kare başına ~5 ms
yiyordu. Nerede: tile başına bir sis yüzeyi = çevresi (iki kez geniş kutu
bulanıklığı, deniz 0) − 0.3 kademe; bunun altında kalan tile, ne kadar
alttaysa o kadar sisli (1.6 kademe altta tam yoğunluk 0.72). Sırtlar,
zirveler, düz yüksek arazi açık; deniz hiç sislenmez. Tile başına, bütün sütun
aynı (bloklu): ilk sürüm sisi vertex yüksekliğine göre veriyordu, her kıyı
yarının dibine sissiz denize inen beyaz bir perde çıktı. Çizim: `FOG` varyantı
tile'ın sisini R8 dokudan vertex aşamasında okur, rengi (paletin karı,
gün ışığıyla kısılmış) renk düzeltmesinden ÖNCE karıştırır (sabahın altın
tonu, gecenin mavisi uygulanır). Varyant saat ilk kez sis getirdiğinde
derlenir, yalnız sis varken kullanılır: öğleden sonra bedava. `--fog`.

**Şimşek** (2026-10-06, `src/render/lightning.js`; 2026-10-13 elden geçti,
Uğur: daha parlak, çok hafif sarsıntı, yıldırımın buluttan yere düştüğü
görünsün): yağmur bulutları (kar bulutu asla; yalnız *Rain & snow* açıkken)
arada bir çakar. Önce **iniş** (130 ms): bloklu yıldırım (ızgara eksenleri
boyunca dikey düşüşler + kısa yatay kırıklar, bir yan dal) bulutun altından
zemine kademe kademe uzar (shader cephenin altını kırpar), bulut hafifçe
parlamaya başlar; zemine henüz ışık düşmez. **Varış**ta çakma yerinin çevresi
yukarıdan aydınlanır (en çok +0.9), bütün harita bunun %40'ını alır, vuruş
noktası ~2.5 tile'lık bir parlamayla yanar (`uFlashHit`), bulut parlar (renk
×2.3'e kadar), görüntü birkaç piksel sarsılır (eksen başına en çok 3 CSS px,
250 ms'de söner; ortho izdüşümün kırpma uzayında kaydırma, kamera ve seçim
etkilenmez). İki nabız: vuruş ve 0.16 sn sonra daha zayıf bir ikinci vuruş;
yıldırım her nabızdan sonra 90 ms tam kalır, 140 ms'de solar (vuruştan ~0.5 sn
sonra yok). Yıldırım bulutun ARKASINDA çizilir (saydam bulut önünden geçer).
Seyrek ve sakin: zaman 12 sn'lik dilimlere bölünür, dilimde seed'li 0.42
olasılıkla, dilim başından en az 3 sn sonra bir çakma — dakikada en çok 5,
ortalama ~2, hiçbir saniyede ikiden fazla parlama yok, her nabız 0.1 sn'nin
altında söner. `prefers-reduced-motion`'da ışık parlaması, vuruş parlaması,
bulut parıltısı ve sarsıntı yok (yıldırım, inişiyle, kalır). Durumsuz: çakma
(harita seed'i, hava, zaman)'ın saf fonksiyonu, kare başına birkaç hash,
ayırma yok; arazi shader'ında iki uniform (`uFlash`, `uFlashHit`, lambert
terimine eklenir). `--lightning`.

**Mevsim** (2026-10-06, `src/render/season.js`; View → *Season*, TR
*Mevsim*): ilkbahar / yaz / sonbahar / kış, sürekli slider (0..3). Yalnız
görünüm: hiçbir biyom, kademe ya da seed değişmez; *Random*
ona dokunmaz (harita boyutu gibi); paylaşım linkinde *Time of day* gibi
taşınır. İlkbahar ve yaz üretilen harita. Sonbahar: yaprak döken orman
(`forest` biyomu; tayga ve yağmur ormanı yeşil kalır) her tile kendi tonunda
paletin savan sarısı ile mesa pası arasına döner; derin kışta yapraklar
dökülmüş, orman çıplak (paletin `bare` kahve-grisine doğru). Kış kar çizgisini
indirir: her kara tile'ının bir kar İHTİYACI var (yüksekliği, üretecin kendi
sıcaklığa bağlı kar çizgisinin ne kadar altında; `biome.js classify`), kış
çizgiyi kara yükseklik aralığının en çok 0.3'ü kadar indirir: önce zirveler,
sonra yüksek ve soğuk arazi (varsayılan haritalarda karanın ~%20-30'u). Lav
asla karlanmaz. Kış miktarı × 0.4'ten soğuk tatlı su donar: palet buzu
(kar → sığ deniz), dalga gölgesi, kıyı köpüğü, akış yok, şelale donuk.
Geometrik dalga çukuru bırakıldı (tatlı suda çok küçük; tile başına durdurmak
donmuş ve açık suyun köşe paylaştığı yerde yarık açardı). Çizim: tile başına
RGBA8 doku; `SEASON` varyantı vertex aşamasında okuyup `vColor`'u orada
yeniden boyar (fragman başına SwiftShader'da kare başına ~10 ms daha
pahalıydı), slider yazdan ilk çıktığında derlenir, yalnız yaz dışında
kullanılır. Üstten görünüm JS ikizini (`SM.Season.tileColor`) boyar, slider
bırakılınca yeniden çizer; Unity albedo'su mevsimsiz kalır. `--season`.
Kışın karlı zemine yağmur değil kar yağar (2026-10-14; *Yağmur ve kar*
paragrafı, `--weather`).

**Yosunlu göller** (2026-10-13, `grid.js tagMossyLakes`, `biome.js lakeColor`):
bataklığın (`marsh`, haritanın tek sulak alan sınıfı; yağmur ormanı dahil
değil) yanındaki göl tile'ları yeşilimsi, yosunlu bir ton alır. Kural, son
biyomlardan, rastgelelik yok (seed başına aynı): Chebyshev uzaklığı en çok 2
olan göl tile'ı tam, en çok 4 olan hafif; küçük göl (≤150 tile) tam bir
tile'a sahipse bütünü en az hafif (bataklıktaki gölet bütünüyle yosunlu, büyük
göl yalnız bataklık kıyısında). `grid.moss` (0/1/2) üretimin sonunda
şelalelerle birlikte etiketlenir, fırça ve geri alma yeniden etiketler. Renk
yeni bir aile değil: paletin Göl'ü paletin Bataklık'ına doğru %35 / %65.
İki görünüm de `SM.lakeColor`'dan okur; mevsimin buzu üstüne biner (donma
yalnız *Season*'a bağlı), akış benekleri ve şelaleler tabanın üstünde çalışır.
Maliyet üretimde ~3 ms (320²), karede sıfır. `--season`.

**Varsayılan harita 320²** (2026-10-05, önceden 192²). Paylaşım linkindeki
`size` hâlâ kazanır, *Random* boyuta dokunmaz. Bedeli (seed 1337,
SwiftShader): üretim 396 ms (192²: 198), 362k üçgen (140k), GPU 184 ms/kare
(101). Enlem sabiti bilerek 192'den türetilmiş kalır (dünya-uzayı, boyuttan
bağımsız).

**Canlı demo:** https://bilaxten.art/cartula/ (Vercel, bilaxten.art üzerinden).

## Milestone'lar

- [x] **M1 — Üretim + üstten görünüm.** Grid modeli, noise, biyom ataması,
  Canvas top-down render, parametre paneli, yeniden üret.
- [x] **M2 — İzometrik voxel projeksiyon.** `src/render/voxel3d.js` — WebGL2,
  gerçek 3D mesh, 360° orbit kamera (yaw/pitch/zoom, Q/E çeyrek tur snap),
  per-vertex AO, cast shadow (2026-10-13'ten beri sert: tile başına tam
  gölge ya da tam ışık, occluder ışını bir tam voxel aşmalı), gün döngüsü. İşaretli yükseklik kademeleri (kara
  yukarı; deniz düz yüzey, derinlik renkle — 2026-09-22'ye kadar deniz baseni
  aşağı kademeliydi), "Yükseklik abartısı" slider'ı mesh'i
  yeniden kurmadan uygular. 18 biyom, eğim tabanlı yalıyar, biyom-içi renk
  varyasyonu. Su yüzeyi dalgayla yalnız **aşağı** iner (`SM.VOXEL_WAVE_DIP`);
  suya bakan her duvar o çukurun altına kadar uzanır (etek), bu yüzden dalga
  hiçbir yerde arka planı gösteren yarık açmaz (`--mesh` denetler). Su
  tile'ları tepe/çukura göre tile başına açılıp koyulaşır. 2026-10-05'ten
  beri dalga araziye uyar (aşağıda *Dalgalar*).
  ⚠️ **2026-09-06:** bu iş önce canvas 2D'de (`src/render/iso.js`, dört yönlü
  bake edilmiş görüntü) yapılmıştı; WebGL yolu onu ikame edince eski renderer
  ve tüm yardımcıları SİLİNDİ (~830 satır). **2D olarak yalnızca üstten görünüm
  var.** WebGL2 yoksa izometrik görünüm de yok — geri düşülecek yol bırakılmadı,
  durum kullanıcıya açıkça söyleniyor.
- [~] **Coğrafi kurallar.** Dünya-uzayı örnekleme, sıradağ fay hatları, zirve
  baskınlığı, yağmur gölgesi/orografik, kıta sahanlığı, dendritik nehirler +
  vadiler, göller + taşma. **Tur 2:** platolar, fiyortlar, kıyı okları/lagünler,
  deltalar/haliçler, karasallık, riparian yeşillik, volkanik koniler + lav,
  takımada konsolidasyonu (su artınca ada sayısı düşer → tek adaya iner).
- [x] **Animasyon (kısmi).** Voxel-küp nehir dalgası (yüksekten alçağa akış),
  lav glow, üstten görünüm nehir parıltısı. `#riverfx` overlay + occlusion cull.
  İso yönlü gölge + harita border/plinth.
- [x] **M3 — Düzenleme.** Yedi fırça aracı: Raise / Lower / Smooth (yükseklik),
  Water / Land (kıyı), **Draw river** (dar kanal, yatağı banklarının altına
  oyar), Paint biome. Fırça boyu 1-12, güç 0.1-1, canlı fırça imleci,
  Undo / Redo / Reset to generated. Yalnız üstten görünümde çalışır; düzenleme
  sonrası yalnızca değişen hücreler yeniden çizilir.
  Nehir planlayıcısı saf: `SM.planRiverChannel` (`src/grid.js`), doğrulaması
  `node tools/headless.js --river`. Fırça sonrası yeniden türetme de saf:
  `SM.deriveEditedTile` — tatlı su yükseklik fırçalarında tatlı su kalır, deniz↔kara
  yalnız fırçanın yönünde eşik GEÇİLİNCE değişir (sahili yükseltmek su basmaz),
  doğrulaması `node tools/headless.js --edit`.
- [x] **M4 — Animasyon (kalan).** Voxel görünümünde gerçek geometri olarak
  sürüklenen **voxel bulutlar**, araziye düşen **bulut gölgesi** (arazi
  shader'ında, hücre-UV uzayında) ve kanat çırpan **uçan kuşlar** (yörünge ve
  çırpma tamamen vertex shader'da). Gündüz/gece ve kamera döndürme daha önce
  gelmişti. `Clouds & birds` anahtarı görünürlüğü, `Terrain animation` hareketi
  yönetir. Saf katman: `src/render/sky.js`, doğrulaması
  `node tools/headless.js --sky`.

## Bağlam

Bilaxten technical artist portfolyosunun parçası. Yazımı: her milestone bir
breakdown notu (`docs/DEVLOG.md`) → sonra bilaxten.art'ta vaka çalışması +
WebGL/Canvas gömülü demo.
