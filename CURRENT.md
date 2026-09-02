# CURRENT.md

Sonraki ajanın okuduğu **ilk** dosya. Diff'ten okunamayan şeyi tutar: niyet.
Şablon ve doldurma kuralları için `handoff` skill'i.

---

**Güncellendi:** 2026-09-02
**Dal:** `master`
**Çalışma alanı:** temiz

## Şu anki görev

**İso 2D → WebGL voxel 3D ikamesi.** Beş fazlık iş; Faz 0-3 commit'lendi.
Faz 3.5 kullanıcı geri bildirimi çalışma ağacında, commit beklemeden tamamlandı.

Neden: `iso.js` rotasyonu yalnızca 90°'lik dört adım verebiliyor ve her adım tam
bir yeniden bake — projeksiyon piksellere gömülü olduğu için kamera açısı
bitmap'in içinde donuyor. Uğur kasmasız 360° istedi. WebGL'de geometri dünya
uzayında durur, kamera bir matristir → rotasyon kare başına bir matris çarpımı.

**Karar: ikame, üçüncü görünüm değil.** Son hâl iki görünüm — `top` (2D, aynen
kalır) + 3D voxel (`iso`'nun yerine). Ortho projeksiyon (iso karakterini korur),
varsayılan kamera bugünkü görünümü birebir üretecek (pitch 30° = 2:1 diamond'ın
karşılığı, yaw 45°).

**Üretim hattı hiç değişmiyor** — `grid.level` zaten işaretli ayrık voxel kademesi.
Değişen tek şey projeksiyon aşaması.

### Faz durumu

- [x] **Faz 0 — iskele.** `src/render/voxel3d.js`: WebGL2 context, ortho orbit
      kamera, mat4 yardımcıları (bağımlılık yok). `#gl` canvas'ı, opt-in yol.
- [x] Faz 1 — mesh builder (saf, GL'siz) + temel gölgeleme
- [x] Faz 2 — cast shadow + gün döngüsü paritesi (commit bekliyor)
- [x] Faz 3 — voxel orbit/pan/zoom etkileşimi (varsayılan bilinçli olarak iso kaldı)
- [x] Faz 3.5 — voxel varsayılanı, stage yaw slider'ı, gölge cilası ve kamera
      korunması (commit bekliyor)
- [x] Faz 4.5 — per-vertex ambient occlusion, AO uyumlu quad diagonal seçimi
      ve headless mesh denetimleri (commit bekliyor)
- [x] Faz 4a — voxel arazi animasyonu: su dalgası, lav nabzı ve kıyı foam'u
      (commit bekliyor)
- [ ] Faz 4b — bulutlar ve kuşlar (ayrı geometri/sistem)
- [ ] Faz 5 — export, `iso.js` silinir, dokümanlar

### Geçiş güvenliği: varsayılan voxel, iso kaçış kapısı

Parametresiz açılış ve `?renderer=voxel` WebGL voxel görünümünü açar.
`?renderer=iso` klasik canvas izometrik yolu için Faz 5'e kadar erişilebilir
kaçış kapısıdır; `iso.js` o fazda silinecek.

### Faz 0'da doğrulananlar

- `mat4Ortho` / `mat4LookAt` / `mat4Multiply` glMatrix ile birebir; çarpım sırası
  `projection * view` doğru, aspect düzeltmesi doğru (satır satır okundu)
- `scripts/checks.sh` temiz (9 JS, `window.SM` sözleşmesi dahil)
- `node tools/headless.js` temiz — üretim hattında regresyon yok
- Varsayılan yol el değmemiş: `isVoxelMode()` parametresiz her zaman `false`

**Doğrulanmadı:** WebGL canvas'ının tarayıcıdaki görüntüsü. Faz 0 sahnesi yalnızca
geçici referans geometrisi (renkli eksenler + 10×10 tel-kafes ızgara), Faz 1'de
silinecek. `?renderer=voxel` ile açıp orbit'in döndüğünü gözle görmek gerekiyor.

### Faz 1 teslimi (2026-09-02)

- `SM.buildVoxelMesh(grid)` saf fonksiyon olarak eklendi: merkezli XZ dünya
  koordinatları, seviye farkına göre dört yönlü yüz eleme, kömür border ring ve
  kapalı taban. GL/DOM kullanmadan Node altında çalışır.
- WebGL yolu gerçek mesh için VAO + Uint32 index buffer kullanıyor. Dikey ölçek
  (`uVScale`) ve güneş yönü uniform; mesh yeniden yüklenmeden slider güncellenir.
  Kamera mesh sınırlarından ortho zoom/distance/near/far hesaplar.
- `?renderer=voxel` doğrudan voxel/iso görünümünü açar ve grid her değiştiğinde
  mesh'i yeniden kurar. Parametresiz varsayılan iso yolu değiştirilmedi.
  Otomatik yavaş 360 derece dönüş sürüyor.
- `node tools/headless.js --mesh` eklendi: finite buffer, index sınırı, düz-grid
      yüz eleme, positions/colors determinism'i ve 192² maliyetini denetler.

### Faz 1 düzeltme turu (2026-09-02, commit bekliyor)

- `src/render/voxel3d.js` portfolyo okunabilirliği standardına getirildi:
  tek ifadeli satırlar, en uzun satır 84 karakter, 66 yorum satırı / 787 toplam
  satır (%8,39). GLSL kaynakları okunabilir, çok satırlı stringlerdir.
- Mesh kurucu salt biçimsel olarak yeniden düzenlendi; `--mesh` maliyeti ve
  geometri sayıları değişmedi: **248068 vertex, 124034 üçgen**.
- `fitCamera` artık o anki orbit açısını ölçmüyor. XZ yarı-köşegeni tüm yaw'ları,
  XZ + ölçekli Y destek fonksiyonu 10–89° tüm pitch'leri kapsar; köşe-küre
  yarıçapı yalnız near/far derinlik aralığı için tutulur.
- Shader'a Faz 2 notu eklendi: alçak güneşte yan yüzlerin aşırı aydınlanması
  gün-döngüsü paritesinde ele alınacak.

Doğrulandı: `scripts/checks.sh`, normal `tools/headless.js`, ve `--mesh` temiz.
Ek doğrulama: tüm mesh üçgenlerinin normaline göre CCW sarımı temiz.

**Görsel doğrulanmadı:** Bu session'da tarayıcı/WebGL canvas gözle kontrol
yapılmadı. `?renderer=voxel` ile gerçek map, border/base, 360 derece dönüş,
tüm orbit açıları ve slider tepkisi tarayıcıda bakılmalı.

### Faz 2 teslimi (2026-09-02, commit bekliyor)

- `SM.buildShadowMap(grid, sun)` saf `Uint8Array` ön-geçişi eklendi; sabitleri
  `iso.js` ile aynı (`SUN_STEPS = 12`, `SUN_RISE`, katkı eğrisi). Gölge doku
  olarak `R8/RED`, `NEAREST`, `CLAMP_TO_EDGE` ile yükleniyor.
- Mesh artık hücre merkezi `cellUV` ve lav için tek skaler `emissive` attribute
  taşıyor. Yan yüzler UV/emissive açısından yüksek (sahip) hücreye bağlı.
- Güneş slider'ı voxel modunda mesh'i yeniden kurmadan yalnızca yeni gölge
  haritasını yükler; shader gerçek Lambert + ortam ışığıyla alçak güneş yan
  yüzlerini doğal olarak üst yüzlerden daha parlak kılar. `#daynight` ve CSS
  gün/gece filtresi `#gl` için tekrar etkin.
- `node tools/headless.js --mesh` gölge türü/boyutu/aralığı, determinism, düz
  grid ve yüksek sütun durumlarını denetliyor. Faz 1 geometri tabanı korundu:
  **248068 vertex, 124034 üçgen**. Bu makinede 192² gölge haritası 2.9 ms ve
  36.864 bayt ölçüldü.

**Görsel doğrulanmadı:** Tarayıcı/WebGL canvas gözle kontrol edilmedi. Özellikle
`?renderer=voxel` altında gece lav parlaklığı, alçak güneş gölge yönü ve renk
yıkaması tarayıcıda teyit edilmeli.

### Faz 3 teslimi (2026-09-02, commit bekliyor)

- Voxel görünümünde otomatik dönüş kaldırıldı. Sol sürükleme orbit, Shift+sol
  sürükleme kamera hedefini yaw'a göre pan eder, tekerlek ortografik zoom yapar.
  Q/E ve panel düğmeleri kısa ease ile yönlü 90 derece snap uygular.
- Sürekli RAF yok: yalnızca mesh/gölge/slider güncellemesi, yeniden boyutlandırma,
  fare kamerası ve snap geçişi bir kare ister. `#rotVal` voxel'de gerçek üç haneli
  dereceyi gösterir; top-down/klasik iso N/E/S/W davranışı değişmedi.
- Paylaşım bağlantısı voxel görünümünde `renderer=voxel` ile `yaw`, `pitch` ve
  `zoom` değerlerini taşır. Varsayılan renderer **iso** kaldı; `RENDERER` yanında
  gelecekteki tek satırlık flip için açık Faz 3 notu var.
- Saf `SM.VoxelCamera` yardımcıları (`yaw` sarması, `pitch` clamp, snap, pan
  vektörü) eklendi; `node tools/headless.js --mesh` istenen sarmalama/clamp/snap
  örneklerini denetliyor. Geometri tabanı değişmedi: **124034 üçgen**.

Doğrulandı: `bash scripts/checks.sh`, `node tools/headless.js` ve
`node tools/headless.js --mesh` temiz.

**Görsel/etkileşim doğrulanmadı:** Bu ortamda tarayıcı/WebGL canvas gözle kontrol
edilemedi. `?renderer=voxel` altında orbit yönü, Shift-pan yönü, zoom sınırları,
Q/E ease'i ve paylaşılan URL'nin açılışı tarayıcıda teyit edilmeli.

### Faz 3.5 teslimi (2026-09-02, commit bekliyor)

- Varsayılan renderer artık WebGL voxel; klasik canvas izometrik yol yalnız
  `?renderer=iso` ile açılır. Paneldeki dönüş düğmeleri kaldırıldı; stage içi
  yaw slider'ı canlı 0-360 derece sürükleme, Q/E snap ve mouse orbit ile çift
  yönlü senkron çalışır. Slider sadece voxel görünümünde görünür.
- Gün saati slider'ı 06:00-ertesi gün 05:30 aralığına taşındı. Saf
  `SM.formatClock` sarmalamayı taşır; eski `sun=0..5.5` paylaşım değerleri
  24 saat eklenerek korunur, diğer aralık dışı range değerleri clamp edilir.
- Shader gölge kazancı 1.28, yan-yüz katsayısı 0.70 oldu. En güçlü gündüz
  gölgesinde bile çarpan yaklaşık %46'da kaldığından arazi detayını ezmemesi
  hedeflendi; Faz 4.5 AO bunun yerine geçmeyecek.
- `rebuildVoxelMesh()` mevcut kamerayı korur. Yeni grid, ilk kamera veya XZ
  map footprint değişimi fit gerektirir; brush yüksekliği ve viewport seçenekleri
  gerektirmez. `showGrid`/`showShade` yalnız top-down render'ı tazeler.
- Doğrulandı: `bash scripts/checks.sh`, `node tools/headless.js` ve
  `node tools/headless.js --mesh` temiz; mesh 124034 üçgen. `--mesh` ayrıca
  06:00, 26:00 ve 29.5 saat gösterim sarmasını denetliyor.

**Görsel/etkileşim doğrulanmadı:** Tarayıcı/WebGL gözle kontrolü bu ortamda
yapılmadı. Uğur voxel kamerayı döndürüp grid-lines, height brush, slider drag,
mouse orbit ve Q/E sırasında yerinde kaldığını tarayıcıda teyit etmeli.

### Faz 4.5 teslimi (2026-09-02, commit bekliyor)

- Hücre-başına, albedoya gömülü AO kaldırıldı. `buildVoxelMesh` artık her
  bağımsız quad köşesi için `Uint8Array ao` içinde 0..3 görünürlük değeri taşır;
  albedo malzeme olarak saf kalır ve `aAO` shader attribute'udur.
- Üst yüz AO'su Minecraft-benzeri iki kenar + çapraz sütun kuralını kullanır.
  Yan yüzler, sıkıştırılmış heightmap duvarının üst dikişinde dış/tanjant/çapraz
  sütunlara aynı seviyede bakar; alt köşeler açık kalır. Quad diagonal seçimi
  `SM.shouldFlipVoxelQuad(a00, a01, a11, a10)` ile saf ve test edilebilirdir.
- Shader'da `AO_STRENGTH = 0.40`, en kapalı köşeyi 0.60 çarpanına indirir.
  AO yerel formu taşıdığı için `SHADOW_GAIN` 1.28'den 1.14'e çekildi; yan-yüz
  cast-shadow katsayısı 0.70 korunarak güneş yönü okunur kalır.
- Doğrulandı: `bash scripts/checks.sh`, `node tools/headless.js` ve
  `node tools/headless.js --mesh` temiz. `--mesh` AO dizisi tür/uzunluk/aralık,
  determinism, düz-grid açıklığı, yüksek sütun duyarlılığı ve quad-flip
  vakalarını denetliyor; üçgen sayısı **124034** kaldı.
- 192² mesh kurma ölçümü (8 warm-up + 25 örnek): `14ea427` medyanı 23.6 ms,
  AO sonrası medyan 28.5 ms. Bu sadece CPU mesh kurulum ölçümüdür.

**Görsel doğrulanmadı:** Tarayıcı/WebGL canvas bu ortamda gözle kontrol
edilemedi. `?renderer=voxel` altında AO'nun üst köşelerdeki koyuluğu, yüksek
basamakların yan dikişleri, açık alandaki düz yüzlerin değişmemesi ve gün
slider'ında cast-shadow ile AO'nun dengesi tarayıcıda kontrol edilmeli.

### Faz 4a teslimi (2026-09-02, commit bekliyor)

- Voxel görünümünde varsayılan açık `Terrain animation` anahtarı eklendi. Açık
  olduğunda her RAF'ta `uTime` güncellenir; kapalı olduğunda son WebGL karesi
  kalır ve yalnız kirli sahne ya da kamera snap'i tekrar bir kare ister.
  `showClouds` voxel modunda gizlenir ve devre dışı kalır; eski iso yoluna
  dönülünce geri gelir.
- Saf `SM.buildVoxelMesh(grid)` artık yalnız su hücresi üstlerinde 1 olan
  `water` ve yalnız sığ kıyılarda `terrainColor()` içindeki `wt` değerini
  taşıyan `shore` attribute'larını üretir. Yan yüzler, border ve taban ikisi
  için de 0'dır; eski kullanılmayan `opts` parametresi kaldırıldı.
- Vertex shader suyu `0.036` ham seviye genliği, `1.40` hız ve dünya-konumu
  fazıyla hareket ettirir. `shore` ağırlığı genliği `1 - wt` ile söndürür;
  varsayılan 1.6 dikey ölçekte en büyük hareket 0.058 voxel olduğundan kıyı
  dikişi riski küçük tutulur. Fragment shader lavı hücre UV fazı ve `2.40`
  hızıyla nabızlandırır;
  foam `1.60` hızla kıyı ağırlığı üzerinde ince bir parlak banttır.
- Doğrulandı: `bash scripts/checks.sh`, `node tools/headless.js` ve
  `node tools/headless.js --mesh` temiz. Mesh denetimi su bayrağı uzunluğu,
  ikili aralığı ve yalnız su üst yüzlerinde oluşmasını; `shore` uzunluk/aralık
  ve determinism'ini denetler. Geometri tabanı **124034 üçgen** kaldı.

**Görsel doğrulanmadı:** Tarayıcı/WebGL canvas bu ortamda gözle kontrol
edilmedi. `?renderer=voxel` altında dalganın kıyıda yarık açmadığı, foam'un
okunurluğu, lavların bağımsız nabzı ve animasyon anahtarı kapatılınca son
karenin donduğu gözle kontrol edilmeli.

### Bu işin dışında, aynı session'da yapılan

Depo Uğur'un ikinci beynine (`BilaxtenOS` vault) bağlandı — `AGENTS.md`, bu dosya,
`TODO.md`, `.claude/` hook'ları ve skill'leri, `scripts/sync.sh` +
`scripts/checks.sh`. Öncesinde hiç ajan sözleşmesi yoktu: session'lar iz bırakmıyordu.

## Nerede kalındı

Son kod işi (2026-09-02, Windows): konik yanardağ, animasyon layer bounding-box
fix, gün-döngüsü slider'ı (`#sun`, 0-24). Ondan önce UI makeover + PNG export +
paylaşım linki. Detay `docs/DEVLOG.md` en üstte.

Milestone durumu — özet (doğrusu `README.md`'de):
- ✅ M1 üretim + üstten görünüm
- ✅ M2 izometrik voxel projeksiyon
- 🔄 Coğrafi kurallar, tur 2 — volkanik koniler geldi; platolar, fiyortlar,
  kıyı okları/lagünler, deltalar/haliçler, takımada konsolidasyonu açık
- 🔄 Animasyon kısmi — nehir dalgası, lav glow, bulutlar, gün döngüsü var;
  uçan kuşlar yok
- ⬜ M3 fırça düzenleme — başlamadı
- ⬜ M4 animasyonun kalanı

## Bilinen durum

Mac klonu 2026-09-02'de kuruldu ve doğrulandı:
- `scripts/checks.sh` → temiz (8 JS dosyası, 0 uyarı)
- `node tools/headless.js` → çalışıyor, biyom dağılımı makul (volcanic + lava dahil)
- `file://` ile açılıyor, yerel sunucu gerekmiyor

**Doğrulanmadı:** tarayıcıda görsel kontrol Mac'te yapılmadı (Chrome eklentisi
bağlı değildi). Gün döngüsü, volkan konisi ve animasyon layer'ı Windows'ta gözle
onaylanmıştı; Mac'te bakılmadı. Kod aynı, risk düşük — ama "doğrulandı" deme.

## Sonraki adım

Faz 3.5 için tarayıcı/WebGL görsel-işlevsel kontrolü: varsayılan voxel açılışı,
`?renderer=iso`, stage yaw slider'ı, Q/E, mouse orbit, grid-lines ve edit sonrası
kamera korunması. Aynı kontrolde Faz 4.5 AO köşe koyuluğu, basamak duvarları ve
güneş gölgesi dengesi de teyit edilmeli. Ardından bu çalışma ağacı user'ın
istediği checkpoint akışına göre commit'lenebilir; milestone kuyruğu için
`TODO.md` NOW'a bak.
