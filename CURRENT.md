# CURRENT.md

Sonraki ajanın okuduğu **ilk** dosya. Diff'ten okunamayan şeyi tutar: niyet.
Şablon ve doldurma kuralları için `handoff` skill'i.

---

**Güncellendi:** 2026-09-02
**Dal:** `master`
**Çalışma alanı:** temiz

## Şu anki görev

**İso 2D → WebGL voxel 3D ikamesi.** Beş fazlık iş; Faz 0 ve Faz 1 bitti ve
commit'lendi.

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
- [ ] Faz 3 — orbit/pan/zoom etkileşimi, varsayılanın çevrilmesi
- [ ] Faz 4 — canlı efektler (nehir, lav, foam, bulut, kuş, duman)
- [ ] Faz 5 — export, `iso.js` silinir, dokümanlar

### ⚠️ Geçiş güvenliği: varsayılan HÂLÂ iso

`?renderer=voxel` yeni yola **opt-in** girer; parametresiz açılışta eski iso
yolu çalışır ve hiçbir davranış değişmez. Bu bilinçli — uygulama hiçbir fazda
kırık görünmesin diye. **Varsayılan Faz 3 bitince çevrilecek**, `iso.js` Faz 5'te
silinecek. Plan `?renderer=iso` kaçış kapısı diyordu; erken fazlarda tersi
daha güvenli olduğu için ters çevrildi.

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

`TODO.md` NOW'a bak. Kuyruğun başı belirlenmedi — Uğur'un yönü lazım:
M3 (fırça düzenleme) mi, coğrafi kurallar tur 2'nin kalanı mı, yoksa mevcut
haliyle ilk `bilaxten.art` vaka çalışması mı yazılsın.
