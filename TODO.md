# TODO.md

Operasyonel iş kuyruğu. **Kısa tut.** Biten madde silinir — tamamlanmış iş git
geçmişinde ve `docs/DEVLOG.md`'de yaşar, burada birikmez.

Tasarım/mimari gerekçe buraya değil `README.md`'ye yazılır.

---

## NOW

- [ ] **Yön kararı (Uğur):** kuyruğun başı belirlenmedi. Üç aday:
      (a) **M3 — fırça düzenleme.** Biyom boya, terrain yükselt/alçalt, nehir çiz,
          kısmi yeniden hesap. En büyük iş; "üret + düzenle" iddiasını tamamlar.
      (b) **Coğrafi kurallar tur 2'nin kalanı.** Platolar, fiyortlar, kıyı
          okları/lagünler, deltalar/haliçler, karasallık, riparian yeşillik,
          takımada konsolidasyonu. Artımlı, her biri tek pass.
      (c) **İlk vaka çalışması.** Mevcut haliyle `bilaxten.art`'a M1+M2 breakdown'ı
          + gömülü demo. Kod işi değil ama projenin asıl amacı bu (`AGENTS.md` §2).

## NEXT

- [ ] **M4 — animasyonun kalanı:** uçan kuşlar, bulut gölgesi. Gün/gece ve kamera
      döndürme geldi (2026-09-02), bu maddeden düştü.

- [ ] **README milestone listesi DEVLOG'un gerisinde.** Volkanik koniler, gün
      döngüsü, PNG export, paylaşım linki ve UI makeover DEVLOG'da var, README'nin
      milestone bölümünde yok. `AGENTS.md` §0 gereği README mimarinin tek doğru
      kaynağı — sürüklenme kapatılmalı.

## LATER

- [ ] **Görsel regresyon fikri:** `tools/headless.js` determinism'i yakalıyor ama
      render'ı yakalamıyor. Canvas'ı node-canvas ile PNG'ye basıp referansla
      karşılaştırmak mümkün — ama bu bir **bağımlılık** demek (`AGENTS.md` §2:
      önce sor). Kararı verilmedi, sadece kayıt.
