# CLAUDE.md

Bu dosya **ince bir adaptördür**. Projenin kuralları modelden bağımsızdır ve
`AGENTS.md`'de yaşar — orayı Codex de okur. Buraya yalnızca Claude Code'a özgü
davranış yazılır. İkisini birden şişirme; sürüklenirler.

@AGENTS.md

@CURRENT.md

@TODO.md

---

## Claude Code'a özgü

**Skill'ler** `.claude/skills/` altında ve otomatik keşfedilir:
- `handoff` — checkpoint / devir / kurtarma
- `devlog-entry` — session anlatısı, milestone breakdown'ı

Skill'i `Skill` aracıyla çağır, elle dosya okuma.

**Doğrulama arka plan sunucusuna bağımlı değil** — `scripts/checks.sh` ve
`node tools/headless.js` doğrudan Bash ile çalıştırılır. Üçüncü katman (tarayıcıda
görsel kontrol) otomatikleştirilemez, `AGENTS.md` §4.

**Hook'lar** `.claude/settings.json` içinde:
- `SessionStart` → `scripts/sync.sh` + git durumu ve kesinti sinyalini enjekte eder
- `Stop` → session'da iş yapıldıysa `CURRENT.md` güncellenmemişse bir kez uyarır
- `SessionEnd` → mekanik kurtarma notu (niyet içermez, son güvenlik ağı)

Hook'lar `.claude/settings.json` değiştikten sonra canlanması için bir kez `/hooks`
çalıştırılmasını isteyebilir.

**Kişisel override'lar** `.claude/settings.local.json` — commit'lenmez.
