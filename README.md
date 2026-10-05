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

**Pipeline adım adım modu** (panel → *Pipeline* → *Step through generation*):
mevcut haritanın ayarlarıyla üretim bir kez kayıtla yeniden koşulur
(`SM.generate(cfg, record)`) ve 10 aşama (`SM.PIPELINE_STAGES`: ham noise →
dağlar → deniz eşiği → iklim/biyom → kıyı → fiyort/volkan → nehirler →
riparian → yatak derecelendirme → voxel) slider / ◀ ▶ / ←→ ile gezilir.
Kayıtsız üretim ek maliyet ödemez; kayıt haritayı değiştirmez (`--geo` P6).

**Unity export — ⚠️ şimdilik kapalı** (Uğur 2026-10-05: *"şimdilik kapalı"*).
Arayüzde *Export for Unity (.zip)* düğmesi görünmüyor; kod yerinde duruyor ve
`--export` sınamaya devam ediyor. Geri açmak: `src/main.js`'te
`UNITY_EXPORT_ENABLED = true` — gizli satır (`#exportUnityRow`, `index.html`)
görünür olur ve düğme bağlanır, başka bir şey değişmez. `--export` bu bağın
kopmadığını da denetler. Özellik (açıkken): `src/export.js`, bağımlılıksız
STORE zip: `heightmap.r16` (16-bit LE RAW, 2ⁿ+1 — Unity *Import Raw*, satır 0 =
güney, flip yok), `albedo.png` (hücre başına 1 px), `biome.png` (R biyom, G
kademe, B su), `map.json` (deniz seviyesi, lejant, nehir/göl/yerleşim/şelale),
`README.txt` (içe aktarma adımları). Düzenlenmiş haritayı dışa aktarır.
Yükseklik örnekleri hücre MERKEZİNE oturur (`u·W − 0.5`), yani yükseklik
haritası hücre başına 1 px'lik dokularla aynı alanı kaplar: Terrain genişliği
= ızgara genişliği (m) verilirse tam 1 m/hücre.
Doğrulama: `node tools/headless.js --export` (köşe/yön, hücre-merkezi
hizası, CRC, zip dizini). ⚠️ Unity'de gerçekten içe aktarılmadı: satır yönü
("flip yok") ve bayt sırası yalnız kod tarafında tutarlı, motor içinde
denenmedi (`TODO.md`).

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

**Yeni harita (2026-10-05, Uğur):** iki düğme yan yana.
- *Regenerate* / *Yeniden üret* (kısayol `R`): yeni rastgele seed, slider ayarları korunur.
- *Random* / *Rastgele* (kısayol `Shift+R`): rastgele bir dünya tipinden başlar, her üretim
  slider'ını aralığının en fazla dörtte biri kadar oynatır (uçlardaki %10 dışarıda; deniz
  seviyesi 0.30–0.62, altında harita %80–90 kara çıkıyordu) ve yeni seed verir. Harita boyutu değişmez.

Fırça düzenlemelerini geri almak Edit → *Reset to generated*.

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

**Bulutlar fade in/out:** bulutlar haritaya girerken belirir, çıkarken solar
(`SM.Sky.cloudFade`); solma bulutun kendi erimi boyunca sürer, kenarı haritadan
çıkınca tamamen gitmiş olur (2026-10-05'e kadar iki yarıçap öteye uzuyordu,
uzun bulutlar haritanın yanında gri bir hayalet bırakıyordu). Başa dönme
noktasında opaklık tam 0, gölge de bulutla birlikte solar. Saydam voxel bulut
iki geçişle çizilir (önce yalnız derinlik, sonra en öndeki yüzey
karıştırılarak). `--sky`.

**Bulut çeşitliliği** (2026-10-05, Uğur: bulutlar birbirine benziyordu): her
harita kendi gökyüzünü haritanın **seed**'inden alır (`mesh.seed` →
`SM.Sky.cloudInstances`; eskiden her haritada sabit 1337). 4-6 bulut; her biri
1-3 elipsoit **lob**un birleşimi (ana gövde + yan kabarıklar), rüzgâr yönünde
(çoğu) ya da ona dik 1-2.1 kat uzun, 1-3 voxel katman kalın (büyük bulut daha
kalın, yan loblar daha alçak — kubbe tepe), farklı yükseklikte; yüksek bulut
biraz daha hızlı sürüklenir, yön ortak. Boyut ve yükseklik **tabakalı**
dağıtılır: her gökyüzü küçük kabarıklarla büyük kümeleri karıştırır.
**Gölge şekli bulutla aynı:** arazi shader'ı lob başına bir yumuşak elips çizer
(`uCloudLobes[18]` = 6 bulut × 3 lob, `SM.Sky.MAX_SHADOW_LOBES`). Mesh yalnız
dış kabuğu üretir (iki dolu voxel arasındaki yüz atlanır): 192²'de bulut
üçgeni 16 668 → ~5 500, 448²'de 96 660 → ~27 000. `--sky` denetler: 8 seed'de
hacim oranı ≥ 2.5, iki bulut aynı voxel şeklinde değil, kalınlık ve yükseklik
karışık, her seed farklı gökyüzü, her bulut sütunu gölge düşürür ve her gölge
çekirdeğinin üstünde bulut var, gövde arazinin üstünde ve `SM.Sky.ceiling`
altında, iç yüz çifti yok, üçgen sayısı eski bütçenin altında.

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

**Gece ışıkları + bloom** (2026-10-05): yalnız yerleşim voksellerinde
(`mesh.town`, `--night` denetler) 17:00-19:00 arası yanan, 5:00-7:00 arası
sönen sıcak pencereler (`SM.nightAmount`, `time.js`); çatıda 3×3, duvarda
sıra sıra, bloklu; piksel altına inince ortalamasına söner (pırıldamaz).
Renk biyom paletinden (çöl kumu, lavla ısıtılmış). Bloom: arazi 1/4
çözünürlükte "yalnız ışık" shader varyantıyla yeniden çizilir (tam derinlik,
tepe arkasındaki kasaba gizlenir), iki tur ayrılabilir Gauss, kanvasa
toplanarak eklenir; kamera durunca bulanık sonuç yeniden kullanılır.
Gündüz bunların hiçbiri çalışmaz ya da ayrılmaz; framebuffer eksikse bloom
kendini kapatır, ışıklar kalır. ⚠️ Işıklar yanarken gece renk düzeltmesi
CSS'ten (`#daynight` + filtre) shader'a geçer (aynı formül, fark ≤4/255):
CSS örtüsü WebGL'den SONRA uygulandığı için ışıkları gri-kahveye
boyuyordu; shader'da ışık düzeltmeden sonra eklenir. Gündüz yol CSS'te
kalır. Arazi shader'ı üç derlenmiş varyant (gündüz / gece / gece+pencere)
ve yerleşim üçgenleri index buffer'ın sonunda kendi aralığında: SwiftShader
dallanmanın iki tarafını da çalıştırdığı için ölü gece kodu gündüz ~18 ms
yiyordu.

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

**Yağmur ve kar** (2026-10-05; View → *Rain & snow*, varsayılan açık):
harita seed'inden 2-3 hava bölgesi; ilki haritada soğuk kara varsa ona,
diğerleri ıslak karaya (orman, yağmur ormanı, bataklık). Bölge içinde
parçacığın altındaki biyom karar verir: tundra/kar/tayga üstünde kar,
çöl/mesa/lav üstünde hiçbir şey, kalan her yerde yağmur. En çok 900
parçacık, harita başına tek statik buffer; düşüş vertex shader'da
zamandan hesaplanır (kare başına CPU işi ve yükleme yok). Kar, rüzgâr
çizgileriyle aynı hâkim rüzgârla sürüklenir (`--weather`).

**Varsayılan harita 320²** (2026-10-05, önceden 192²). Paylaşım linkindeki
`size` hâlâ kazanır, *Random* boyuta dokunmaz. Bedeli (seed 1337,
SwiftShader): üretim 396 ms (192²: 198), 362k üçgen (140k), GPU 184 ms/kare
(101). Enlem sabiti bilerek 192'den türetilmiş kalır (dünya-uzayı, boyuttan
bağımsız).

**Canlı demo:** https://bilaxten.art/cartula/ (GitHub Pages, `master`).

## Milestone'lar

- [x] **M1 — Üretim + üstten görünüm.** Grid modeli, noise, biyom ataması,
  Canvas top-down render, parametre paneli, yeniden üret.
- [x] **M2 — İzometrik voxel projeksiyon.** `src/render/voxel3d.js` — WebGL2,
  gerçek 3D mesh, 360° orbit kamera (yaw/pitch/zoom, Q/E çeyrek tur snap),
  per-vertex AO, cast shadow, gün döngüsü. İşaretli yükseklik kademeleri (kara
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
