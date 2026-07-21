// One-off maintenance script: replaces the price recorded for each holding on each
// historical day with Yahoo Finance's real historical close, then recomputes
// account_total/daily_change/daily_change_percent from those corrected prices.
//
// Why this is needed: calculateAccount()'s in-process quote cache had no expiry
// (fixed in src/calculator.ts), so many days' snapshots got stamped with a stale
// cached price instead of that day's real one. This script repairs the historical
// record after the fact using Yahoo's per-symbol historical chart endpoint.
//
// Usage: npx tsx scripts/backfill-history.ts
import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import YahooFinance from 'yahoo-finance2';

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const DB_PATH = join(process.cwd(), 'data', 'portfolio.db');

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Mirrors calculator.ts's convertToYahooTicker so lookups match what calculateAccount would fetch.
function convertToYahooTicker(ticker: string): string {
  if (ticker.startsWith('TSE:')) return ticker.replace('TSE:', '') + '.TO';
  if (ticker.startsWith('NASDAQ:') || ticker.startsWith('NYSE:')) return ticker.split(':')[1].toUpperCase();
  return ticker.toUpperCase();
}

interface Row {
  id: number;
  date: string;
  account_name: string;
  account_currency: string;
  snapshot: any[];
}

async function fetchHistoricalCloses(yahooSymbol: string, period1: string, period2: string): Promise<{ currency: string; byDate: Map<string, number> } | null> {
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await yf.chart(yahooSymbol, { period1, period2, interval: '1d' });
      const byDate = new Map<string, number>();
      for (const q of result.quotes) {
        if (typeof q.close === 'number') {
          byDate.set(q.date.toISOString().slice(0, 10), q.close);
        }
      }
      return { currency: result.meta.currency, byDate };
    } catch (e: any) {
      if (attempt === maxRetries - 1) {
        console.warn(`  ⚠ ${yahooSymbol}: failed after ${maxRetries} attempts (${e.message}) — leaving its rows unchanged`);
        return null;
      }
      await delay(1000 * (attempt + 1));
    }
  }
  return null;
}

async function main() {
  console.log(`Loading ${DB_PATH}...`);
  const SQL = await initSqlJs();
  if (!existsSync(DB_PATH)) throw new Error('No database found at ' + DB_PATH);
  const db = new SQL.Database(readFileSync(DB_PATH));

  const result = db.exec(`SELECT id, date, account_name, account_currency, snapshot FROM daily_snapshots ORDER BY account_name, date`);
  if (result.length === 0) {
    console.log('No snapshots found.');
    return;
  }
  const cols = result[0].columns;
  const rows: Row[] = result[0].values.map(v => ({
    id: v[cols.indexOf('id')] as number,
    date: v[cols.indexOf('date')] as string,
    account_name: v[cols.indexOf('account_name')] as string,
    account_currency: (v[cols.indexOf('account_currency')] as string) || 'CAD',
    snapshot: JSON.parse((v[cols.indexOf('snapshot')] as string) || '[]'),
  }));
  console.log(`Loaded ${rows.length} snapshot rows across ${new Set(rows.map(r => r.account_name)).size} accounts.`);

  // Map: display ticker (as stored in snapshots) -> Yahoo symbol to fetch.
  // Map: Yahoo symbol -> {minDate, maxDate} across every row it appears in.
  const displayToYahoo = new Map<string, string>();
  const yahooRange = new Map<string, { min: string; max: string }>();

  let globalMin = rows[0].date, globalMax = rows[0].date;
  for (const row of rows) {
    if (row.date < globalMin) globalMin = row.date;
    if (row.date > globalMax) globalMax = row.date;
    for (const h of row.snapshot) {
      const displayTicker = h.displayTicker || h.ticker;
      if (!displayTicker || displayTicker === 'Cash' || displayTicker === 'CASH') continue;
      const yahooSymbol = convertToYahooTicker(displayTicker);
      displayToYahoo.set(displayTicker, yahooSymbol);
      const range = yahooRange.get(yahooSymbol);
      if (!range) {
        yahooRange.set(yahooSymbol, { min: row.date, max: row.date });
      } else {
        if (row.date < range.min) range.min = row.date;
        if (row.date > range.max) range.max = row.date;
      }
    }
  }

  console.log(`Found ${yahooRange.size} unique Yahoo symbols to backfill, date range ${globalMin} → ${globalMax}.`);

  // Historical FX (USD->CAD) for the whole span, used to convert USD-listed holdings in CAD accounts.
  console.log('Fetching historical CAD/USD exchange rate...');
  const fxResult = await fetchHistoricalCloses('CADUSD=X', globalMin, addDays(globalMax, 1));
  const fxByDate = fxResult?.byDate ?? new Map<string, number>();
  if (!fxResult) console.warn('  ⚠ Could not fetch historical FX rates — USD holdings in CAD accounts will be left unchanged.');

  // Fetch each Yahoo symbol's historical closes, one at a time with a short delay to be gentle on Yahoo.
  const historyBySymbol = new Map<string, { currency: string; byDate: Map<string, number> }>();
  const symbols = Array.from(yahooRange.keys());
  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    const range = yahooRange.get(symbol)!;
    process.stdout.write(`  [${i + 1}/${symbols.length}] ${symbol} (${range.min} → ${range.max})... `);
    const hist = await fetchHistoricalCloses(symbol, range.min, addDays(range.max, 1));
    if (hist) {
      console.log(`✓ ${hist.byDate.size} days, ${hist.currency}`);
      historyBySymbol.set(symbol, hist);
    }
    if (i < symbols.length - 1) await delay(400);
  }

  // Apply corrected prices to each row's snapshot. Today's row is left alone — it was
  // already written by the live-quote pipeline (now fixed to expire its quote cache),
  // so it's more accurate than an approximate same-day historical close would be.
  const today = new Date().toISOString().slice(0, 10);
  let rowsTouched = 0;
  let holdingsUpdated = 0;
  let holdingsSkipped = 0;
  const skippedSymbols = new Set<string>();
  const accountTotals = new Map<string, { date: string; total: number }[]>(); // account_name -> chronological totals

  for (const row of rows) {
    if (row.date === today) continue;
    let changed = false;
    let cashValue = 0;
    let nonCashTotal = 0;

    for (const h of row.snapshot) {
      const displayTicker = h.displayTicker || h.ticker;
      if (!displayTicker || displayTicker === 'Cash' || displayTicker === 'CASH') {
        cashValue += h.value || 0;
        continue;
      }
      const yahooSymbol = displayToYahoo.get(displayTicker)!;
      const hist = historyBySymbol.get(yahooSymbol);
      const nativeClose = hist?.byDate.get(row.date);

      if (hist && typeof nativeClose === 'number') {
        const holdingCurrency = hist.currency;
        let convFactor = 1;
        if (holdingCurrency === 'USD' && row.account_currency === 'CAD') {
          const usdToCad = fxByDate.get(row.date);
          convFactor = usdToCad ? 1 / usdToCad : (h.convFactor || 1);
        } else if (holdingCurrency === 'CAD' && row.account_currency === 'USD') {
          const usdToCad = fxByDate.get(row.date);
          convFactor = usdToCad || (h.convFactor || 1);
        }
        const newPrice = nativeClose * convFactor;
        h.price = newPrice;
        h.value = newPrice * (h.shares || 0);
        if (convFactor !== 1) h.convFactor = convFactor; else delete h.convFactor;
        changed = true;
        holdingsUpdated++;
      } else {
        if (!hist) skippedSymbols.add(yahooSymbol);
        holdingsSkipped++;
      }
      nonCashTotal += h.value || 0;
    }

    if (changed) {
      rowsTouched++;
      const newTotal = nonCashTotal + cashValue;
      db.run(`UPDATE daily_snapshots SET snapshot = ?, account_total = ? WHERE id = ?`, [
        JSON.stringify(row.snapshot),
        newTotal,
        row.id,
      ]);
      const list = accountTotals.get(row.account_name) || [];
      list.push({ date: row.date, total: newTotal });
      accountTotals.set(row.account_name, list);
    }
  }

  // Recompute daily_change / daily_change_percent from the corrected day-over-day totals.
  for (const [accountName, series] of accountTotals) {
    series.sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < series.length; i++) {
      const prevTotal = i > 0 ? series[i - 1].total : null;
      const change = prevTotal !== null ? series[i].total - prevTotal : 0;
      const changePercent = prevTotal ? (change / prevTotal) * 100 : 0;
      db.run(
        `UPDATE daily_snapshots SET daily_change = ?, daily_change_percent = ? WHERE account_name = ? AND date = ?`,
        [change, changePercent, accountName, series[i].date]
      );
    }
  }

  writeFileSync(DB_PATH, Buffer.from(db.export()));

  console.log('\n--- Backfill complete ---');
  console.log(`Rows updated: ${rowsTouched}/${rows.length}`);
  console.log(`Holdings corrected: ${holdingsUpdated}`);
  console.log(`Holdings left unchanged (no historical data found): ${holdingsSkipped}`);
  if (skippedSymbols.size > 0) {
    console.log(`Symbols Yahoo couldn't resolve: ${Array.from(skippedSymbols).sort().join(', ')}`);
  }
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

main().catch(e => {
  console.error('Backfill failed:', e);
  process.exit(1);
});
