# Portfolio Tracker - Quick Reference

## Common Commands

### Manual Report Generation
```bash
# Detailed report (default)
npx tsx src/runner.ts "Dave's Portfolio"

# Short report
npx tsx src/runner.ts "Dave's Portfolio" short
```

### View Logs
```bash
# Last 20 lines
tail -20 logs/reports.log

# Watch live
tail -f logs/reports.log

# Check cron logs
tail -20 logs/cron.log
```

## Report Configuration

### Basic Structure
```json
{
  "reportName": "Your Report Name",
  "schedules": [
    { "when": "weekdays-at-4pm", "format": "detailed" }
  ],
  "alertRecipients": ["number@carrier.com"],
  "accounts": [...]
}
```

### Schedule Options
- `weekdays-at-9am` - Mon-Fri 9:00 AM
- `weekdays-at-12pm` - Mon-Fri 12:00 PM  
- `weekdays-at-4pm` - Mon-Fri 4:00 PM
- `daily-at-9am` - Every day 9:00 AM
- `daily-at-4pm` - Every day 4:00 PM

### SMS Gateways (Canada)
- Telus: `6041234567@msg.telus.com`
- Bell: `6041234567@txt.bell.ca`
- Rogers: `6041234567@sms.rogers.com`
- Fido: `6041234567@fido.ca`
- Virgin: `6041234567@vmobile.ca`

### Ticker Formats
- TSE: `TSE:XDIV` → converts to `XDIV.TO`
- NASDAQ: `NASDAQ:GOOG`
- NYSE: `NYSE:IBM`

### Trigger Examples

**Weight trigger (notify if position grows too large):**
```json
{
  "ticker": "TSE:XDIV",
  "shares": 1300,
  "weightTriggerAbove": 55
}
```

**Price trigger (notify if price crosses threshold):**
```json
{
  "ticker": "NASDAQ:AAPL",
  "shares": 50,
  "priceTriggerBelow": 200
}
```

## Cron Setup

### Edit crontab
```bash
crontab -e
```

### Add this line (update path)
```
*/5 * * * * cd /path/to/portfolio-tracker && /usr/local/bin/npx tsx src/runner.ts scheduled >> logs/cron.log 2>&1
```

### Find your path
```bash
pwd
```

### View current cron jobs
```bash
crontab -l
```

## Troubleshooting

### Check if Messages app has permissions
```bash
osascript -e 'tell application "Messages" to get name of services'
```

### Test quote fetching
```bash
npx tsx -e "
import https from 'https';
https.get('https://query1.finance.yahoo.com/v8/finance/chart/XDIV.TO', res => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => console.log(JSON.parse(data).chart.result[0].meta));
});
"
```

### Grant Messages permissions
System Settings → Privacy & Security → Automation → Terminal/tsx → Enable Messages

## File Locations

- **Report configs**: `reports/*.json`
- **Source code**: `src/*.ts`
- **Logs**: `logs/reports.log` (script logs) and `logs/cron.log` (cron logs)
- **Data**: `data/` (auto-generated)
