# Portfolio Tracker - Project Notes

## Overview
A web-based portfolio tracking system that monitors stock positions and provides real-time updates on portfolio performance.

## Server Configuration

### Hosting Details
- **Server Location**: Mac mini on local network
- **IP Address**: 192.168.1.218
- **Port**: 3000
- **Access URL**: http://192.168.1.218:3000
- **Project Directory**: /Users/davestudio/portfolio-tracker

### Process Management
- **Process Manager**: PM2
- **Service Name**: portfolio-tracker
- **Auto-start**: Enabled (configured to start on Mac mini reboot)
- **Main Server File**: server.js

### PM2 Commands
```bash
pm2 status                          # Check server status
pm2 logs portfolio-tracker          # View server logs
pm2 restart portfolio-tracker       # Restart the server
pm2 stop portfolio-tracker          # Stop the server
pm2 start portfolio-tracker         # Start the server
pm2 save                            # Save current PM2 process list
```

## Project Structure

### Key Files
- `server.js` - Main Express server
- `public/index.html` - Main dashboard page
- `public/portfolio.html` - Portfolio details page
- `public/styles.css` - Shared styles
- `package.json` - Node.js dependencies

### Data Files
- `data/portfolio.csv` - Portfolio positions data
  - Format: Symbol, Quantity, Avg Cost, Current Price
  - Example: AAPL,100,150.00,175.50

## Features

### Dashboard (index.html)
- Total portfolio value display
- Total gain/loss calculation
- Percentage gain/loss
- Real-time stock price updates
- Top gainers and losers
- Sector allocation chart

### Portfolio Page (portfolio.html)
- Detailed position-by-position breakdown
- Individual stock gains/losses
- Current market values
- Price change indicators
- Sortable columns

## API Endpoints

### GET /api/portfolio
Returns complete portfolio data including:
- All positions with current prices
- Total portfolio value
- Total gain/loss
- Individual position metrics

Response format:
```json
{
  "positions": [...],
  "totalValue": 12345.67,
  "totalGain": 1234.56,
  "totalGainPercent": 10.5
}
```

## Setup Instructions (for reference)

### Initial Setup
1. Install dependencies: `npm install`
2. Ensure `data/portfolio.csv` exists with position data
3. Start server: `node server.js`

### Production Setup (Already Completed)
1. Install PM2: `sudo npm install -g pm2`
2. Start with PM2: `pm2 start server.js --name portfolio-tracker`
3. Configure auto-start: `pm2 startup` (follow provided command)
4. Save configuration: `pm2 save`

## Notes
- Server accessible from any device on the local network
- Mac mini must remain powered on for server availability
- PM2 ensures server restarts automatically after Mac mini reboots
- Stock price updates happen in real-time via API calls from the browser

## Report relay

Each report run writes a per-report copy, `data/last-report-<slug>.txt`
(e.g. `last-report-mum-report.txt`), alongside the shared `last-report.txt`,
which is overwritten by whichever report ran last. The per-report plaintext
files are gitignored and are never committed to the public repo. When
`PT_REPORTS_PASSPHRASE` is set in `.env`, an AES-256-GCM encrypted copy
(`.txt.enc`, base64 of salt || iv || tag || ciphertext, scrypt key) is
written alongside it.

A launchd job (`scripts/push-reports.sh`, installed by
`scripts/install-report-push.sh`, every 15 minutes) pushes the snapshots to
GitHub for Muse to relay. Two deployments, chosen at install time:
`private` copies the plaintext files into the private
`dwea/portfolio-reports` repo; `encrypted` commits the ciphertext files to
this repo and syncs the passphrase to the private repo as `passphrase.txt`.
The private repo is needed in both modes. Muse checks the repo at 7 PM
Vancouver and previews any new Mum Report to Dave before it goes to Sheila
by iMessage.
## Schedule Times Are Market Time

Report schedule times (`weekdays-at-10`, etc.) are in market time,
America/Toronto, and both schedulers (server.js node-cron and the runner CLI)
interpret them in that timezone. This keeps every report at the same point in
the trading day year-round: BC no longer changes its clocks, but Eastern
still does. In BC wall-clock terms the reports therefore run an hour later in
winter than in summer (e.g. the "30 minutes after the open" report is at
7:00 AM BC in summer, 8:00 AM BC in winter).

## Market status pill

The top bar in `public/index.html` shows a market-status pill
(`MarketStatus`, in the top-bar actions, so it is visible on the Portfolios
list and in the editor). It is computed in the browser from the viewer's
clock, in America/Toronto, the same market-time convention as the schedules.
Regular session 9:30 AM-4:00 PM ET, Mon-Fri; early closes end 1:00 PM ET.

When the US (NYSE) and Toronto (TSX) agree it shows one line ("Markets open
· Closes in 3h 12m", "Markets closed · Opens in 2h 5m", or "Opens Mon 9:30
AM" when the next open is a later day). When they differ it shows both
("US closed · opens Mon 9:30 AM | TSX open · closes in 5h"). It refreshes
every 30 seconds.

Holidays and early closes live in `MARKET_HOLIDAYS_US` and
`MARKET_HOLIDAYS_TSX` in `public/index.html`, checked against the NYSE and
TMX calendars in Nov 2026 and covering 2026-2027. Extend the tables each
year; a date past the tables is treated as a regular weekday. The logic is
pure functions (`exchangeStatus`, `etParts`, `marketSegment`) with no
network dependency, so a Yahoo outage cannot break it. Verified against
fixed instants (regular open/close, weekends, US-only and TSX-only holidays,
early closes, split Christmas week) before merging.
