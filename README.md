# StilizedMaps

Prosedürel, stilize harita üreteci. Dağ / ova / deniz / orman / çöl / tundra
biyomları noise'dan türetilir; harita hem **üstten** hem **izometrik voxel**
görünümüyle çizilir. Üretimden önce kurallarla ayarlanır, üretimden sonra
fırçayla düzenlenir. İzometrik görünümde animasyon (akan nehir, uçan kuşlar).

Vanilla HTML + CSS + JS. Framework yok, build adımı yok. Harita yüzeyi tek
`<canvas>` üzerinde çizilir; paneller normal DOM.

## Çalıştırma

`index.html` dosyasını tarayıcıda aç (çift tıkla). Yerel sunucu gerekmez.

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
>1 tırmanmaz, kule = 0) ve `--sweep` (7 deniz seviyesi — kara
monotonluğu, ada konsolidasyonu, determinizm). Ölçüm paketi: `docs/measurements/`.

## Milestone'lar

- [x] **M1 — Üretim + üstten görünüm.** Grid modeli, noise, biyom ataması,
  Canvas top-down render, parametre paneli, yeniden üret.
- [x] **M2 — İzometrik voxel projeksiyon.** `src/render/voxel3d.js` — WebGL2,
  gerçek 3D mesh, 360° orbit kamera (yaw/pitch/zoom, Q/E çeyrek tur snap),
  per-vertex AO, cast shadow, gün döngüsü. İşaretli yükseklik kademeleri (kara
  yukarı; deniz düz yüzey, derinlik renkle — 2026-09-22'ye kadar deniz baseni
  aşağı kademeliydi), "Yükseklik abartısı" slider'ı mesh'i
  yeniden kurmadan uygular. 18 biyom, eğim tabanlı yalıyar, biyom-içi renk
  varyasyonu.
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
