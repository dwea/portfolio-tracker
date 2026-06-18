# Portfolio Tracker

Automated portfolio tracking system that sends formatted text message reports on a schedule.

## Features

- **Multi-account tracking**: Track multiple investment accounts (LIRA, RSP, TFSA, etc.)
- **Automated scheduling**: Reports sent at specified times via cron
- **Flexible formatting**: Short summaries or detailed breakdowns
- **Alert triggers**: Get notified when positions exceed weight or price thresholds
- **Text message delivery**: Reports sent via SMS gateway email addresses
- **Real-time quotes**: Fetches latest prices from Yahoo Finance API

## Folder Structure

```
portfolio-tracker/
├── reports/                    # Your report config files go here
│   └── example-report.json
├── src/
│   ├── runner.ts              # Main scheduler
│   ├── calculator.ts          # Portfolio calculations
│   ├── formatter.ts           # Output formatting
│   ├── messenger.ts           # Send text messages
│   └── types.ts               # TypeScript interfaces
├── data/
│   └── last-run.json          # Tracks last execution (auto-generated)
├── logs/
│   └── reports.log            # Execution log (auto-generated)
├── package.json
└── tsconfig.json
```

## Setup Instructions

### Step 1: Install Dependencies

```bash
cd portfolio-tracker
npm install
```

### Step 2: Configure Your Reports

Edit `reports/example-report.json` or create new JSON files in the `reports/` folder.

**Report structure:**
```json
{
  "reportName": "Dave's Portfolio",
  "schedules": [
    {
      "when": "weekdays-at-9am",
      "format": "short"
    },
    {
      "when": "weekdays-at-4pm",
      "format": "detailed"
    }
  ],
  "alertRecipients": [
    "6047671579@msg.telus.com"
  ],
  "accounts": [...]
}
```

**SMS Gateway Email Addresses (Canadian carriers):**
- Telus: `[number]@msg.telus.com`
- Bell: `[number]@txt.bell.ca`
- Rogers: `[number]@sms.rogers.com`
- Fido: `[number]@fido.ca`
- Virgin: `[number]@vmobile.ca`

**Schedule options:**
- `weekdays-at-9am` - Mon-Fri at 9:00 AM
- `weekdays-at-12pm` - Mon-Fri at 12:00 PM
- `weekdays-at-4pm` - Mon-Fri at 4:00 PM
- `daily-at-9am` - Every day at 9:00 AM
- `daily-at-4pm` - Every day at 4:00 PM

**Ticker formats:**
- TSE stocks: `TSE:XDIV` (converted to `XDIV.TO` for Yahoo)
- NASDAQ stocks: `NASDAQ:GOOG`
- NYSE stocks: `NYSE:IBM`

### Step 3: Test Manual Runs

```bash
# Test detailed report
npx tsx src/runner.ts "Dave's Portfolio"

# Test short report
npx tsx src/runner.ts "Dave's Portfolio" short
```

### Step 4: Grant Messages Permissions

The first time you run, macOS will request permission:

1. System Settings → Privacy & Security → Automation
2. Find "Terminal" or "tsx" and enable "Messages"

### Step 5: Set Up Cron (Automated Scheduling)

```bash
# Open crontab editor
crontab -e
```

Add this line (replace with your actual path):
```
*/5 * * * * cd /Users/yourusername/Documents/portfolio-tracker && /usr/local/bin/npx tsx src/runner.ts scheduled >> logs/cron.log 2>&1
```

Find your path with: `pwd`

Save and exit (`:wq` in vim)

**Verify cron is set:**
```bash
crontab -l
```

## Usage

### Manual Runs

```bash
# Detailed report
npx tsx src/runner.ts "Dave's Portfolio"

# Short report
npx tsx src/runner.ts "Dave's Portfolio" short
```

### Check Logs

```bash
# Recent activity
tail -20 logs/reports.log

# Watch live
tail -f logs/reports.log

# Check cron execution
tail -20 logs/cron.log
```

### Add New Reports

1. Create a new JSON file in `reports/` folder
2. It will automatically be picked up by the scheduler

## Report Formats

### Short Format
```
Dave's Portfolio
Thu, Feb 13, 2025, 9:00 AM

TFSA: 99,336 (-0.3%)

RSP: 418,166 (-0.8%)
```

### Detailed Format
```
Dave's Portfolio
Thu, Feb 13, 2025, 4:00 PM
--------------------
TFSA
Total: 99,336 (-275 -0.3%)
XDIV 49,049 (-130 -0.3%) w49%
XEU 19,685 (-145 -0.7%) w20%
CASH 5,607 (0 +0.0%) w6%
--------------------
RSP
Total: 418,166 (-3,299 -0.8%)
XDIV 188,650 (-500 -0.3%) w45%
GOOG 23,163 (-140 -0.6%) w6%
AAPL 17,815 (-937 -5.0%) w4%
CASH 30,404 (0 +0.0%) w7%
TRIGGER LOG: XDIV weight 45.1% > 40%
--------------------
```

## Triggers

**Weight triggers:**
```json
{
  "ticker": "TSE:XDIV",
  "shares": 1300,
  "weightTriggerAbove": 55,
  "weightTriggerBelow": 40
}
```

**Price triggers:**
```json
{
  "ticker": "NASDAQ:AAPL",
  "shares": 50,
  "priceTriggerAbove": 250,
  "priceTriggerBelow": 200
}
```

## Troubleshooting

**No messages sent:**
```bash
# Check if Messages app is running
ps aux | grep Messages

# Test AppleScript manually
osascript -e 'tell application "Messages" to get name of services'
```

**Cron not running:**
```bash
# Check system logs
log show --predicate 'process == "cron"' --last 1h
```

**Quote fetch fails:**
```bash
# Test single quote
npx tsx -e "
import https from 'https';
https.get('https://query1.finance.yahoo.com/v8/finance/chart/XDIV.TO', res => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => console.log(JSON.parse(data)));
});
"
```

## Architecture

- **runner.ts**: Main scheduler, checks schedules and triggers reports
- **calculator.ts**: Fetches quotes from Yahoo Finance, calculates portfolio values
- **formatter.ts**: Generates short and detailed text output
- **messenger.ts**: Sends text messages via AppleScript and Messages app
- **types.ts**: TypeScript type definitions

## License

MIT
