#!/usr/bin/env bash
# Publish Cartula to https://bilaxten.art/cartula/ (LIVE).
#
# Copies the app (index.html, css/, src/, assets/) into the bilaxten.art repo's `master` branch
# under cartula/ and pushes. Vercel deploys `master` on every push. Works in a temporary git
# worktree, so the bilaxten.art checkout (usually on `site`) is never switched or touched. Only
# cartula/ is ever changed. Same pattern as puzzle-lab tools/level-editor/publish.sh; bilaxten.art
# keeps cartula/ on release because it is listed in its scripts/external-dirs.txt.
#
#   scripts/publish-site.sh           checks, publish, verify live
#   scripts/publish-site.sh --check   only compare live with local
#
# Site repo location: $BILAXTEN_ART_DIR, else ~/bilaxten.art, else ~/Desktop/bilaxten.art.
set -euo pipefail

repo="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
url="https://bilaxten.art/cartula/"
APP=(index.html css src assets)

say() { printf '\033[1m%s\033[0m\n' "$*"; }
die() { printf 'HATA  %s\n' "$*" >&2; exit 1; }
sha() { if command -v sha256sum >/dev/null; then sha256sum | cut -d' ' -f1; else shasum -a 256 | cut -d' ' -f1; fi; }

live_matches() {
  local want got
  # Line endings ignored: a Windows checkout holds CRLF, git (and so the live copy) LF.
  want="$(tr -d '' < "$repo/index.html" | sha)"
  got="$(curl -fsS -H 'Cache-Control: no-cache' "$url?v=$(date +%s)" 2>/dev/null | tr -d '' | sha || true)"
  [ "$want" = "$got" ]
}

if [ "${1:-}" = "--check" ]; then
  if live_matches; then echo "ok    canlı = yerel index.html"; exit 0; fi
  echo "FARK  canlı Cartula yereldeki index.html ile aynı değil"; exit 1
fi
[ -z "${1:-}" ] || die "bilinmeyen argüman: $1 (geçerli: --check ya da argümansız)"

site="${BILAXTEN_ART_DIR:-}"
if [ -z "$site" ]; then
  for d in "$HOME/bilaxten.art" "$HOME/Desktop/bilaxten.art" ${USERPROFILE:+"$(cygpath -u "$USERPROFILE" 2>/dev/null || echo "$USERPROFILE")/Desktop/bilaxten.art"}; do
    [ -d "$d/.git" ] && { site="$d"; break; }
  done
fi
[ -n "$site" ] && [ -d "$site/.git" ] || die "bilaxten.art reposu bulunamadı (BILAXTEN_ART_DIR ayarla)"

# 1. Only publish what is committed and pushed, so the live copy maps to a commit.
say "1. Cartula durumu"
[ -z "$(git -C "$repo" status --porcelain -- "${APP[@]}")" ] || die "uygulama dosyalarında commit'lenmemiş değişiklik var"
git -C "$repo" fetch -q origin
branch="$(git -C "$repo" branch --show-current)"
[ "$(git -C "$repo" rev-parse HEAD)" = "$(git -C "$repo" rev-parse "origin/$branch")" ] \
  || die "'$branch' origin ile senkron değil — önce push/pull"
rev="$(git -C "$repo" log -1 --format=%h -- "${APP[@]}")"
echo "ok    uygulama @ $rev"

# 2. Checks must pass before anything goes live.
say "2. checks.sh"
(cd "$repo" && bash scripts/checks.sh >/dev/null) || die "checks.sh kırmızı — yayın yok"
echo "ok    checks temiz"

# 3. Copy into bilaxten.art master via a throwaway worktree.
say "3. bilaxten.art master'a kopyala"
git -C "$site" fetch -q origin master
wt="$(mktemp -d)"
cleanup() { git -C "$site" worktree remove --force "$wt" >/dev/null 2>&1 || rm -rf "$wt"; }
trap cleanup EXIT
git -C "$site" worktree add -q --detach "$wt" origin/master
rm -rf "$wt/cartula"
mkdir -p "$wt/cartula"
for p in "${APP[@]}"; do
  git -C "$repo" ls-files -z -- "$p" | while IFS= read -r -d '' f; do
    mkdir -p "$wt/cartula/$(dirname "$f")"
    cp "$repo/$f" "$wt/cartula/$f"
  done
done
git -C "$wt" add -A cartula
if git -C "$wt" diff --cached --quiet; then
  echo "ok    master'daki Cartula zaten güncel ($rev)"
else
  outside="$(git -C "$wt" diff --cached --name-only | grep -v '^cartula/' || true)"
  [ -z "$outside" ] || die "cartula/ dışında değişiklik: $outside"
  git -C "$wt" commit -q -m "Cartula: $rev" \
    -m "Published from Bilaxten/Cartula scripts/publish-site.sh. Only cartula/ changes."
  git -C "$wt" push -q origin HEAD:master
  echo "ok    push edildi: $(git -C "$wt" rev-parse --short HEAD) → master"
fi

# 4. Wait for Vercel and verify the live bytes equal the local file.
say "4. canlı doğrulama — $url"
for i in 1 2 3 4 5 6 7 8 9; do
  if live_matches; then echo "ok    canlı = Cartula @ $rev"; exit 0; fi
  sleep 15
done
die "~2 dk sonra canlı hâlâ farklı — Vercel deploy'unu elle kontrol et"
