# Ölçüm paketi — StilizedMaps (Gerçeklik Borcu P3.5)

bilaxten.art vaka çalışması için **dürüst görsel + ölçüm paketi**. Sayısal yarısı
otomatik, görsel yarısı tarayıcıda üretilir (PNG capture + orbit klip headless
yapılamaz — WebGL/canvas yok).

## Sabit seed'ler

`1337`, `4242`, `90210` — `seaLevel = 0.38`, `decorations` kapalı (varsayılan).

## Sayısal manifest (otomatik)

```
node tools/headless.js --manifest > docs/measurements/manifest-<tarih>.json
```

Üç seed × {192², 448²}: land/water %, ada sayısı + top-5 boyut, kule sayısı
(hep 0 — property test bunu tutuyor), yerleşim sayısı, üretim süresi (ms),
tam biyom histogramı.

Güncel: `manifest-2026-09-08.json`.

## Görsel paket (tarayıcıda — Uğur)

Her seed için `python scripts/serve.py` ile açıp:

1. **Üstten görünüm PNG** — `?view=top&seed=<S>&size=192`, "Export PNG".
   → `docs/measurements/<S>-topdown-192.png`
2. **Voxel görünüm PNG** — `?renderer=voxel&seed=<S>&size=192` (varsayılan iso),
   sabit kamera açısı (yaw 0.6, pitch 0.9 civarı), "Export PNG".
   → `docs/measurements/<S>-voxel-192.png`
3. **Orbit klip** — voxel modda "Auto-rotate" aç, ekran kaydı ~8 sn (bir tam tur).
   → `docs/measurements/<S>-orbit.mp4` (ya da gif)
4. **448² üstten** — `?view=top&seed=<S>&size=448` → ölçek karşılaştırması için.

Property harness'ların yeşil olduğu commit'i not düş (vaka çalışmasında
"her seed şu testlerden geçiyor" satırı için):

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
