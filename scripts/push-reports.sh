#!/usr/bin/env bash
# Pushes portfolio report snapshots to GitHub for the Muse relay
# (see PROJECT_NOTES.md "Report relay"). Run every 15 minutes via launchd
# (see install-report-push.sh). Two modes, chosen at install time and stored
# in ~/.portfolio-reports.conf:
#
#   private   — plaintext per-report files are copied into a clone of the
#               private dwea/portfolio-reports repo and pushed there.
#               Nothing new goes to the public repo.
#   encrypted — AES-256-GCM ciphertext files are committed in this repo and
#               pushed to origin. The passphrase lives in the project's
#               .env (PT_REPORTS_PASSPHRASE) and is also synced to the
#               private repo as passphrase.txt, so Muse can fetch it and
#               decrypt in memory. The passphrase is never printed.
#
# Exits 0 when nothing changed. A failed push exits non-zero (launchd logs it).
# Env overrides (for testing): PT_PROJECT_ROOT, PT_REPORTS_DIR, PT_RELAY_MODE,
# PT_CONF.
set -u
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH

PROJECT_ROOT="${PT_PROJECT_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
CONF="${PT_CONF:-$HOME/.portfolio-reports.conf}"
MODE="${PT_RELAY_MODE:-}"
REPORTS_DIR="${PT_REPORTS_DIR:-$HOME/portfolio-reports}"
if [ -f "$CONF" ]; then
  # shellcheck disable=SC1090
  . "$CONF"
  MODE="${PT_RELAY_MODE:-${MODE:-}}"
  REPORTS_DIR="${PT_REPORTS_DIR:-$REPORTS_DIR}"
fi
[ -n "$MODE" ] || { echo "error: no relay mode configured; run scripts/install-report-push.sh" >&2; exit 1; }

case "$MODE" in
  private)
    [ -d "$REPORTS_DIR/.git" ] || { echo "error: reports repo not found at $REPORTS_DIR" >&2; exit 1; }
    shopt -s nullglob
    FILES=("$PROJECT_ROOT"/data/last-report-*.txt)
    [ "${#FILES[@]}" -gt 0 ] || exit 0
    cp "${FILES[@]}" "$REPORTS_DIR/"
    cd "$REPORTS_DIR" || exit 1
    git add last-report-*.txt
    git diff --cached --quiet && exit 0
    git commit -m "Update last report files" --quiet || exit 1
    git push --quiet || exit 1
    ;;
  encrypted)
    cd "$PROJECT_ROOT" || exit 1
    shopt -s nullglob
    FILES=(data/last-report-*.txt.enc)
    [ "${#FILES[@]}" -gt 0 ] || exit 0
    git add "${FILES[@]}"
    git diff --cached --quiet && exit 0
    git commit -m "Update encrypted last report files" --quiet || exit 1
    git push --quiet || exit 1
    # Sync the passphrase to the private repo so Muse can decrypt.
    if [ -d "$REPORTS_DIR/.git" ] && [ -n "${PT_REPORTS_PASSPHRASE:-}" ]; then
      printf '%s' "$PT_REPORTS_PASSPHRASE" > "$REPORTS_DIR/passphrase.txt"
      cd "$REPORTS_DIR" || exit 1
      git add passphrase.txt
      git diff --cached --quiet || { git commit -m "Update relay passphrase" --quiet && git push --quiet; }
    fi
    ;;
  *) echo "error: unknown relay mode '$MODE' (want private|encrypted)" >&2; exit 1 ;;
esac
