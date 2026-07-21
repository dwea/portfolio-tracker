// One-off maintenance script: reconstructs daily_snapshots rows for dates where a
// report's snapshot was never saved at all (as opposed to backfill-history.ts, which
// repairs rows that exist but have a wrong/stale price).
//
// This only works when the account's holdings didn't change between the closest
// snapshot before and after the gap — verify that manually before adding a case below.
// Each entry says which account is missing which date, and which existing snapshot
// to copy the holdings structure (tickers/shares/cash) from.
//
// Usage: npx tsx scripts/restore-missing-days.ts
import initSqlJs from 'sql.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import YahooFinance from 'yahoo-finance2';
import { insertSnapshot } from '../src/db.js';

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const DB_PATH = join(process.cwd(), 'data', 'portfolio.db');

const RESTORE_JOBS = [
  { account: 'Registered-1', missingDates: ['2026-07-16', '2026-07-20'], templateDate: '2026-07-15' },
  { account: 'Registered-2', missingDates: ['2026-07-16', '2026-07-20'], templateDate: '2026-07-15' },
  { account: 'Registered-3', missingDates: ['2026-07-16', '2026-07-20'], templateDate: '2026-07-15' },
  { account: 'Registered-4', missingDates: ['2026-07-16', '2026-07-20'], templateDate: '2026-07-15' },
  { account: 'Non-registered', missingDates: ['2026-07-16', '2026-07-20'], templateDate: '2026-07-15' },
];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function convertToYahooTicker(ticker: string): string {
  if (ticker.startsWith('TSE:')) return ticker.replace('TSE:', '') + '.TO';
  if (ticker.startsWith('NASDAQ:') || ticker.startsWith('NYSE:')) return ticker.split(':')[1].toUpperCase();
  return ticker.toUpperCase();
}

async function fetchHistoricalCloses(yahooSymbol: string, period1: string, period2: string) {
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await yf.chart(yahooSymbol, { period1, period2, interval: '1d' });
      const byDate = new Map<string, number>();
      for (const q of result.quotes) {
        if (typeof q.close === 'number') byDate.set(q.date.toISOString().slice(0, 10), q.close);
      }
      return { currency: result.meta.currency, byDate };
    } catch (e: any) {
      if (attempt === maxRetries - 1) {
        console.warn(`  ⚠ ${yahooSymbol}: failed after ${maxRetries} attempts (${e.message})`);
        return null;
      }
      await delay(1000 * (attempt + 1));
    }
  }
  return null;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log(`Loading ${DB_PATH}...`);
  if (!existsSync(DB_PATH)) throw new Error('No database found at ' + DB_PATH);
  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(DB_PATH));

  const allDates = Array.from(new Set(RESTORE_JOBS.flatMap((j) => j.missingDates))).sort();
  const minDate = allDates[0];
  const maxDate = allDates[allDates.length - 1];

  // Gather every ticker across every template snapshot we're about to copy from.
  const tickersToFetch = new Set<string>();
  const templates: Record<string, any[]> = {};
  for (const job of RESTORE_JOBS) {
    const res = db.exec(
      `SELECT snapshot FROM daily_snapshots WHERE account_name = '${job.account.replace(/'/g, "''")}' AND date = '${job.templateDate}'`
    );
    if (res.length === 0) throw new Error(`No template snapshot found for ${job.account} on ${job.templateDate}`);
    const holdings = JSON.parse(res[0].values[0][0] as string);
    templates[job.account] = holdings;
    holdings.forEach((h: any) => {
      const displayTicker = h.displayTicker || h.ticker;
      if (displayTicker && displayTicker !== 'Cash' && displayTicker !== 'CASH') {
        tickersToFetch.add(displayTicker);
      }
    });
  }

  console.log(`Fetching historical CAD/USD exchange rate for ${minDate} → ${maxDate}...`);
  const fx = await fetchHistoricalCloses('CADUSD=X', minDate, addDays(maxDate, 1));
  const fxByDate = fx?.byDate ?? new Map<string, number>();

  console.log(`Fetching ${tickersToFetch.size} tickers...`);
  const historyBySymbol = new Map<string, { currency: string; byDate: Map<string, number> }>();
  const symbols = Array.from(tickersToFetch);
  for (let i = 0; i < symbols.length; i++) {
    const displayTicker = symbols[i];
    const yahooSymbol = convertToYahooTicker(displayTicker);
    process.stdout.write(`  [${i + 1}/${symbols.length}] ${yahooSymbol}... `);
    const hist = await fetchHistoricalCloses(yahooSymbol, minDate, addDays(maxDate, 1));
    if (hist) {
      console.log(`✓ ${hist.byDate.size} days, ${hist.currency}`);
      historyBySymbol.set(displayTicker, hist);
    } else {
      console.log('✗ skipped');
    }
    if (i < symbols.length - 1) await delay(400);
  }

  // Look up the account's currency (needed for FX conversion) from any existing row.
  const currencyByAccount: Record<string, string> = {};
  for (const job of RESTORE_JOBS) {
    const res = db.exec(
      `SELECT account_currency FROM daily_snapshots WHERE account_name = '${job.account.replace(/'/g, "''")}' LIMIT 1`
    );
    currencyByAccount[job.account] = (res[0]?.values[0]?.[0] as string) || 'CAD';
  }

  let inserted = 0;
  for (const job of RESTORE_JOBS) {
    const accountCurrency = currencyByAccount[job.account];
    for (const date of job.missingDates) {
      const holdings = JSON.parse(JSON.stringify(templates[job.account])); // deep copy per date
      let cashValue = 0;
      let nonCashTotal = 0;
      let anyMissing = false;

      for (const h of holdings) {
        const displayTicker = h.displayTicker || h.ticker;
        if (!displayTicker || displayTicker === 'Cash' || displayTicker === 'CASH') {
          cashValue += h.value || 0;
          continue;
        }
        const hist = historyBySymbol.get(displayTicker);
        const nativeClose = hist?.byDate.get(date);
        if (hist && typeof nativeClose === 'number') {
          let convFactor = 1;
          if (hist.currency === 'USD' && accountCurrency === 'CAD') {
            const usdToCad = fxByDate.get(date);
            convFactor = usdToCad ? 1 / usdToCad : (h.convFactor || 1);
          } else if (hist.currency === 'CAD' && accountCurrency === 'USD') {
            const usdToCad = fxByDate.get(date);
            convFactor = usdToCad || (h.convFactor || 1);
          }
          const newPrice = nativeClose * convFactor;
          h.price = newPrice;
          h.value = newPrice * (h.shares || 0);
          if (convFactor !== 1) h.convFactor = convFactor; else delete h.convFactor;
        } else {
          anyMissing = true;
          console.warn(`  ⚠ No historical price for ${displayTicker} on ${date} — leaving its ${job.templateDate} value in place`);
        }
        nonCashTotal += h.value || 0;
      }

      const accountTotal = nonCashTotal + cashValue;
      await insertSnapshot(
        date,
        `${date}T16:00:00.000Z`, // approximate market-close timestamp for a reconstructed day
        job.account,
        accountCurrency,
        accountTotal,
        accountTotal, // portfolio_total_cad isn't read anywhere; single-account approximation is fine
        0, // daily_change/percent aren't read anywhere either (see db.ts getHistory)
        0,
        JSON.stringify(holdings)
      );
      inserted++;
      console.log(`✓ Restored ${job.account} / ${date}${anyMissing ? ' (partial)' : ''}`);
    }
  }

  console.log(`\nDone. Inserted ${inserted} reconstructed rows.`);
}

main().catch((e) => {
  console.error('Restore failed:', e);
  process.exit(1);
});
