import { readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { config as dotenvConfig } from 'dotenv';
import { Report, AccountData } from './types.js';
import { calculateAccount } from './calculator.js';
import { formatShort, formatDetailed, formatRebalanceReport } from './formatter.js';
import { generateSparkline } from './sparkline.js';
import { generateAccountChart } from './chart-generator.js';

// Redirect all console.log to stderr so only the formatted message goes to stdout
const origLog = console.log;
console.log = (...args: unknown[]) => process.stderr.write(args.join(' ') + '\n');

dotenvConfig();

const args = process.argv.slice(2);
const reportPath = args[0];
const format = (args[1] || 'detailed') as 'short' | 'detailed' | 'rebalance' | 'charts' | 'json';
const generateChart = args[2] === 'true';

if (!reportPath) {
  console.error('Usage: tsx src/preview.ts <report-path> [short|detailed]');
  process.exit(1);
}

async function runPreview(): Promise<void> {
  const content = await readFile(reportPath, 'utf-8');
  const config: Report = JSON.parse(content);

  const accounts: AccountData[] = [];
  for (const account of config.accounts) {
    accounts.push(await calculateAccount(account));
  }

  const grandTotal = accounts.reduce((sum, acc) => sum + acc.total, 0);
  const grandTotalChange = accounts.reduce((sum, acc) => sum + acc.totalChange, 0);
  const previousGrandTotal = grandTotal - grandTotalChange;
  const grandTotalChangePercent = previousGrandTotal > 0
    ? (grandTotalChange / previousGrandTotal) * 100 : 0;

  const reportData = {
    reportName: config.reportName,
    timestamp: new Date().toLocaleString('en-US', {
      weekday: 'short', year: 'numeric', month: 'short',
      day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
    }),
    accounts,
    grandTotal,
    grandTotalChange,
    grandTotalChangePercent,
  };

  if (format === 'json') {
    origLog(JSON.stringify(reportData));
    return;
  }

  if (format === 'charts') {
    // Generate charts for each account
    const charts = [];
    for (const account of config.accounts) {
      try {
        const url = await generateAccountChart(null, account.name, account.currency || 'CAD', 30);
        charts.push({ name: account.name, url });
      } catch (err: any) {
        charts.push({ name: account.name, error: err.message });
      }
    }
    origLog(JSON.stringify({ charts }));
    return;
  }

  const message = format === 'short'
    ? formatShort(reportData, config.formatOptions)
    : format === 'rebalance'
      ? formatRebalanceReport(reportData, config.formatOptions)
      : formatDetailed(reportData, config.formatOptions);

  if (generateChart) {
    const dataDir = join(process.cwd(), 'data');
    if (!existsSync(dataDir)) await mkdir(dataDir, { recursive: true });
    await generateSparkline(reportData, join(dataDir, 'sparkline.png'));
  }

  // Use original console.log so this goes to stdout
  origLog(message);
}

runPreview().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
