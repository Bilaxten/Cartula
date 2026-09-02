#!/usr/bin/env bash
# StilizedMaps — güvenli otomatik senkronizasyon
#
# Tek iş: uzaktaki değişiklikleri çekmek YALNIZCA hiçbir şey kaybedilemeyecekse.
#
# Bu betik kasten "aptal"dır. Çakışma çözmez, stash yapmaz, rebase etmez, merge
# commit'i üretmez. Kapılardan biri kapalıysa hiçbir şey yapmaz ve sebebini söyler.
# Karar gerektiren her durum insana/ajana bırakılır — otomasyon sınırı burasıdır.
#
# Kullanım:
#   scripts/sync.sh            senkronize et (güvenliyse)
#   scripts/sync.sh --dry-run  ne yapacağını söyle, yapma
#
# Çıkış: her zaman 0. Bu bir kapı değil, bir kolaylık. Session'ı bloklamaz.
# Atlamak için: SM_NO_AUTOSYNC=1

set -uo pipefail

TOP="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "sync: git deposu değil"; exit 0; }
cd "$TOP" || exit 0

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

say() { printf 'sync: %s\n' "$*"; }

[ "${SM_NO_AUTOSYNC:-0}" = "1" ] && { say "atlandı (SM_NO_AUTOSYNC=1)"; exit 0; }

# --- Kapı 1: yarım kalmış git işlemi var mı? --------------------------------
# Rebase/merge/cherry-pick ortasında olan bir depoya dokunmak felakettir.
gitdir="$(git rev-parse --git-dir)"
for marker in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG; do
    if [ -e "$gitdir/$marker" ]; then
        say "DURDU — yarım kalmış git işlemi var ($marker). Önce onu bitir/iptal et."
        exit 0
    fi
done

# --- Kapı 2: bir dalda mıyız, upstream var mı? ------------------------------
branch="$(git branch --show-current 2>/dev/null)"
if [ -z "$branch" ]; then
    say "atlandı — detached HEAD"
    exit 0
fi
upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"
if [ -z "$upstream" ]; then
    say "atlandı — '$branch' dalının upstream'i yok"
    exit 0
fi

# --- Kapı 3: çalışma alanı temiz mi? ----------------------------------------
# Untracked dosyalara İZİN VERİLİR: --ff-only, gelen bir dosya untracked bir
# dosyayla çakışırsa zaten güvenle reddeder. İzlenen dosyada değişiklik varsa dur.
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
    say "atlandı — commit'lenmemiş değişiklik var (bu iş kesilmiş bir ajanın olabilir)"
    say "       önce checkpoint at, sonra tekrar dene. Hiçbir şey silme."
    exit 0
fi

# --- fetch (ağ) -------------------------------------------------------------
# Çevrimdışıysa session açılışını asmasın diye düşük hız eşiğiyle kendini iptal etsin.
export GIT_HTTP_LOW_SPEED_LIMIT=1000
export GIT_HTTP_LOW_SPEED_TIME=8
export GIT_TERMINAL_PROMPT=0          # kimlik sorulacaksa sessizce başarısız ol
if ! git fetch --quiet 2>/dev/null; then
    say "atlandı — fetch başarısız (çevrimdışı ya da kimlik doğrulama gerekiyor)"
    exit 0
fi

# --- Kapı 4: sadece geride miyiz? -------------------------------------------
counts="$(git rev-list --left-right --count "HEAD...@{u}" 2>/dev/null)"
ahead="$(printf '%s' "$counts" | awk '{print $1}')"
behind="$(printf '%s' "$counts" | awk '{print $2}')"
[ -z "$ahead" ] && { say "atlandı — ahead/behind hesaplanamadı"; exit 0; }

if [ "$behind" -eq 0 ] && [ "$ahead" -eq 0 ]; then
    say "güncel ($branch)"
    exit 0
fi

if [ "$ahead" -gt 0 ] && [ "$behind" -gt 0 ]; then
    say "DURDU — dallar ayrışmış ($ahead ileri, $behind geri)."
    say "       Otomatik rebase/merge YAPILMAZ: çakışma çözümü karar gerektirir."
    exit 0
fi

if [ "$ahead" -gt 0 ]; then
    say "$ahead commit push edilmemiş ($branch) — otomatik push YOK, checkpoint akışına bırakıldı"
    exit 0
fi

# --- Buradan sonrası: temiz ağaç + yalnızca geride = kaybedilecek hiçbir şey yok
if [ "$DRY" -eq 1 ]; then
    say "[dry-run] fast-forward yapılabilir: $behind commit"
    git --no-pager log --oneline "HEAD..@{u}" 2>/dev/null | head -10 | sed 's/^/sync:   /'
    exit 0
fi

before="$(git rev-parse --short HEAD)"
if git merge --ff-only --quiet "@{u}" 2>/dev/null; then
    after="$(git rev-parse --short HEAD)"
    say "fast-forward: $before → $after ($behind commit)"
    git --no-pager log --oneline "$before..$after" 2>/dev/null | head -8 | sed 's/^/sync:   /'
    n_js="$(git diff --name-only "$before..$after" -- '*.js' 2>/dev/null | wc -l | tr -d ' ')"
    [ "$n_js" -gt 0 ] && say "  $n_js JS dosyası değişti"
else
    say "DURDU — fast-forward yapılamadı. Hiçbir şey değişmedi."
fi

exit 0
