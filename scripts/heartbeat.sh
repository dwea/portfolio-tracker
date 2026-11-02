#!/usr/bin/env bash
# portfolio-tracker heartbeat.
#
# Pings a healthchecks.io check every 15 minutes (via launchd, see
# install-heartbeat.sh) so the service can be monitored from outside the
# machine with no inbound access:
#
#   service up   -> POST <ping-url>        with the status line as the body
#   service down -> POST <ping-url>/fail   with the status line as the body
#   (no ping at all within the check's period + grace also raises the alarm,
#    which covers the machine or its network being down entirely)
#
# Config lives in ~/.portfolio-tracker-heartbeat.conf (written by the
# installer, not in git, because the ping URL is a capability URL):
#
#   PT_HC_PING_URL=https://hc-ping.com/<uuid>
#   PT_PM2_BIN=/path/to/pm2        (may be empty; HTTP check still runs)
#
# Status line format (single line, also the ping body):
#   pt-heartbeat up pid=12345 http=302
#   pt-heartbeat down pid=none http=000
# "up" means the PM2 process exists AND the HTTP server answers on :3000.

set -u
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH

CONF="$HOME/.portfolio-tracker-heartbeat.conf"
[ -f "$CONF" ] || exit 0
# shellcheck disable=SC1090
. "$CONF"
[ -n "${PT_HC_PING_URL:-}" ] || exit 0

PID="none"
if [ -n "${PT_PM2_BIN:-}" ] && [ -x "${PT_PM2_BIN:-}" ]; then
  RAW="$("$PT_PM2_BIN" pid portfolio-tracker 2>/dev/null | head -n 1 || true)"
  case "$RAW" in
    ''|*[!0-9]*) PID="none" ;;
    *) PID="$RAW" ;;
  esac
fi

HTTP="$(curl -s -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/ 2>/dev/null || true)"
[ -n "$HTTP" ] || HTTP="000"

if [ "$PID" != "none" ] && [ "$HTTP" != "000" ]; then
  STATE="up"
  URL="$PT_HC_PING_URL"
else
  STATE="down"
  URL="$PT_HC_PING_URL/fail"
fi

MSG="pt-heartbeat $STATE pid=$PID http=$HTTP"
curl -s -m 10 -d "$MSG" "$URL" >/dev/null 2>&1 || true

exit 0
