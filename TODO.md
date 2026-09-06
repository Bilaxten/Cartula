# TODO.md

Operasyonel iş kuyruğu. **Kısa tut.** Biten madde silinir — tamamlanmış iş git
geçmişinde ve `docs/DEVLOG.md`'de yaşar, burada birikmez.

Tasarım/mimari gerekçe buraya değil `README.md`'ye yazılır.

---

## NOW

- [ ] **İlk vaka çalışması — kuyruğun başı.** M1-M4'ün tamamı bitti
      (2026-09-06), yani `bilaxten.art`'a konacak breakdown artık bitmiş bir
      projeyi anlatıyor: üretim hattı, coğrafi kurallar, WebGL2 voxel geçişi,
      fırça editleme, gökyüzü katmanı + gömülü demo. Kod işi değil ama
      projenin asıl amacı bu (`AGENTS.md` §2).

- [ ] **Fırça cilası (M3 sonrası, küçük):** fırçalar yalnız üstten görünümde
      çalışıyor ama VARSAYILAN açılış voxel — kullanıcı "Top-down" sekmesine
      geçmeden düzenleyemiyor. Paneldeki not (`Brushes work in top-down view`)
      bunu söylüyor ama araç seçilince sekmeye otomatik geçmek ya da voxel'de
      düzenlemeyi açmak daha iyi olur. Karar verilmedi.

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
