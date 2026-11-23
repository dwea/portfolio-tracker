#!/usr/bin/env bash
# Installs the portfolio-tracker report-relay push job (launchd, every 15 min).
#
# Asks which deployment to use (private|encrypted) and sets it up:
#   private   — needs the private dwea/portfolio-reports repo to exist; the
#               installer clones it to ~/portfolio-reports. Plaintext
#               per-report files are pushed there, nothing new goes public.
#   encrypted — generates a passphrase, stores it in the project's .env
#               (PT_REPORTS_PASSPHRASE) and in ~/.portfolio-reports.conf;
#               the push job syncs it to the private repo as passphrase.txt
#               so Muse can decrypt. The passphrase is never printed.
# The private repo is needed in both modes, so create it first on github.com
# (private, empty) if it does not exist yet.
#
# Run once from a normal Terminal on the Mac:
#   bash scripts/install-report-push.sh
#
# Uninstall:
#   launchctl bootout gui/$(id -u)/com.dweaver.portfolio-tracker-push-reports
#   rm ~/Library/LaunchAgents/com.dweaver.portfolio-tracker-push-reports.plist
#   rm ~/.portfolio-reports.conf
set -euo pipefail

LABEL="com.dweaver.portfolio-tracker-push-reports"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUSH_SH="$PROJECT_ROOT/scripts/push-reports.sh"
CONF="$HOME/.portfolio-reports.conf"
REPORTS_DIR="$HOME/portfolio-reports"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

chmod +x "$PUSH_SH" 2>/dev/null || true

# --- mode ---
MODE="${PT_RELAY_MODE:-}"
if [ -z "$MODE" ]; then
  printf 'Relay mode: (1) private repo  (2) encrypted files on the public repo [1/2]: '
  read -r CHOICE
  case "$CHOICE" in
    2) MODE="encrypted" ;;
    *) MODE="private" ;;
  esac
fi
case "$MODE" in private|encrypted) : ;; *) echo "error: mode must be private or encrypted" >&2; exit 1 ;; esac

# --- private repo (needed in both modes) ---
if [ ! -d "$REPORTS_DIR/.git" ]; then
  if ! git ls-remote git@github.com:dwea/portfolio-reports.git HEAD >/dev/null 2>&1; then
    echo "error: the private repo dwea/portfolio-reports does not exist or is not reachable." >&2
    echo "Create it on github.com (private, empty) and re-run this installer." >&2
    exit 1
  fi
  git clone --quiet git@github.com:dwea/portfolio-reports.git "$REPORTS_DIR"
  echo "cloned private reports repo to $REPORTS_DIR"
fi

# --- passphrase (encrypted mode only) ---
PASSPHRASE=""
if [ "$MODE" = "encrypted" ]; then
  if [ -f "$CONF" ]; then
    # shellcheck disable=SC1090
    PASSPHRASE="$(. "$CONF"; echo "${PT_REPORTS_PASSPHRASE:-}")"
  fi
  if [ -z "$PASSPHRASE" ]; then
    PASSPHRASE="$(openssl rand -base64 32 | tr -d '\n')"
    if ! grep -q '^PT_REPORTS_PASSPHRASE=' "$PROJECT_ROOT/.env" 2>/dev/null; then
      printf '\nPT_REPORTS_PASSPHRASE=%s\n' "$PASSPHRASE" >> "$PROJECT_ROOT/.env"
      echo "added PT_REPORTS_PASSPHRASE to $PROJECT_ROOT/.env"
    fi
    echo "generated a relay passphrase (stored in .env and $CONF; never printed here)"
  fi
fi

{
  echo "PT_RELAY_MODE=$MODE"
  echo "PT_REPORTS_DIR=$REPORTS_DIR"
  [ -n "$PASSPHRASE" ] && echo "PT_REPORTS_PASSPHRASE=$PASSPHRASE"
} > "$CONF"
chmod 600 "$CONF"
echo "wrote $CONF"

# --- upstream check (encrypted mode pushes to origin) ---
if [ "$MODE" = "encrypted" ]; then
  if ! git -C "$PROJECT_ROOT" rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
    echo "warning: no upstream set for this repo; run this once so pushes work:" >&2
    echo "  cd $PROJECT_ROOT && git push -u origin main" >&2
  fi
fi

# --- launchd agent ---
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$PUSH_SH</string>
  </array>
  <key>StartInterval</key>
  <integer>900</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/pt-push-reports.out.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/pt-push-reports.err.log</string>
</dict>
</plist>
EOF
echo "wrote $PLIST"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if ! launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null; then
  launchctl load -w "$PLIST"
fi
echo "launchd agent loaded ($LABEL, every 900s)"

# --- fire one push now ---
bash "$PUSH_SH" || true
echo
echo "Report push installed (mode: $MODE, every 900s)."
