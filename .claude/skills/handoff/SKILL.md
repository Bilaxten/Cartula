---
name: handoff
description: Checkpoint at ve durumu devredilebilir hâle getir — CURRENT.md/TODO.md güncelle, güvenli commit, güvenli push. Uzun bir işin ortasında tutarlı bir noktaya gelindiğinde, session biterken ve "kaydet", "checkpoint at", "devret", "limit bitmek üzere", "bırakıyorum" denildiğinde kullanılır. Ayrıca yeni bir session yarıda kalmış iş bulduğunda kurtarma yönü için kullanılır.
---

# Handoff — devir ve kurtarma

Bu akış tek bir varsayım üzerine kurulu: **sohbet kaybolacak.** Claude ya da Codex bir
anda limite takılabilir, terminal kapanabilir. Sonraki ajan yalnızca depoyu görecek.

İki yönü var: **bırakma** ve **devralma**.

---

## A. Bırakma (checkpoint)

### 1. Neyin tutarlı olduğuna karar ver

Checkpoint bir "kaydetme" değil, **anlaşılabilir bir durumdur**. Şu anda:
- bir alt sistem çalışıyor mu?
- bir refactor tutarlı bir noktada mı?
- riskli bir sonraki aşamaya geçmek üzere misin?

Hiçbiri değilse ve iş 10 dakikalıksa checkpoint atma. Saatlerce süren tutarlı işi
commit'siz bırakma.

### 2. Doğrula (atlanmaz)

JS değiştiyse `scripts/checks.sh` (tüm `.js` için `node --check` + hijyen). Tarayıcıda
görsel doğrulama gerekiyorsa bunu **söyle** — otomatik yapılamaz:

```
scripts/checks.sh
```

Test kırıksa checkpoint yine atılabilir — ama mesajda ve `CURRENT.md`'de açıkça yazar.
Sessizce yeşil gibi bırakma.

### 3. `CURRENT.md`'yi güncelle — en kritik adım

Diff'ten okunamayacak olan **niyeti** yaz. Sonraki ajan `git diff`'i zaten görebiliyor;
göremediği şey neden o yolu seçtiğin ve sırada ne olduğu.

Şablon dosyanın altında. Doldururken kendine sor: *"Bunu ben yazmamış olsaydım, bu
diff'in ne yapmaya çalıştığını anlar mıydım?"*

Bilerek kirli bırakıyorsan bunu **yaz** — yoksa sonraki ajan onu enkaz sanır.

### 4. Kuyruğu ve kalıcı belleği güncelle

- `TODO.md` — kuyruk değiştiyse. Biten maddeyi **sil**, işaretleme.
- `README.md` — yalnızca kalıcı bir gerçek değiştiyse (yeni pass, yeni milestone durumu,
  bozulan şey, yeni tuzak). Mimari ve üretim hattının tek doğru kaynağı orası.
- `docs/DEVLOG.md` — milestone kapandıysa breakdown notu (`devlog-entry`). Bu proje
  portfolyo kanıtı; anlatılmayan iş yarım sayılır.

### 5. Commit

```bash
git add -A
git status --short          # ne commit'lendiğini GÖR
git commit -m "<mesaj>"
```

Mesaj **durumu** anlatır, sadece diff'i değil:

- tamamlanmış iş → `feat(combat): ...`, `fix(save): ...`, `chore(workflow): ...`
- bilerek eksik → `wip: <ne çalışıyor> — <ne eksik>`

`wip:` öneki bir sinyaldir; session başlangıcında kesinti tespiti bunu arar.

### 6. Push

```bash
git fetch
git status -sb              # ahead/behind
```

- yalnızca ahead → `git push`
- behind → önce `git pull --rebase`; çakışma çıkarsa **`git rebase --abort` ve dur**,
  kullanıcıya bildir
- `--force` asla — açık izin olmadan yok

---

## B. Devralma (kurtarma)

Yeni session açtın ve iş yarıda kalmış görünüyor.

### 1. Hiçbir şeyi atma

Açıklanamayan yerel değişiklik **çöp değildir**. `reset --hard`, `clean -fd`,
`checkout --` yok — kullanıcı açıkça istemedikçe.

### 2. Niyeti yeniden kur

```bash
git status --porcelain
git log --oneline -10
git diff                     # unstaged
git diff --cached            # staged
git status --porcelain | grep '^??'   # untracked — en kolay gözden kaçan
```

Sonra `CURRENT.md` ile karşılaştır:

| Gözlem | Anlamı |
|---|---|
| `CURRENT.md` "temiz" diyor, ağaç kirli | ajan checkpoint'e varamadan kesildi |
| son commit `wip:` | bilinçli yarım checkpoint — mesajı oku, orada ne eksik yazıyor |
| `CURRENT.md`'deki hedef HEAD ile uyuşmuyor | `CURRENT.md` bayat, git haklı |
| kirli ama `CURRENT.md` "bilerek kirli" diyor | kasıtlı, sebebi yazıyor |

Hâlâ anlaşılmıyorsa diff'i oku ve kodun kendisinden çıkar. Kod zekâsı burada işe yarar:
değişen sembolleri `search_graph` ile bağlamına oturt.

### 3. Devam et ya da sor

- Niyet anlaşıldıysa ve iş tutarlıysa → devam et, `CURRENT.md`'yi düzelt.
- Diff yarım bir fikri gösteriyor ama yönü belirsizse → **kullanıcıya sor**, bu arada
  hiçbir şeyi bozma.
- Diff bariz biçimde bozuk/terkedilmiş görünüyorsa → yine sor. Sen karar veremezsin.

### 4. İlk işin bittiğinde

`CURRENT.md`'yi gerçek duruma getir. Bayat bir `CURRENT.md` bir sonraki devirde
doğrudan yanlış yönlendirmedir.
