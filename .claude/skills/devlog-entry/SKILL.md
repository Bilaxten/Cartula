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

`docs/DEVLOG.md` içindeki `<!-- NEW-ENTRIES-BELOW -->` işaretini bul, kaydı **hemen
altına** ekle (en yeni kayıt en üstte olmalı).

```markdown
## YYYY-MM-DD · Kısa başlık
**Durum:** tamamlandı | devam ediyor | bloke
**Ne yapıldı:** 1-3 cümle.
**Değişen dosyalar:** yol listesi (git'ten al, elle uydurma)
**Neden bu yaklaşım:** Hangi alternatif elendi ve niye. Bir kısıt mı vardı,
performans mı, LÖVE/Lua API sınırı mı?
**Sonraki adım:** Tek cümle — bir sonraki session buradan başlar.
```

Tarih için `date +%Y-%m-%d` kullan, tahmin etme.

### 3. İş kuyruğunu ve durumu DEVLOG'a değil kendi yerlerine yaz

DEVLOG **anlatı arşividir**; iş kuyruğu ya da aktif durum tutmaz. Bu ayrım bilinçli:

| Bilgi | Yeri |
|---|---|
| Açık iş / sıradaki iş | `TODO.md` |
| Şu an nerede kalındı, niyet | `CURRENT.md` (`handoff` skill'i) |
| Kalıcı gerçek değişti (sistem, bozuk şey, tuzak) | `PROJECT_STATE.md` |
| Uzun vadeli sonucu olan karar | `docs/decisions/ADR-*.md` |
| Bu session'da ne oldu ve neden | **buraya** |

DEVLOG'a `- [ ]` maddesi ekleme — kuyruk iki yerde tutulursa ikisi de güvenilmez olur.

### 4. Kararı yükselt

Kayıttaki "neden bu yaklaşım" bölümünde altı ay sonra biri tarafından yeniden
tartışılacak bir şey varsa, o bir DEVLOG satırı değil bir **ADR**'dir
(`docs/decisions/`, `AGENTS.md` §8). DEVLOG'da bırakılan karar kaybolur.

## Kurallar

- **Kayıt uydurma.** Değişen dosya listesi git'ten gelir.
- "Neden" alanı boş geçilmez. Gerçekten bariz bir işse "rutin, alternatif yoktu" yaz —
  ama sessizce atlama.
- Kısa tut. Kayıt başına ~15 satır. DEVLOG bir arşiv değil, bir devir teslim notu.
- Session'da hiçbir şey değişmediyse (sohbet/araştırma) kayıt **ekleme**.
