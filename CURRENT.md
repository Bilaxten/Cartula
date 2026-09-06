# CURRENT.md

Sonraki ajanın okuduğu **ilk** dosya. Diff'ten okunamayan şeyi tutar: niyet.
Şablon ve doldurma kuralları için `handoff` skill'i.

---

**Güncellendi:** 2026-09-06
**Dal:** `master`
**Çalışma alanı:** temiz

## Şu anki görev

**Yok — M3 kapandı, kuyruğun başı Uğur'un kararını bekliyor** (`TODO.md` NOW).

## Bu turda ne oldu (2026-09-06)

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
- ⬜ M4 animasyonun kalanı — uçan kuşlar, bulut gölgesi

## Bilinen durum

**Depo:** `master`, temiz, `origin/master` ile senkron.

**Tarayıcı doğrulaması nasıl yapılır (2026-09-06'da bu şekilde yapıldı):**
yerel sunucu + cache-buster. `python -m http.server <port>` ile aç, sayfayı
`index.html?cb=N` ile yükle ve N'i her yeniden yüklemede artır — sunucu cache
header'ı göndermiyor ve Chrome HTML/CSS/JS'i agresif cache'liyor, yoksa eski
sürümü görüp "stale screenshot" sanırsın. Doğrulamayı ekran görüntüsüne değil
ÖLÇÜME dayandır (`getImageData`, DOM sorgusu); ekran görüntüsü yalnız "genel
görünüm doğru mu" için.

⚠️ Bu dosyanın eski sürümünde "file:// ile açılıyor, yerel sunucu gerekmiyor"
yazıyordu. Doğrulanmadı ve bu tur sunucuyla çalışıldı; `file://` yolunu
kullanacaksan önce kendin dene.

## Sonraki adım

Kod tarafında bekleyen bir iş YOK. Kuyruğun başı Uğur'un yön kararı
(`TODO.md` NOW): M4'ün kalanı (uçan kuşlar, bulut gölgesi) mı, yoksa
`bilaxten.art` için ilk vaka çalışması mı.

Küçük ve bağımsız bir cila maddesi de kuyrukta: fırçalar yalnız üstten
görünümde çalışıyor ama varsayılan açılış voxel — araç seçilince sekmeye
otomatik geçmek düşünülebilir (karar verilmedi).
