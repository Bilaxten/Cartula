# CURRENT.md

Sonraki ajanın okuduğu **ilk** dosya. Diff'ten okunamayan şeyi tutar: niyet.
Şablon ve doldurma kuralları için `handoff` skill'i.

---

**Güncellendi:** 2026-09-06
**Dal:** `master`
**Çalışma alanı:** temiz

## Şu anki görev

**Yok — M1-M4'ün TAMAMI bitti ve eski 2D izometrik yol tamamen kaldırıldı
(2026-09-06).** Kuyruğun başı artık ilk vaka çalışması (`bilaxten.art`).

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

Kod tarafında bekleyen bir iş YOK. **M1-M4'ün tamamı bitti.** Kuyruğun başı
`bilaxten.art` için ilk vaka çalışması (`TODO.md` NOW) — kod değil anlatı işi.

Küçük ve bağımsız bir cila maddesi de kuyrukta: fırçalar yalnız üstten
görünümde çalışıyor ama varsayılan açılış voxel — araç seçilince sekmeye
otomatik geçmek düşünülebilir (karar verilmedi).
