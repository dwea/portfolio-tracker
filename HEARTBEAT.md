# Heartbeat

Lets the portfolio-tracker service be monitored from outside the Mac mini
with no inbound access to the machine. The checkpoint is
[healthchecks.io](https://healthchecks.io): the mini pings out, the service
watches the pings, and status can be read through its API.

(An earlier design used an ntfy.sh topic. That was dropped because the
monitoring side's network blocks ntfy.sh entirely, so the topic could never
be polled. healthchecks.io is reachable from both sides.)

## How it works

- A launchd agent runs `scripts/heartbeat.sh` every 15 minutes.
- The script checks the `portfolio-tracker` PM2 process and the local HTTP
  server on port 3000, then pings the check:
  - up → `POST https://hc-ping.com/<uuid>` with the status line as the body
  - down → `POST https://hc-ping.com/<uuid>/fail`
- If no ping arrives within the check's period + grace (15 + 15 minutes),
  healthchecks.io marks the check down and sends its own alert email — that
  case covers the machine or its network being down entirely.
- Status lines look like `pt-heartbeat up pid=12345 http=302` and carry no
  portfolio data.

## Setup

1. On healthchecks.io (free account), add a check named `portfolio-tracker`,
   period 15 minutes, grace 15 minutes. Copy its ping URL.
2. On the Mac:

   ```bash
   cd /Users/davestudio/portfolio-tracker
   git pull
   bash scripts/install-heartbeat.sh   # asks for the ping URL, stores it
                                       # in ~/.portfolio-tracker-heartbeat.conf
   ```

3. In healthchecks.io Settings, create a **read-only API key** and hand it to
   whoever monitors the check (e.g. Muse, via its secure credential flow).
   Status is then readable at `GET https://healthchecks.io/api/v3/checks/`.

The ping URL is a capability URL, so it lives only in the config file on the
Mac (mode 600) — never in this public repo.

## Uninstall

```bash
launchctl bootout gui/$(id -u)/com.dweaver.portfolio-tracker-heartbeat
rm ~/Library/LaunchAgents/com.dweaver.portfolio-tracker-heartbeat.plist
rm ~/.portfolio-tracker-heartbeat.conf
```
