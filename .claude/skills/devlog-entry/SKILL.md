---
name: devlog-entry
description: docs/DEVLOG.md'ye bu session için standart formatta bir kayıt ekler (ne yapıldı, hangi dosyalar değişti, neden bu yaklaşım, açık işler, sonraki adım). Session sonunda Stop hook'u bunu hatırlatır; ayrıca "devlog yaz", "günlüğe kaydet", "session'ı özetle" denildiğinde kullanılır.
---

# DEVLOG Kaydı Ekle

## Amaç

Sonraki session'ın sıfırdan başlamaması. Kritik olan kısım **"Neden bu yaklaşım"** —
"ne değiştiği" zaten git'ten okunabilir, ama *neden* öyle yapıldığı yalnızca burada durur.

## Adımlar

### 1. Değişiklikleri topla

```bash
git status --short
git diff --stat HEAD
git log --oneline -5
```

### 2. Kaydı yaz

`docs/DEVLOG.md` ters kronolojiktir (en yeni en üstte) ve işaret yorumu yoktur. Dosyanın
ilk satırı `# DEVLOG`; kaydı bu başlığın **hemen altına**, mevcut ilk `## ` kaydının
üstüne ekle (`grep -n '^## ' docs/DEVLOG.md | head -3` ile yerini gör). Aynı gün birden
çok kayıt olabilir, yine en yenisi üstte.

Başlık biçimi `## YYYY-MM-DD — Kısa başlık`. Gövde, ihtiyaca göre şu kalın etiketlerden
oluşur (dosyadaki kayıtlar bunları kullanıyor); hepsi zorunlu değil, **Ne yapıldı** ve
**Neden bu yaklaşım** her zaman var:

```markdown
## YYYY-MM-DD — Kısa başlık

**Ne yapıldı:** 1-3 paragraf; commit kısa hash'leriyle.

**Neden bu yaklaşım:** Hangi alternatif elendi ve niye. Bir kısıt mı vardı,
performans mı, API sınırı mı?

**Doğrulama:** Hangi `checks.sh` / `tools/headless.js` kontrolleri, hangi tarayıcı gözlemi.
Otomatik doğrulanamayan görsel kısmı açıkça yaz.

**Değişen dosyalar:** (gerekirse) git'ten al, elle uydurma.
**Açık:** (varsa) bilerek bırakılan, doğrulanmamış ya da ertelenen.
**Sonraki adım:** Tek cümle, bir sonraki session buradan başlar.
```

Tarih için `date +%Y-%m-%d` kullan, tahmin etme.

### 3. İş kuyruğunu ve durumu DEVLOG'a değil kendi yerlerine yaz

DEVLOG **anlatı arşividir**; iş kuyruğu ya da aktif durum tutmaz. Bu ayrım bilinçli:

| Bilgi | Yeri |
|---|---|
| Açık iş / sıradaki iş | `TODO.md` |
| Şu an nerede kalındı, niyet | `CURRENT.md` (`handoff` skill'i) |
| Kalıcı gerçek değişti (mimari, tuzak, kural) | `README.md` / `AGENTS.md` |
| Bu session'da ne oldu ve neden | **buraya** |

DEVLOG'a `- [ ]` maddesi ekleme: kuyruk iki yerde tutulursa ikisi de güvenilmez olur.

### 4. Kararı yükselt

"Neden bu yaklaşım" bölümünde altı ay sonra biri tarafından yeniden tartışılacak bir
şey varsa, bunu ayrıca `AGENTS.md`'ye (mimari çapa / kural) ya da `README.md`'ye de
yaz; yalnız DEVLOG'da bırakılan karar kaybolur. Bu repoda ayrı bir karar kaydı klasörü yok.

## Kurallar

- **Kayıt uydurma.** Değişen dosya listesi git'ten gelir.
- "Neden" alanı boş geçilmez. Gerçekten bariz bir işse "rutin, alternatif yoktu" yaz —
  ama sessizce atlama.
- Kısa tut. Kayıt başına ~15 satır. DEVLOG bir arşiv değil, bir devir teslim notu.
- Session'da hiçbir şey değişmediyse (sohbet/araştırma) kayıt **ekleme**.
