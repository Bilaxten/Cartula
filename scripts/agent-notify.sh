#!/usr/bin/env bash
# Codex ve Claude Code için ortak masaüstü bildirimi. macOS'ta Notification
# Center, Windows'ta PowerShell toast kullanır; Windows'ta Git Bash zaten proje
# önkoşulu olduğu için iki ajan da aynı çağrıyı yapabilir.

set -u

title="${1:-Agent}"
message="${2:-Yanıtın veya kararın gerekli olabilir.}"
script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"

case "$(uname -s)" in
    Darwin)
        /usr/bin/osascript - "$title" "$message" <<'APPLESCRIPT'
on run argv
    display notification (item 2 of argv) with title (item 1 of argv) sound name "Glass"
end run
APPLESCRIPT
        ;;
    MINGW*|MSYS*|CYGWIN*)
        ps_script="$script_dir/agent-notify.ps1"
        if command -v cygpath >/dev/null 2>&1; then
            ps_script="$(cygpath -w "$ps_script")"
        fi
        powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$ps_script" \
            -Title "$title" -Message "$message"
        ;;
    *)
        printf '%s: %s\n' "$title" "$message" >&2
        ;;
esac
