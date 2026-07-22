import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { config as dotenvConfig } from 'dotenv';
import { Report, ReportData, AccountData, Schedule } from './types.js';
import { calculateAccount, pingYahoo } from './calculator.js';
import { formatShort, formatDetailed, formatRebalanceReport } from './formatter.js';
import { sendTextMessage } from './messenger.js';
import { generateSparkline } from './sparkline.js';
import { insertSnapshot, closeDatabase, buildSnapshotHoldings } from './db.js';
import { generateAccountChart } from './chart-generator.js';

// Load environment variables from .env file
dotenvConfig();

const SITE_BASE_URL = 'https://dwhy.uk';

// Mirrors the filename-derivation the editor uses to keep a report's file in sync
// with its display name, so a link built from reportName always resolves.
function reportUrl(reportName: string): string {
  const filename = reportName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '.json';
  return `${SITE_BASE_URL}/?report=${filename}`;
}

// Legacy presets for backward compatibility
const LEGACY_SCHEDULE_TIMES: Record<string, { days: number[]; hour: number; minute: number }> = {
  'weekdays-at-9am': { days: [1, 2, 3, 4, 5], hour: 9, minute: 0 },
  'weekdays-at-12pm': { days: [1, 2, 3, 4, 5], hour: 12, minute: 0 },
  'weekdays-at-4pm': { days: [1, 2, 3, 4, 5], hour: 16, minute: 0 },
  'daily-at-9am': { days: [0, 1, 2, 3, 4, 5, 6], hour: 9, minute: 0 },
  'daily-at-4pm': { days: [0, 1, 2, 3, 4, 5, 6], hour: 16, minute: 0 },
};

function parseScheduleWhen(when: string): { days: number[]; hour: number; minute: number } | null {
  // New format: "weekdays-at-7", "daily-at-14"
  const match = when.match(/^(weekdays|daily)-at-(\d+)$/);
  if (match) {
    const days = match[1] === 'weekdays' ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6];
    return { days, hour: parseInt(match[2]), minute: 0 };
  }
  // Legacy format
  return LEGACY_SCHEDULE_TIMES[when] || null;
}

function shouldRunNow(when: string): boolean {
  const sched = parseScheduleWhen(when);
  if (!sched) return false;

  const now = new Date();
  const currentDay = now.getDay();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  return (
    sched.days.includes(currentDay) &&
    sched.hour === currentHour &&
    currentMinute < 5
  );
}

function getTimestamp(): string {
  const now = new Date();
  return now.toLocaleString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

async function log(message: string): Promise<void> {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;

  const logsDir = join(process.cwd(), 'logs');
  if (!existsSync(logsDir)) {
    await mkdir(logsDir, { recursive: true });
  }

  const logPath = join(logsDir, 'reports.log');
  await writeFile(logPath, logMessage, { flag: 'a' });
  console.log(message);
}

async function generateReport(config: Report, format: 'short' | 'detailed' | 'rebalance' | 'charts'): Promise<ReportData> {
  const accounts: AccountData[] = [];

  for (const account of config.accounts) {
    const accountData = await calculateAccount(account);
    accounts.push(accountData);
  }

  const grandTotal = accounts.reduce((sum, acc) => sum + acc.total, 0);
  const grandTotalChange = accounts.reduce((sum, acc) => sum + acc.totalChange, 0);
  const previousGrandTotal = grandTotal - grandTotalChange;
  const grandTotalChangePercent =
    previousGrandTotal > 0 ? (grandTotalChange / previousGrandTotal) * 100 : 0;

  return {
    reportName: config.reportName,
    timestamp: getTimestamp(),
    accounts,
    grandTotal,
    grandTotalChange,
    grandTotalChangePercent,
  };
}

async function generateAndSendReport(config: Report, schedule: Schedule, testMode: boolean = false): Promise<void> {
  const { format, chart = 'none' } = schedule;
  await log(`Generating ${format} report: ${config.reportName}${chart !== 'none' ? ` (chart: ${chart})` : ''}${testMode ? ' (TEST MODE)' : ''}`);

  let reportData: ReportData;
  try {
    reportData = await generateReport(config, format);
  } catch (error: any) {
    await log(`✗ ${error.message}`);
    const errorMessage = 'unable to retrieve quotes, no response from yahoo';
    if (config.alertRecipients.length > 0) {
      await sendTextMessage(config.alertRecipients, errorMessage, testMode, log);
      await log(`✓ Sent error notification to ${config.alertRecipients.length} recipient(s)`);
    }
    return;
  }

  const dataDir = join(process.cwd(), 'data');
  if (!existsSync(dataDir)) {
    await mkdir(dataDir, { recursive: true });
  }

  // Capture daily snapshot to database
  if (!testMode) {
    try {
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
      const timestamp = now.toISOString();

      for (const account of reportData.accounts) {
        await insertSnapshot(
          dateStr,
          timestamp,
          account.name,
          account.currency,
          account.total,
          reportData.grandTotal,
          reportData.grandTotalChange,
          reportData.grandTotalChangePercent,
          JSON.stringify(buildSnapshotHoldings(account))
        );
      }
      await log(`✓ Saved daily snapshot to database`);
    } catch (error: any) {
      await log(`✗ Error saving snapshot: ${error.message}`);
    }
  }

  const sparklinePath = join(dataDir, 'sparkline.png');

  // Always generate sparkline to disk if chart mode is requested
  if (chart !== 'none') {
    await generateSparkline(reportData, sparklinePath);
    await log(`Wrote sparkline to data/sparkline.png`);
  }

  const imageOnly = chart === 'image-only';

  if (!imageOnly) {
    let message = format === 'charts'
      ? `Charts generated for ${reportData.accounts.map(a => a.name).join(', ')}`
      : format === 'short'
        ? formatShort(reportData, config.formatOptions)
        : format === 'rebalance'
          ? formatRebalanceReport(reportData, config.formatOptions)
          : formatDetailed(reportData, config.formatOptions);

    message = `${message}\n${reportUrl(config.reportName)}`;

    // Generate charts silently (for web UI access, not for ntfy messages)
    if (!testMode) {
      try {
        for (const account of reportData.accounts) {
          await generateAccountChart(
            null, // db parameter (will be initialized in chart-generator)
            account.name,
            account.currency,
            30
          );
        }
        await log(`✓ Generated ${reportData.accounts.length} performance chart(s)`);
      } catch (error: any) {
        await log(`✗ Error generating charts: ${error.message}`);
        // Continue sending message even if chart generation fails
      }
    }

    await writeFile(join(dataDir, 'last-report.txt'), message);
    await log(`Wrote report preview to data/last-report.txt`);

    if (config.alertRecipients.length > 0) {
      await sendTextMessage(config.alertRecipients, message, testMode, log);
      if (!testMode) {
        await log(`✓ Sent ${format} report to ${config.alertRecipients.length} recipient(s)`);
      }
    } else {
      await log(`No recipients, output:\n${message}`);
    }
  }

  // Close database connection
  await closeDatabase();

  // Image sending not supported — sparkline is available in the editor preview only
}

async function runScheduled(): Promise<void> {
  await log('=== Running scheduled check ===');

  const reportsDir = join(process.cwd(), 'reports');
  if (!existsSync(reportsDir)) {
    await log('Reports directory not found');
    return;
  }

  const files = await readdir(reportsDir);
  let ranCount = 0;

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    try {
      const content = await readFile(join(reportsDir, file), 'utf-8');
      const config: Report = JSON.parse(content);

      for (const schedule of config.schedules || []) {
        if (shouldRunNow(schedule.when)) {
          await generateAndSendReport(config, schedule, false);
          ranCount++;
        }
      }
    } catch (error) {
      await log(`✗ Error processing ${file}: ${error}`);
    }
  }

  if (ranCount === 0) {
    await log('No reports due at this time');
  }
}

async function runManual(
  reportName: string,
  format: 'short' | 'detailed' | 'rebalance' | 'charts' = 'detailed',
  chartMode: 'none' | 'image' | 'image-only' = 'none',
  testMode: boolean = false
): Promise<void> {
  await log(`=== Manual run: ${reportName} (${format}${chartMode !== 'none' ? ', chart: ' + chartMode : ''})${testMode ? ' - TEST MODE' : ''} ===`);

  const reportsDir = join(process.cwd(), 'reports');
  const files = await readdir(reportsDir);

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const content = await readFile(join(reportsDir, file), 'utf-8');
    const config: Report = JSON.parse(content);

    if (config.reportName === reportName) {
      await generateAndSendReport(config, { when: 'manual', format, chart: chartMode }, testMode);
      return;
    }
  }

  await log(`✗ Report "${reportName}" not found`);
}

// Parse command line arguments
function parseArgs(): {
  mode: string;
  format?: 'short' | 'detailed' | 'rebalance';
  chart: 'none' | 'image' | 'image-only';
  isTest: boolean;
} {
  const args = process.argv.slice(2);

  // Check for --chart flag
  let chart: 'none' | 'image' | 'image-only' = 'none';
  const chartArgIndex = args.findIndex(arg => arg.startsWith('--chart='));
  if (chartArgIndex !== -1) {
    const chartValue = args[chartArgIndex].split('=')[1];
    if (['none', 'image', 'image-only'].includes(chartValue)) {
      chart = chartValue as 'none' | 'image' | 'image-only';
    }
    args.splice(chartArgIndex, 1);
  }

  const mode = args[0] || '';
  const format = args[1] as 'short' | 'detailed' | 'rebalance' | 'charts' | 'test' | undefined;
  const testFlag = args[2];

  const isTest = format === 'test' || testFlag === 'test' || args.includes('test');
  const actualFormat = (format === 'test' ? 'detailed' : format) as 'short' | 'detailed' | 'rebalance' | 'charts' | undefined;

  return { mode, format: actualFormat, chart, isTest };
}

// Main entry point
const { mode, format, chart, isTest } = parseArgs();

if (mode === 'ping') {
  const ticker = process.argv[3] || 'AAPL';
  pingYahoo(ticker).catch(console.error);
} else if (mode === 'scheduled') {
  runScheduled().catch(console.error);
} else if (mode) {
  runManual(mode, format || 'detailed', chart, isTest).catch(console.error);
} else {
  console.log('Usage:');
  console.log('  tsx src/runner.ts ping [ticker]                     # Test Yahoo Finance access');
  console.log('  tsx src/runner.ts scheduled                         # Run scheduled reports');
  console.log('  tsx src/runner.ts "Report Name" [short|detailed] [test]');
  console.log('');
  console.log('Examples:');
  console.log('  tsx src/runner.ts ping                              # Check if rate limited');
  console.log('  tsx src/runner.ts "Report B" short                  # Send short report');
  console.log('  tsx src/runner.ts "Report B" short test             # Preview without sending');
}
