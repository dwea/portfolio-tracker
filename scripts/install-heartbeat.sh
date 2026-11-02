#!/usr/bin/env bash
# Installs the portfolio-tracker heartbeat launchd agent.
#
# Before running this, create the check on healthchecks.io (free account):
#   - Add a check named "portfolio-tracker"
#   - Period: 15 minutes, Grace: 15 minutes
#   - Copy its ping URL (looks like https://hc-ping.com/<uuid>)
# The installer asks for that URL and stores it in
# ~/.portfolio-tracker-heartbeat.conf (mode 600, never in git).
#
# Run once from a normal Terminal on the Mac:
#   bash scripts/install-heartbeat.sh
# (or pass the URL directly: PT_HC_PING_URL=https://hc-ping.com/<uuid> bash scripts/install-heartbeat.sh)
#
# Uninstall:
#   launchctl bootout gui/$(id -u)/com.dweaver.portfolio-tracker-heartbeat
#   rm ~/Library/LaunchAgents/com.dweaver.portfolio-tracker-heartbeat.plist
#   rm ~/.portfolio-tracker-heartbeat.conf

set -euo pipefail

LABEL="com.dweaver.portfolio-tracker-heartbeat"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HEARTBEAT_SH="$PROJECT_ROOT/scripts/heartbeat.sh"
CONF="$HOME/.portfolio-tracker-heartbeat.conf"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

chmod +x "$HEARTBEAT_SH" 2>/dev/null || true

# --- config: ping URL (stable across reinstalls) + pm2 path -----------------
PING_URL="${PT_HC_PING_URL:-}"
if [ -z "$PING_URL" ] && [ -f "$CONF" ]; then
  # shellcheck disable=SC1090
  PING_URL="$(. "$CONF"; echo "${PT_HC_PING_URL:-}")"
fi
if [ -z "$PING_URL" ]; then
  printf 'Paste the healthchecks.io ping URL for this check: '
  read -r PING_URL
fi
case "$PING_URL" in
  https://hc-ping.com/*) : ;;
  *) echo "error: ping URL should look like https://hc-ping.com/<uuid>" >&2; exit 1 ;;
esac

PM2_BIN="$(command -v pm2 || true)"
if [ -z "$PM2_BIN" ]; then
  for cand in "$HOME"/.nvm/versions/node/*/bin/pm2 /opt/homebrew/bin/pm2 /usr/local/bin/pm2; do
    if [ -x "$cand" ]; then PM2_BIN="$cand"; break; fi
  done
fi
if [ -z "$PM2_BIN" ]; then
  echo "warning: pm2 not found on PATH; heartbeat will rely on the HTTP check only" >&2
fi

{
  echo "PT_HC_PING_URL=$PING_URL"
  echo "PT_PM2_BIN=$PM2_BIN"
} > "$CONF"
chmod 600 "$CONF"
echo "wrote $CONF"

# --- launchd agent ----------------------------------------------------------
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
    <string>$HEARTBEAT_SH</string>
  </array>
  <key>StartInterval</key>
  <integer>900</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/pt-heartbeat.out.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/pt-heartbeat.err.log</string>
</dict>
</plist>
EOF
echo "wrote $PLIST"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if ! launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null; then
  launchctl load -w "$PLIST"
fi
echo "launchd agent loaded ($LABEL, every 900s)"

# --- fire one heartbeat now so the check flips green ------------------------
bash "$HEARTBEAT_SH" || true
echo
echo "Heartbeat installed and first ping sent."
echo "Check https://healthchecks.io — the 'portfolio-tracker' check should be up."
echo "Last step: in healthchecks.io Settings, create a read-only API key and"
echo "give it to Muse via the secure link so it can read the status."
