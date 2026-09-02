#!/usr/bin/env bash
# SessionStart hook — StilizedMaps
#
# İki iş yapar:
#   1. Session başlangıç işaretçisi bırakır (.claude/.state/session-<id>.start).
#      İçeriği o andaki HEAD sha'sı; stop-state-guard ve session-end-breadcrumb bunu
#      "bu session'da iş yapıldı mı" sorusu için kullanır.
#   2. YALNIZCA DİNAMİK bilgiyi context'e enjekte eder: git durumu ve kesinti sinyali.
#
# Bilerek enjekte EDİLMEYENLER:
#   - CLAUDE.md / AGENTS.md — Claude Code zaten yüklüyor
#   - CURRENT.md / TODO.md  — CLAUDE.md içinden @import ediliyor
#   - DEVLOG                 — arşiv; sıcak bağlama girmez (AGENTS.md §2)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
STATE_DIR="$PROJECT_DIR/.claude/.state"

input="$(cat)"
session_id="$(printf '%s' "$input" | jq -r '.session_id // "unknown"' 2>/dev/null)"
[ -z "$session_id" ] && session_id="unknown"

mkdir -p "$STATE_DIR"
# .state sonsuza kadar büyümesin: 7 günden eski işaretçileri temizle.
find "$STATE_DIR" -type f -mtime +7 -delete 2>/dev/null || true

cd "$PROJECT_DIR" || exit 0

# ---------- Otomatik senkronizasyon ----------
# scripts/sync.sh yalnızca KAYBEDİLECEK HİÇBİR ŞEY YOKKEN çeker: temiz ağaç +
# yalnızca geride + fast-forward. Diğer her durumda hiçbir şey yapmaz ve sebebini
# söyler. Mantık orada tek kopya — Codex de AGENTS.md §1 gereği aynı betiği çağırır
# (Codex hook'ları deneysel ve Windows'ta yok, o yüzden hook'a bel bağlanmıyor).
#
# `-f` ile kontrol edilip `bash` ile çağrılır, `-x` ile DEĞİL: Windows'ta çalıştırma
# biti güvenilmez ve `-x` başarısız olursa otomatik senkronizasyon SESSİZCE devre dışı
# kalırdı — hata da vermeden. En kötü bozulma modu.
sync_out=""
if [ -f "$PROJECT_DIR/scripts/sync.sh" ]; then
    sync_out="$(bash "$PROJECT_DIR/scripts/sync.sh" </dev/null 2>&1 | head -20)"
fi

head_sha="$(git rev-parse HEAD 2>/dev/null)"
[ -z "$head_sha" ] && head_sha="none"
printf '%s\n' "$head_sha" > "$STATE_DIR/session-$session_id.start"

# ---------- Git durumu ----------
branch="$(git branch --show-current 2>/dev/null)"
dirty="$(git status --short 2>/dev/null | head -20)"
dirty_count="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
last_commits="$(git log --oneline -5 2>/dev/null)"
last_msg="$(git log -1 --pretty=%s 2>/dev/null)"

# Uzak durumu — fetch YAPILMAZ (session açılışını ağa bağlamamak için).
# Ajan AGENTS.md §1 gereği kendisi fetch eder; bu yalnızca son bilinen durum.
tracking="$(git status -sb 2>/dev/null | head -1)"

ctx="## Git durumu
branch: ${branch:-?} | HEAD: ${head_sha:0:8} | ${tracking}
son commit'ler:
$last_commits"

if [ -n "$sync_out" ]; then
    ctx="$ctx

Otomatik senkronizasyon (scripts/sync.sh):
$sync_out"
fi

if [ -n "$dirty" ]; then
    ctx="$ctx

Commit'lenmemiş değişiklikler ($dirty_count):
$dirty"
else
    ctx="$ctx

Çalışma alanı temiz."
fi

# ---------- Kesinti sinyali ----------
signals=""
case "$last_msg" in
    wip:*|WIP:*|checkpoint:*)
        signals="$signals
- Son commit \`wip:\`/\`checkpoint:\` ile başlıyor — bilinçli yarım bırakılmış iş.
  Mesajı oku: neyin çalıştığı ve neyin eksik olduğu orada yazıyor." ;;
esac

if [ -n "$dirty" ] && [ -f "$PROJECT_DIR/CURRENT.md" ]; then
    if grep -qiE '^\*\*Çalışma alanı:\*\*[[:space:]]*temiz' "$PROJECT_DIR/CURRENT.md" 2>/dev/null; then
        signals="$signals
- CURRENT.md \"çalışma alanı temiz\" diyor ama ağaç kirli — önceki ajan checkpoint'e
  varamadan kesilmiş olabilir."
    fi
fi

if grep -q '<!-- AUTO-BREADCRUMB -->' "$PROJECT_DIR/CURRENT.md" 2>/dev/null; then
    signals="$signals
- CURRENT.md'de otomatik kurtarma notu var (önceki session özetlenmeden kapandı).
  Niyet bilgisi İÇERMEZ — diff'ten yeniden kur, sonra o bloğu temizle."
fi

if [ -n "$signals" ]; then
    ctx="$ctx

## ⚠️ Kesinti sinyali
Yarıda kalmış iş olabilir. \`handoff\` skill'inin B bölümünü izle.
**Hiçbir yerel değişikliği atma.**$signals"
fi

jq -n --arg ctx "$ctx" \
    '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}'
