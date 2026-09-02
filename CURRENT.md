# CURRENT.md

Sonraki ajanın okuduğu **ilk** dosya. Diff'ten okunamayan şeyi tutar: niyet.
Şablon ve doldurma kuralları için `handoff` skill'i.

---

**Güncellendi:** 2026-09-02
**Dal:** `master`
**Çalışma alanı:** temiz

## Şu anki görev

Aktif kodlama görevi yok. Son iş kapandı ve commit'lendi.

Bu session'da yapılan şey koda değil **altyapıya** dokundu: depo Uğur'un ikinci
beynine (`BilaxtenOS` vault) bağlandı — `AGENTS.md`, bu dosya, `TODO.md`,
`.claude/` hook'ları ve skill'leri, `scripts/sync.sh` + `scripts/checks.sh`
eklendi. Öncesinde bu depoda hiç ajan sözleşmesi yoktu: session'lar iz bırakmıyordu.

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
