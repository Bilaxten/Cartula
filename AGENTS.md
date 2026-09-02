# AGENTS.md — StilizedMaps Ortak Çalışma Sözleşmesi

Bu dosya **modelden bağımsız** tek kaynaktır. Claude Code, Codex CLI ve ileride
eklenebilecek başka bir ajan aynı kuralları buradan okur. Codex bu dosyayı otomatik
yükler; Claude `CLAUDE.md` üzerinden içeri alır.

> **Codex notu:** Codex `@import` takip etmez. Bu yüzden AGENTS.md kendi kendine
> yeterlidir — hiçbir kural "şu dosyaya bak" diye devredilmez.

Kural: **Kod ve kod yorumları İngilizce. Doküman, DEVLOG ve sohbet Türkçe.**

---

## 0. Bu depo hafızadır, sohbet değildir

Hiçbir kritik bilgi yalnızca sohbet geçmişinde durmaz. Ajan bir anda kullanım
limitine takılabilir, terminal kapanabilir, makine değişebilir (bu proje hem
Windows hem Mac'te yürüyor). Sonraki ajan sohbeti göremez — **yalnızca depoyu görür.**

| Dosya | Ne tutar | Ne zaman okunur |
|---|---|---|
| `AGENTS.md` | Nasıl çalışılır (bu dosya) | her session, otomatik |
| `CURRENT.md` | Şu an ne yapılıyor, nerede kalındı | **her session, ilk iş** |
| `TODO.md` | İş kuyruğu | **her session, ilk iş** |
| `README.md` | Mimari, üretim hattı, milestone durumu | görev gerektirdiğinde |
| `docs/DEVLOG.md` | Session anlatısı + milestone breakdown'ları | geriye dönük soruda |

**`README.md` bu projede çift görev yapıyor:** hem dışarıya açıklama (repo public)
hem de mimarinin tek doğru kaynağı. ROCKy'deki `PROJECT_STATE.md`'nin karşılığı odur.
Mimari bir gerçek değiştiyse README güncellenir.

---

## 1. Session açılışı

Sırayla, **her session'da**:

1. **`scripts/sync.sh`** çalıştır. Fetch eder ve **yalnızca kaybedilecek hiçbir şey
   yoksa** (temiz ağaç + sadece geride) fast-forward yapar; başka her durumda hiçbir
   şeye dokunmadan sebebini yazar. "DURDU" diyorsa oradaki durum senin ilk işindir.
2. `CURRENT.md` ve `TODO.md` oku.
3. `CURRENT.md`'de `<!-- AUTO-BREADCRUMB -->` bloğu varsa önceki session
   özetlenmeden kapanmış demektir — `handoff` skill'inin B bölümünü izle,
   **hiçbir yerel değişikliği atma**, sonra bloğu sil.

---

## 2. Bu proje ne, ne değil

Prosedürel stilize harita üreteci. **Ürün değil, portfolyo kanıtı.**
Bilaxten technical artist portfolyosunun parçası; her milestone bir breakdown
notu (`docs/DEVLOG.md`) → sonra `bilaxten.art`'ta vaka çalışması + gömülü demo.

Bunun pratik sonucu: **"bitti" ölçütü anlatılabilirliktir.** Görsel olarak
etkileyici olmayan ya da DEVLOG'da anlatılmamış bir iş yarım sayılır. Teknik
olarak doğru ama ekran görüntüsü alınamayan bir değişiklik bu projede zayıf iştir.

**Kapsam dışı:** framework, build adımı, paket yöneticisi, TypeScript, bundler.
`index.html` çift tıklanınca çalışmalı. Bu bir kısıt değil, projenin iddiası —
bozma. Bir bağımlılık eklemek istiyorsan önce sor.

---

## 3. Mimari çapa — bozulmaması gereken üç şey

1. **Tek doğru kaynak: grid veri modeli** (`src/grid.js`). Her hücre `elevation`,
   `moisture`, `temperature`, `biome`, `water`, `level` taşır. Üstten (`render/
   topdown.js`) ve izometrik (`render/iso.js`) görünüm aynı modelin iki
   **projeksiyonudur** — ayrı harita değil. Bir renderer kendi terrain verisini
   türetmeye başlarsa iki doğru oluşur ve ikisi de çürür.

2. **Tek namespace: `window.SM`.** Modüller classic `<script>` ile yüklenir, ES
   module değil — `file://` üzerinden çalışabilsin diye. Kendi global'ini sızdıran
   modül yükleme sırasını kırılganlaştırır. `scripts/checks.sh` bunu denetler.

3. **Üretim hattı adlandırılmış pass'lerdir** (`src/generate.js`): sample → shape →
   repair → sea level → climate → classify → hydrology → voxelize. Rastgele değil
   **kurallı**. Yeni bir coğrafi özellik eklerken onu bir pass'e yerleştir; hattın
   dışında ad-hoc düzeltme yapma.

---

## 4. Doğrulama (atlanmaz)

Bu projede test koşucusu yok. Üç katman var ve **üçü aynı şey değil**:

| Katman | Komut | Ne yakalar |
|---|---|---|
| Sözdizimi + hijyen | `scripts/checks.sh` | Kırık JS, `index.html`'de ölü `<script src>`, namespace ihlali, CRLF |
| Üretim hattı | `node tools/headless.js` | Determinism (aynı seed → aynı harita), kule/artefakt, biyom dağılımı, sea-level isabeti |
| Görsel | **tarayıcıda gözle** | Render, iso projeksiyon, animasyon, gölge, palet |

**Üçüncü katman otomatikleştirilemez.** Canvas çıktısını hiçbir ajan headless
doğrulayamaz. Görsel bir değişiklik yaptıysan bunu açıkça söyle: *"headless
geçti, tarayıcıda bakılması gerekiyor."* Yeşil gibi bırakma.

`--sweep` bayrağı (`node tools/headless.js --sweep`) sea-level taraması + ada
sayısı kontrolü yapar — su/kıyı davranışını değiştirdiysen bunu da koştur.

---

## 5. Git

- Dal: **`master`**. Uzak: `github.com/Bilaxten/StilizedMaps` (**public** — repo
  dışarıdan görünüyor, commit mesajları da portfolyonun parçası, özensiz yazma).
- Session açılışında `scripts/sync.sh`. Otomatik push YOK — push checkpoint akışının
  parçası (`handoff`).
- Yarım bırakılan iş `wip:` ya da `checkpoint:` önekiyle commit'lenir. SessionStart
  hook'u bu öneki görüp sonraki ajanı uyarır.

---

## 6. Devir (session kapanışı)

Session'da gerçek bir değişiklik yaptıysan `CURRENT.md` güncellenmeden bitirme.
Stop hook'u bunu bir kez hatırlatır; hatırlatmayı beklemeden yap.

- `handoff` skill'i — checkpoint ve kurtarma akışı (A: bırakma, B: devralma)
- `devlog-entry` skill'i — session anlatısı / milestone breakdown'ı

Milestone kapandıysa DEVLOG girdisi **zorunlu** — §2 gereği anlatılmayan iş yarım.

---

## 7. İkinci beyin bağlantısı

Bu depo Uğur'un vault'una (`BilaxtenOS`) bağlı. Vault'taki proje notu:
`🏰 300-Projects/StilizedMaps/StilizedMaps.md`, thread: `🔮 850-Companion/Threads.md`.

**Sınır:** proje gerçeği bu depodadır, vault onu kopyalamaz. Vault yalnızca
ilişkisel katmanı tutar (bu proje neden var, hangi işe bağlı, hangi karar nerede
alındı). İkisini senkron tutmaya çalışma — vault depoya *işaret eder*.
