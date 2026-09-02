# CURRENT.md

Sonraki ajanın okuduğu **ilk** dosya. Diff'ten okunamayan şeyi tutar: niyet.
Şablon ve doldurma kuralları için `handoff` skill'i.

---

**Güncellendi:** 2026-09-02
**Dal:** `master`
**Çalışma alanı:** temiz

## Şu anki görev

**İso 2D → WebGL voxel 3D ikamesi.** Beş fazlık iş, Faz 0 bitti.

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
- [ ] Faz 1 — mesh builder (saf, GL'siz) + temel gölgeleme ← **sıradaki**
- [ ] Faz 2 — cast shadow + gün döngüsü paritesi
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

### Faz 1'e taşınan bilinen borç

- `render()` içinde `distance = 100` ve ortho `near/far = -200..200` sabit —
  gerçek harita (192²) geldiğinde kırpar, harita sınırlarına göre ölçeklenmeli
- Vertex attribute'ları her karede bağlanıyor; gerçek mesh gelince VAO'ya geçilmeli

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
