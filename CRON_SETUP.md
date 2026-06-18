# Cron Job Setup for Portfolio Tracker

## Schedule: Weekdays at 7:00 AM

This will run your portfolio report every Monday-Friday at 7:00 AM using Google Sheets as the data source.

## Step 1: Open Crontab Editor

```bash
crontab -e
```

This opens your cron configuration file in a text editor (usually vim).

## Step 2: Add the Cron Entry

Add this line to your crontab:

```bash
0 7 * * 1-5 cd /Users/davestudio/portfolio-tracker && /usr/local/bin/npx tsx src/runner.ts "Daves_report" detailed >> logs/cron.log 2>&1
```

**Explanation:**
- `0 7 * * 1-5` - Run at 7:00 AM on weekdays (Mon-Fri)
  - `0` = minute (0)
  - `7` = hour (7 AM)
  - `*` = any day of month
  - `*` = any month
  - `1-5` = Monday through Friday
- `cd /Users/davestudio/portfolio-tracker` - Change to project directory
- `/usr/local/bin/npx tsx src/runner.ts "Daves_report" detailed` - Run the report
- `>> logs/cron.log 2>&1` - Append all output to logs/cron.log

## Step 3: Save and Exit

If using vim (default editor):
1. Press `i` to enter insert mode
2. Paste the cron line
3. Press `Esc` to exit insert mode
4. Type `:wq` and press `Enter` to save and quit

## Step 4: Verify Cron Job is Set

```bash
crontab -l
```

You should see your new cron entry listed.

## Alternative Schedules

If you want different times, here are other common schedules:

### Market Open (9:30 AM weekdays)
```bash
30 9 * * 1-5 cd /Users/davestudio/portfolio-tracker && /usr/local/bin/npx tsx src/runner.ts "Daves_report" detailed >> logs/cron.log 2>&1
```

### Market Close (4:00 PM weekdays)
```bash
0 16 * * 1-5 cd /Users/davestudio/portfolio-tracker && /usr/local/bin/npx tsx src/runner.ts "Daves_report" detailed >> logs/cron.log 2>&1
```

### Multiple Times Per Day
Add multiple lines for different times:
```bash
0 7 * * 1-5 cd /Users/davestudio/portfolio-tracker && /usr/local/bin/npx tsx src/runner.ts "Daves_report" short >> logs/cron.log 2>&1
0 16 * * 1-5 cd /Users/davestudio/portfolio-tracker && /usr/local/bin/npx tsx src/runner.ts "Daves_report" detailed >> logs/cron.log 2>&1
```

## Important: Grant Cron Permission on macOS

macOS Ventura and later require permission for cron to run:

1. **System Settings** → **Privacy & Security** → **Full Disk Access**
2. Click the **+** button
3. Navigate to `/usr/sbin/cron` (press Cmd+Shift+G to go to folder)
4. Add `cron` to the allowed list

Alternatively, the first time cron runs, macOS may prompt you to grant permission.

## Monitoring Your Cron Job

### View Cron Logs
```bash
tail -f /Users/davestudio/portfolio-tracker/logs/cron.log
```

### Check Recent Runs
```bash
tail -20 /Users/davestudio/portfolio-tracker/logs/cron.log
```

### Check System Logs for Cron
```bash
log show --predicate 'process == "cron"' --last 1h
```

## Test Before Setting Up Cron

Always test your command manually first:

```bash
cd /Users/davestudio/portfolio-tracker && /usr/local/bin/npx tsx src/runner.ts "Daves_report" test
```

If this works, then the cron job will work too.

## Troubleshooting

### Cron Not Running?

1. **Check cron is running:**
   ```bash
   ps aux | grep cron
   ```

2. **Check for errors in system log:**
   ```bash
   grep cron /var/log/system.log
   ```

3. **Test the full command manually:**
   ```bash
   cd /Users/davestudio/portfolio-tracker && /usr/local/bin/npx tsx src/runner.ts "Daves_report" detailed
   ```

### No Output in Logs?

- Make sure the `logs/` directory exists
- Check file permissions: `ls -la logs/`
- Try redirecting to a different location temporarily

### Environment Variables Not Loading?

The `.env` file should load automatically because we call `dotenvConfig()` in the code. However, if you have issues:

Add environment variables directly to the cron line:
```bash
0 7 * * 1-5 cd /Users/davestudio/portfolio-tracker && PRICE_SOURCE=google /usr/local/bin/npx tsx src/runner.ts "Daves_report" detailed >> logs/cron.log 2>&1
```

## Disable or Remove Cron Job

To temporarily disable, add `#` at the beginning of the line:
```bash
# 0 7 * * 1-5 cd /Users/davestudio/portfolio-tracker && /usr/local/bin/npx tsx src/runner.ts "Daves_report" detailed >> logs/cron.log 2>&1
```

To remove completely:
```bash
crontab -e
# Delete the line and save
```

## Using the Built-in Scheduler Instead

Your portfolio tracker also has a built-in scheduler. Instead of cron, you could run:

```bash
0 7 * * 1-5 cd /Users/davestudio/portfolio-tracker && /usr/local/bin/npx tsx src/runner.ts scheduled >> logs/cron.log 2>&1
```

And update your `reports/daves-report.json` schedules to:
```json
"schedules": [
  {
    "when": "weekdays-at-7am",
    "format": "detailed"
  }
]
```

But you'd need to add `weekdays-at-7am` to the `SCHEDULE_TIMES` in `src/runner.ts` first.

The direct approach (first method) is simpler for now.
