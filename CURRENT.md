# CURRENT.md

Sonraki ajanın okuduğu **ilk** dosya. Diff'ten okunamayan şeyi tutar: niyet.
Şablon ve doldurma kuralları için `handoff` skill'i. Eski oturum anlatıları
`docs/DEVLOG.md`'de (2026-10-18'de buradan taşındı).

---

**Güncellendi:** 2026-10-18
**Dal:** `master`
**Çalışma alanı:** temiz

> 2026-10-05: Proje StilizedMaps iken **Cartula** olarak yeniden adlandırıldı; canlı demo https://bilaxten.art/cartula/.

## Şu an

- **Durum:** M1-M4 bitti (README'deki beş milestone'un hepsi `[x]`). Canlı demo
  bilaxten.art/cartula (Vercel, `scripts/publish-site.sh`); canlı = `2991290` (kış karı).
  Vaka çalışması `bilaxten.art`'ta **canlı (2026-10-09)**; yalnız SES-TASLAK onayı Uğur'da.
- **Son commit'ler:** `ab1fa66` (izometrik dokunmatik ipucu: iki parmak yalnız zoom; A32
  bulgusu 1 kapandı) · `37c3cea` (skill'ler bu repoya göre kırpıldı) · `8fd55f7` (A32 cihaz
  kontrolü) · `1e02c8c` (P2 ada-sabitliği kapandı, DEVLOG 09-08..10-04 dolduruldu).
- **Doğrulama:** `bash scripts/checks.sh` → temiz (0 uyarı, 23 JS dosyası). Tarayıcıda yalnız
  `python scripts/serve.py 8000` (aşağıda).

## Açık kararlar / Uğur'dan beklenenler

- **Gözle bakış (gerçek GPU / telefon):** 2026-10-14 kışın kar yağışı (`61c6837`, tek başına
  `git revert` ile geri alınır) · 2026-10-13 kararlarından sonraki işler (sert gölge, iç
  denizler, şimşek bulutun arkasında, TR terimleri) · A32'de kar tanelerinin görünürlüğü,
  gölge/şimşek zevki, yosunlu göl, gerçek iki parmak. Ayrıntı: `TODO.md` NOW.
- **Ölçüm paketi görsel yarısı:** 3 seed × üstten/voxel PNG + orbit klip, `docs/measurements/README.md`.
- **İç deniz boyut eşiği** (256'da kenara değen sığ deniz kapanıp göl/kara oluyor): karar Uğur'da.
- **Kıyı köpüğü sonrası shader cilası** (outline, mesafe sisi): estetik karar, Uğur'la.
- **Unity export** 2026-10-19'da açıldı (`UNITY_EXPORT_ENABLED = true`), Unity 6'da doğrulanmıştı.
- Fırçalar yalnız üstten görünümde çalışıyor ama varsayılan açılış voxel: araç seçilince
  sekmeye otomatik geçmek düşünülebilir (karar verilmedi).

## Sonraki adım

1. `TODO.md` NOW'daki gözle bakış maddeleri (Uğur). Ajanlar için hazır iş yok; koda dokunmadan
   önce Uğur'un hangi maddeyi seçtiğini sor.
2. A32 bulgusu 2 (yükleme ~4,9 sn, üretim sırasında boş ekran): ölç, sonra karar.
3. Küçük, bağımsız: fırça sonrası komşu hücreler (`TODO.md` NEXT).

## Bu oturum — Galaxy A32 gerçek cihaz kontrolü (2026-10-18)

Kod değişmedi (bu bloğun yazıldığı oturumda). Telefon (Galaxy A32, Android 16, Mali-G52,
90 Hz mod) kablosuz adb ile Mac'e bağlandı; Jelly tarayıcısının WebView'ı (151) CDP ile
ölçüldü. Ekran görüntüleri ve ham sonuçlar: `docs/device-checks/2026-10-18-a32/`, madde:
`TODO.md` NOW başı (`8fd55f7`).

- **Cihazda doğrulandı:** sayfa yükleniyor, konsol hatası yok, yatay kaydırma yok; tek
  parmak sürükle döndürüyor; iki parmak açma yalnız zoom, iki parmak paralel sürükleme
  haritayı kaydırmıyor (CDP dokunuşu); kış (`season` 3) karlı tepe/buz; sert gölge (09:00
  yazda koyu yamalar, *Sun shadow* debug görünümü çalışıyor); gece şimşek 90 sn'de 2
  çakma, bulut altında bolt görünüyor.
- **Ölçüm (320², izometrik, yağmur/kar açık):** boşta 31-36 fps (p50 22 ms, p95 56-78 ms,
  1% düşük ~13 fps), kışta aynı; kare süreleri 90 Hz vsync'in (11,1 ms) katları. cpu 3-4 ms
  → darboğaz GPU. Panelde gpu zamanı yok (timer query yok).
- **Bulundu:** (1) izometrik dokunmatik ipucu bayat ("two fingers to pan · pinch to zoom",
  `hint.iso.touch` in `src/i18n.js`) — sonradan düzeltildi (`ab1fa66`). (2) Sayfa yüklemesi
  telefonda ~4,9 sn (üretim 320² sırasında ekran boş) — açık.
- **Uğur'un gözü gereken:** kar tanelerinin göze görünürlüğü, gölge/şimşek zevki, yosunlu
  göl (bataklık seed'i aranmadı), gerçek iki parmak.

## 2026-10-19 telefon bulguları (Uğur, gerçek telefon)

- İki parmak artık hem kaydırır hem yakınlaştırır (iki görünümde de; `src/main.js` touch bloğu,
  kilit/ölü bölge yok; parmak kalkınca kalanlar yine `dead`). `hint.*.touch` metinleri buna göre.
- Kar/yağmur parçacık asgari boyutu cihaz pikseli yerine CSS pikseli (DPR 2.6'da taneler
  0,6 CSS px'ti, görünmüyordu). Yosunlu göl karışımı `[0, .55, .9]` (eskiden `.35/.65`, mavi okunuyordu).
- Yayın (`publish-site.sh`) yapılmadı, Uğur'dan onay bekliyor. Yükleme ~4,9 sn: açılışta
  senkron 320² üretim (masaüstü node'da ~0,9 sn; A32 ~5x yavaş); düzeltilmedi.

## Görünüm mimarisi — TEK CÜMLE

**İzometrik = WebGL2 voxel. 2D = yalnızca üstten görünüm. Başka yol yok.**

Eski canvas izometrik renderer (`src/render/iso.js`) 2026-09-06'da SİLİNDİ (gerekçe:
`docs/DEVLOG.md`). ⚠️ **WebGL2 yoksa izometrik görünüm de YOK:** `refresh()` üstten
görünüme alır, `Isometric` sekmesini devre dışı bırakır ve sebebini yazar. `?renderer=iso`
kaçış kapısı kaldırıldı; `?view=top` hâlâ geçerli.

## Bilinen durum

**Tarayıcı doğrulaması: `python scripts/serve.py 8000`, başka bir şey değil.**

⚠️ `python -m http.server` KULLANMA ve `?cb=N` cache-buster'ına GÜVENME: query string
yalnız onu taşıyan dosyayı tazeler, `src/*.js` ayrı URL'dir ve Chrome onları saklar
(bu tuzak İKİ KEZ zaman yedi). `scripts/serve.py` `Cache-Control: no-store` gönderir.
Doğrulamayı ekran görüntüsüne değil ÖLÇÜME dayandır (`getImageData`, DOM sorgusu,
`window.__glShaderErrors`).
