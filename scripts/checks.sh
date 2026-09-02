#!/usr/bin/env bash
# StilizedMaps — bağımlılıksız sağlık kontrolü
#
# Bu projede build adımı, paket yöneticisi ve test koşucusu YOK. Tek dış araç
# `node` (yalnızca sözdizimi kontrolü için; oyun/site onu çalıştırmaz). Node
# kurulu değilse betik uyarır ve devam eder — asla sessizce yeşil dönmez.
#
# Kullanım:
#   scripts/checks.sh            tüm çalışma ağacı
#   scripts/checks.sh --staged   yalnızca staged dosyalar
#
# Çıkış: 0 = temiz, 1 = en az bir HATA. Uyarılar çıkışı etkilemez.
#
# NE YAPMAZ: tarayıcıda render doğrulaması. Canvas çizimi, iso projeksiyon ve
# animasyon gözle kontrol edilir — bunu otomatikleştirdiğini iddia etme.

set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

STAGED=0
[ "${1:-}" = "--staged" ] && STAGED=1

errors=0
warns=0
err()  { printf 'HATA   %s\n' "$*" >&2; errors=$((errors+1)); }
warn() { printf 'UYARI  %s\n' "$*" >&2; warns=$((warns+1)); }
ok()   { printf 'ok     %s\n' "$*"; }

# ---------- Hangi dosyalar ----------
if [ "$STAGED" -eq 1 ]; then
    files="$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null)"
else
    files="$(git ls-files 2>/dev/null)"
fi
js_files="$(printf '%s\n' "$files" | grep -E '\.js$' || true)"

# ---------- 1. JS sözdizimi ----------
if [ -z "$js_files" ]; then
    ok "kontrol edilecek JS yok"
elif ! command -v node >/dev/null 2>&1; then
    warn "node kurulu değil — JS sözdizimi KONTROL EDİLMEDİ (yeşil sanma)"
else
    n=0
    while IFS= read -r f; do
        [ -z "$f" ] && continue
        [ -f "$f" ] || continue
        if ! out="$(node --check "$f" 2>&1)"; then
            err "sözdizimi: $f"
            printf '%s\n' "$out" | head -5 | sed 's/^/       /' >&2
        fi
        n=$((n+1))
    done <<< "$js_files"
    [ "$errors" -eq 0 ] && ok "$n JS dosyası sözdizimi temiz"
fi

# ---------- 2. index.html script etiketleri gerçekten var mı ----------
# Bu projenin en sessiz bozulma modu: dosya adı değişir, <script src> kalır,
# tarayıcı 404 verir ve harita hiç çizilmez. Konsola bakmadan fark edilmez.
if [ -f index.html ]; then
    missing=0
    while IFS= read -r src; do
        [ -z "$src" ] && continue
        case "$src" in http*|//*) continue ;; esac
        if [ ! -f "$src" ]; then
            err "index.html <script src=\"$src\"> — dosya yok"
            missing=$((missing+1))
        fi
    done < <(grep -oE '<script[^>]+src="[^"]+"' index.html 2>/dev/null \
             | sed -E 's/.*src="([^"]+)".*/\1/')
    [ "$missing" -eq 0 ] && ok "index.html script yolları çözülüyor"
fi

# ---------- 3. Global sözleşmesi: her src modülü window.SM'e yazmalı ----------
# Mimari kural (README): tek namespace `window.SM`. Bir modül kendi global'ini
# sızdırırsa yükleme sırası kırılganlaşır.
for f in $(printf '%s\n' "$js_files" | grep -E '^src/' || true); do
    [ -f "$f" ] || continue
    case "$f" in src/main.js) continue ;; esac
    grep -q 'window\.SM' "$f" || warn "$f — window.SM namespace'ine yazmıyor gibi"
done

# ---------- 4. Hijyen ----------
for f in $files; do
    [ -f "$f" ] || continue
    case "$f" in *.png|*.jpg|*.gif|*.ico|*.woff*) continue ;; esac
    if grep -qP '\r$' "$f" 2>/dev/null; then
        warn "$f — CRLF satır sonu (Windows'tan geldi)"
    fi
done

# ---------- Özet ----------
printf '\n'
if [ "$errors" -gt 0 ]; then
    printf 'SONUÇ: %d hata, %d uyarı\n' "$errors" "$warns" >&2
    exit 1
fi
printf 'SONUÇ: temiz (%d uyarı)\n' "$warns"
exit 0
