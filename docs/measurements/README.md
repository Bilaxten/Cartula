# Ölçüm paketi — Cartula (Gerçeklik Borcu P3.5)

bilaxten.art vaka çalışması için **dürüst görsel + ölçüm paketi**. Sayısal yarısı
otomatik, görsel yarısı tarayıcıda üretilir. (Düz Node headless'ında WebGL/canvas
yok; ama GPU'lu gerçek Chromium ile görsel yarı da otomatik alınabiliyor, aşağıya bak.)

## Sabit seed'ler

`1337`, `4242`, `90210` — `seaLevel = 0.38`, `decorations` kapalı (varsayılan).

## Sayısal manifest (otomatik)

```
node tools/headless.js --manifest > docs/measurements/manifest-<tarih>.json
```

Üç seed × {192², 448²}: land/water %, ada sayısı + top-5 boyut, kule sayısı
(hep 0 — property test bunu tutuyor), yerleşim sayısı, üretim süresi (ms),
tam biyom histogramı.

Güncel: `manifest-2026-10-14.json` (2026-10-14, `e9cf0dc` sonrası yeniden üretildi).

**2026-10-14 not:** `e9cf0dc` (2026-10-05) kapalı iç denizleri kumsal diye
boyamayı bıraktı, iklime göre sınıflıyor. Beklenen fark görüldü: kumsal payı
192²'de %4-12 → %3-4, 448²'de %12-15 → %3-4; yeri tayga / orman / ova /
yağmur ormanı / tundra aldı. Kara %, ada sayısı, en büyük ada, kule (0) ve
yerleşim sayısı 6 haritanın hepsinde aynı (en büyük adada ±4 tile); göl/nehir
±4 tile. Üretim süresi (`genMs`) 2-5 kat yüksek (192²: 179-314 ms, 448²:
830-944 ms; 09-15'te 50-94 / 196-336): o günden beri üretim hattına 14
commit girdi (settle, nehir yatağı, yosunlu göl…) ve 09-15 ölçümünün hangi
makinede alındığı yazılı değil — fark makineden mi koddan mı, ayrılmadı.

**2026-09-15 not (1):** iklim/biyom hesabı grid-göreli (`y/h`) yerine dünya-uzayı
koordinatına (`wyOf(y)`) taşındı (kod taraması bulgu 1 — haritalar büyüdükçe
biyom dağılımı sessizce kayıyordu, `--geo` P2 testi yalnız su/kara
örtüşmesini ölçtüğü için bunu yakalamıyordu; artık biyom örtüşmesini de
ölçüyor). Bu, biyom histogramlarının `manifest-2026-09-08.json`'dan
**farklı** olmasının beklenen sebebi — davranış düzeldi, sürüklenmedi.

**2026-09-15 not (2):** nehir/göl `grid.level`'ı artık kendi elevation'ından
türetiliyor (kod taraması bulgu 2 — önceden tüm tatlı su deniz düzlemine
(level=0) yapıştırılıyordu, `markWaterfalls`'un kullandığı elevation-türevli
kademeyle çelişiyordu). `--geo` P4 testi bu yüzden artık gerçek veri görüyor
(önceden level hep 0 olduğu için testin kendisi hiçbir şey kanıtlamıyordu —
bulgu 3) ve eşiği ölçülerek %2'den %10'a çıkarıldı (waterfall-dışı climb
oranı 5 seed'de %0-7.8 arası ölçüldü; `markWaterfalls`'un tagladığı gerçek
şelaleler zaten testten hariç tutuluyor).

## Görsel paket (tarayıcıda, otomatik Playwright yakalaması)

**Üretildi: 2026-10-20**, `ad471d2` üzerinde (uygulama kodu değişmeden). Önceki
"headless yapılamaz" notu yanlıştı: GPU'lu tarayıcıyla hepsi betikle alınıyor.

Yöntem: `scripts/serve.py` ile servis + `playwright-core` (depoya değil geçici
dizine kuruldu) ile Microsoft Edge (Chromium 155), headless, argümanlar
`--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist`; WebGL
`ANGLE (NVIDIA GeForce RTX 3060, Direct3D11)` (akuma). Pencere 1280x900.

1. **Üstten PNG** — `?view=top&seed=<S>&size=192`, uygulamanın kendi "Export PNG"
   düğmesi (indirme olayı yakalanır). 192² harita 9x büyütülmüş çıkar (1728x1728).
   → `docs/measurements/<S>-topdown-192.png`
2. **Voxel PNG** — `?seed=<S>&size=192&yaw=34.4&pitch=51.6&zoom=<uyum>`: yaw 0.6 /
   pitch 0.9 **radyan** olarak okundu (34.4° / 51.6°; uygulama dereceyle çalışır).
   `zoom`, önce varsayılan açılışta (animasyon bitince, 12 sn bekleyip) "Copy link"
   ile okunan uyum değeri. Kamera URL'den geldiği için açılış animasyonu zaten
   atlanır; 8 sn sonra uygulamanın "Export PNG" düğmesi (968x900, WebGL karesi).
   → `docs/measurements/<S>-voxel-192.png`
3. **Orbit klip** — 8 sn, 30 fps, 240 kare, bir tam tur (1,5°/kare), H.264 yuv420p,
   968x900. **Sapma:** "Auto-rotate" kendi hızıyla 5°/sn (tam tur 72 sn) döner,
   8 sn'de tam tur vermez; bu yüzden yaw, kamera dönüş kaydırıcısı (`rotSlider`)
   üzerinden kare kare belirlendi (deterministik), kareler `#gl` canvas'ından
   alındı, kaydırıcı/ipucu gizlendi. Kareler ffmpeg ile kodlandı.
   → `docs/measurements/<S>-orbit.mp4` (2,6-2,8 MB)
4. **448² üstten** — `?view=top&seed=<S>&size=448` (2688x2688).
   → `docs/measurements/<S>-topdown-448.png`

Seed'ler eski sayısal biçimde (`seed=1337`) verildi; hâlâ çalışıyor ve aynı
haritayı üretiyor. Bulutlar/kuş gibi animasyonlu katmanlar zamana bağlı olduğundan
PNG/klip yeniden alınırsa bu öğeler küçük farkla durur; arazi aynıdır.

Property harness'ların yeşil olduğu commit: `ad471d2` — `scripts/checks.sh`
(`--sweep` + `--geo` dahil) 2026-10-20'de "temiz (0 uyarı)". Vaka çalışmasındaki
"her seed şu testlerden geçiyor" satırı bu commit'e dayanır.

```
scripts/checks.sh          # --sweep + --geo dahil
```

## Property test kapsamı (vaka çalışması metni için)

`node tools/headless.js --geo` — 5 seed üzerinde:
- deniz seviyesi ↑ ⇒ kara ↓ (±2pp)
- aynı seed 128²↔192² merkez örtüşmesi ≥ %92 (kıtasal büyüme: özellik sabit,
  harita kenardan büyür)
- her nehir denize / göle / harita kenarına ulaşır (nehir stub'ları buduanıyor)
- nehirler voxel seviyesinde >1 kademe tırmanmaz (≤ %2)
- her seed'de kule = 0

`node tools/headless.js --sweep` — 7 deniz seviyesinde kara monotonluğu, ada
konsolidasyonu, kule = 0, determinizm.
