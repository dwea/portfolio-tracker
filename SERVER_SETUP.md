# Portfolio Tracker Web Server Setup

## Quick Start (Mac Mini)

### 1. Install Dependencies
```bash
cd /Users/davestudio/portfolio-tracker
npm install
```

### 2. Start the Server
```bash
npm run server
```

The server will start on port 3000. You can access it from any device on your WiFi network:
- **Editor**: http://192.168.1.93:3000/
- **Schedules**: http://192.168.1.93:3000/schedules.html

### 3. What It Does

The server:
- ✅ Serves the HTML editor for creating/editing report definitions
- ✅ Provides API endpoints to save reports
- ✅ Automatically schedules reports based on their schedule definitions
- ✅ Runs reports at scheduled times and sends SMS
- ✅ Shows all scheduled reports and execution history

## Pages

### Editor (`/`)
- Edit report definitions (stocks, accounts, schedules)
- Add/modify schedules
- Save changes (automatically reschedules)

### Schedules (`/schedules.html`)
- View all scheduled reports (like `crontab -l`)
- See today's scheduled reports
- View last run times and status
- Manually trigger reports with "Run Now" button

## API Endpoints

- `GET /api/reports` - List all reports
- `GET /api/reports/:filename` - Get specific report
- `POST /api/reports/:filename` - Save report (reschedules automatically)
- `POST /api/reports/:filename/run` - Manually run a report
- `GET /api/schedules` - Get all scheduled jobs
- `GET /api/reports/:filename/logs` - Get execution logs

## Schedule Formats

The server understands these human-readable formats:
- `weekdays-at-4pm` → Runs Mon-Fri at 4:00 PM
- `weekdays-at-9am` → Runs Mon-Fri at 9:00 AM
- `daily-at-5pm` → Runs every day at 5:00 PM
- `daily-at-9am` → Runs every day at 9:00 AM
- `weekends-at-10am` → Runs Sat-Sun at 10:00 AM
- `monday-at-9am` → Runs Mondays at 9:00 AM
- `friday-at-5pm` → Runs Fridays at 5:00 PM

Or use standard cron syntax:
- `0 16 * * 1-5` → Mon-Fri at 4:00 PM
- `0 9 * * *` → Every day at 9:00 AM

## Auto-Start on Boot

To make the server start automatically when Mac mini boots:

### Option 1: Using launchd (Recommended)

Create a plist file:
```bash
nano ~/Library/LaunchAgents/com.portfolio-tracker.server.plist
```

Paste this content:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.portfolio-tracker.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/Users/davestudio/portfolio-tracker/server.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>/Users/davestudio/portfolio-tracker</string>
    <key>StandardOutPath</key>
    <string>/Users/davestudio/portfolio-tracker/logs/server.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/davestudio/portfolio-tracker/logs/server-error.log</string>
</dict>
</plist>
```

Load it:
```bash
launchctl load ~/Library/LaunchAgents/com.portfolio-tracker.server.plist
```

### Option 2: Using PM2 (Alternative)

```bash
npm install -g pm2
pm2 start server.js --name portfolio-tracker
pm2 save
pm2 startup
```

## Troubleshooting

**Server won't start:**
- Check if Node.js is installed: `node --version`
- Check if dependencies are installed: `npm install`
- Check if port 3000 is already in use: `lsof -i :3000`

**Can't access from phone/other devices:**
- Make sure you're on the same WiFi network
- Check Mac mini's IP address: `ifconfig | grep inet`
- Make sure Mac mini's firewall allows connections on port 3000

**Schedules not running:**
- Check server logs for errors
- Verify cron syntax is valid
- Make sure report has `enabled: true` (or no `enabled` field)

## Security

**Current setup:**
- ✅ WiFi-only access (not exposed to internet)
- ✅ Only accessible on local network (192.168.1.x)
- ⚠️ No password protection (planned for future)

To add password protection later, we can implement basic auth or session-based login.
