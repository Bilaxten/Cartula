#!/usr/bin/env bash
# SessionEnd hook — StilizedMaps   (eski adı: devlog-fallback.sh)
#
# Son güvenlik ağı. Terminal aniden kapansa, kullanım limiti çarpsa, süreç çökse bile
# sonraki ajan bir iz bulsun diye var.
#
# SessionEnd yalnızca kabuk komutu çalıştırabilir, LLM çağıramaz — bu yüzden buradaki
# not MEKANİKTİR (git'ten türetilir) ve NİYET BİLGİSİ İÇERMEZ. Asıl kaliteli devri
# Stop hook'u (stop-state-guard.sh) + `handoff` skill'i yaptırır.
#
# Not CURRENT.md'nin başına yazılır, DEVLOG'a değil: sonraki ajanın okuduğu ilk dosya odur.
# DEVLOG anlatı arşividir ve makineyle üretilmiş gürültü ile kirletilmez.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
STATE_DIR="$PROJECT_DIR/.claude/.state"
CURRENT="$PROJECT_DIR/CURRENT.md"
BEGIN='<!-- AUTO-BREADCRUMB -->'
END='<!-- /AUTO-BREADCRUMB -->'

input="$(cat)"
session_id="$(printf '%s' "$input" | jq -r '.session_id // "unknown"' 2>/dev/null)"
[ -z "$session_id" ] && session_id="unknown"

START_FILE="$STATE_DIR/session-$session_id.start"

cleanup() {
    rm -f "$STATE_DIR/session-$session_id.start" "$STATE_DIR/session-$session_id.blocked" 2>/dev/null || true
}

# İşaretçi yoksa bu session'ı takip etmiyoruz.
[ -f "$START_FILE" ] || exit 0
[ -f "$CURRENT" ] || { cleanup; exit 0; }

cd "$PROJECT_DIR" || exit 0

# CURRENT.md bu session'da elle güncellendiyse yapacak bir şey yok — düzgün devredilmiş.
if [ "$CURRENT" -nt "$START_FILE" ]; then
    cleanup
    exit 0
fi

# Anlamlı bir değişiklik oldu mu?
uncommitted="$(git status --porcelain 2>/dev/null | grep -v '\.claude/\.state' | head -30)"

start_sha="$(cat "$START_FILE" 2>/dev/null)"
now_sha="$(git rev-parse HEAD 2>/dev/null)"
[ -z "$now_sha" ] && now_sha="none"

new_commits=""
if [ "$start_sha" != "$now_sha" ] && [ "$start_sha" != "none" ] && [ "$now_sha" != "none" ]; then
    new_commits="$(git log --oneline "$start_sha..$now_sha" 2>/dev/null | head -20)"
fi

if [ -z "$uncommitted" ] && [ -z "$new_commits" ]; then
    cleanup
    exit 0
fi

# ---------- Kurtarma notunu oluştur ----------
today="$(date +%Y-%m-%d\ %H:%M)"
block="$(mktemp)"
{
    echo "$BEGIN"
    echo "> ⚠️ **Otomatik kurtarma notu — $today**"
    echo "> Bir session, CURRENT.md güncellenmeden kapandı (limit, çökme ya da kapatma)."
    echo "> Aşağısı git'ten mekanik üretildi; **niyet bilgisi içermez.**"
    echo ">"
    echo "> Sonraki ajan: \`handoff\` skill'inin B bölümünü izle. Diff'ten niyeti yeniden"
    echo "> kur, **hiçbir yerel değişikliği atma**, sonra bu bloğu sil."
    echo ">"
    if [ -n "$new_commits" ]; then
        echo "> **Bu session'daki commit'ler:**"
        printf '%s\n' "$new_commits" | sed 's/^/> - /'
        echo ">"
    fi
    if [ -n "$uncommitted" ]; then
        echo "> **Commit'lenmemiş değişiklikler:**"
        printf '%s\n' "$uncommitted" | sed 's/^/> - /'
        echo ">"
    fi
    echo "> Başlangıç HEAD: \`$start_sha\` → bitiş HEAD: \`$now_sha\`"
    echo "$END"
    echo ""
} > "$block"

# Öncekini temizleyip yenisini en üste koy — idempotent, birikmez.
tmp="$(mktemp)"
awk -v b="$BEGIN" -v e="$END" '
    $0 == b { skip = 1 }
    skip    { if ($0 == e) skip = 0; next }
    { print }
' "$CURRENT" > "$tmp"

cat "$block" "$tmp" > "$CURRENT"
rm -f "$block" "$tmp" 2>/dev/null || true

cleanup
exit 0
