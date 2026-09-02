#!/usr/bin/env bash
# Stop hook — StilizedMaps   (eski adı: devlog-guard.sh)
#
# Devir güvenliğinin asıl mekanizması. Bu session'da gerçek bir değişiklik yapıldıysa
# ama kalıcı durum (CURRENT.md) güncellenmediyse, ajanı bir kez geri gönderir.
#
# Neden CURRENT.md: sohbet kaybolduğunda sonraki ajanın okuyacağı ilk şey odur.
# DEVLOG anlatı arşividir; kurtarma için yeterli değildir.
#
# Session başına EN FAZLA BİR KEZ bloklar (sentinel dosya ile).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
STATE_DIR="$PROJECT_DIR/.claude/.state"
CURRENT="$PROJECT_DIR/CURRENT.md"
DEVLOG="$PROJECT_DIR/docs/DEVLOG.md"

input="$(cat)"
session_id="$(printf '%s' "$input" | jq -r '.session_id // "unknown"' 2>/dev/null)"
[ -z "$session_id" ] && session_id="unknown"

# 1) Sonsuz döngü koruması.
stop_active="$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null)"
[ "$stop_active" = "true" ] && exit 0

START_FILE="$STATE_DIR/session-$session_id.start"
BLOCKED_FILE="$STATE_DIR/session-$session_id.blocked"

# 2) Bu session'da zaten bir kez bloklandıysak bir daha araya girme.
[ -f "$BLOCKED_FILE" ] && exit 0

# 3) SessionStart işaretçisi yoksa hiçbir şey varsayma.
[ -f "$START_FILE" ] || exit 0

cd "$PROJECT_DIR" || exit 0

# 4) Bu session'da anlamlı bir değişiklik oldu mu?
#    (a) commit'lenmemiş değişiklik — durum dosyaları ve .state hariç
#    (b) session başlangıcından beri yeni commit
uncommitted="$(git status --porcelain 2>/dev/null \
    | grep -vE '(CURRENT\.md|TODO\.md|docs/DEVLOG\.md|\.claude/\.state)' \
    | head -1)"

start_sha="$(cat "$START_FILE" 2>/dev/null)"
now_sha="$(git rev-parse HEAD 2>/dev/null)"
[ -z "$now_sha" ] && now_sha="none"

new_commits=""
[ "$start_sha" != "$now_sha" ] && new_commits="yes"

if [ -z "$uncommitted" ] && [ -z "$new_commits" ]; then
    # Sohbet/araştırma session'ı — araya girme.
    exit 0
fi

# 5) Kalıcı durum bu session'da güncellendi mi?
#    CURRENT.md yeterli; DEVLOG da güncellendiyse zaten sorun yok.
for f in "$CURRENT" "$DEVLOG"; do
    if [ -f "$f" ] && [ "$f" -nt "$START_FILE" ]; then
        exit 0
    fi
done

# 6) Blokla — sadece bir kez.
touch "$BLOCKED_FILE"

reason="Bu session'da projede değişiklik yapıldı ama kalıcı durum güncellenmedi.

Sohbet kaybolduğunda sonraki ajan (Claude ya da Codex, aynı makine ya da diğeri)
yalnızca depoyu görecek. Şu an bıraksan, yaptığın işin NEDEN yapıldığı hiçbir yerde
yazmıyor olacak.

Bitirmeden önce \`handoff\` skill'inin A bölümünü uygula:
  1. CURRENT.md — görev, son checkpoint, kalan iş, blocker, niyet notu (zorunlu)
  2. TODO.md — kuyruk değiştiyse
  3. README.md — mimari, üretim hattı ya da milestone durumu değiştiyse
  4. commit (bilerek eksikse 'wip:' önekiyle)

Session'ı anlatı olarak da kaydetmek istersen \`devlog-entry\` skill'i.

Bu kontrol session başına yalnızca bir kez çalışır — sonra normal şekilde bitirebilirsin."

jq -n --arg r "$reason" '{decision: "block", reason: $r}'
