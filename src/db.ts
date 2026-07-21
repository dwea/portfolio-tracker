import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { readFileSync, writeFileSync, existsSync, openSync, closeSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import type { AccountData, HoldingData } from './types.js';

// Cash isn't part of account.holdings, so it wouldn't otherwise be recorded in a
// snapshot at all — add it as a synthetic holding purely for history/charting.
export function buildSnapshotHoldings(account: AccountData): HoldingData[] {
  const cashHolding: HoldingData = {
    ticker: 'CASH',
    displayTicker: 'Cash',
    value: account.cash,
    change: 0,
    changePercent: 0,
    weight: account.cashWeight,
    shares: 0,
    triggered: false,
  };
  return [...account.holdings, cashHolding];
}

let db: SqlJsDatabase | null = null;
let SQL: any = null;
const DB_PATH = join(process.cwd(), 'data', 'portfolio.db');
const LOCK_PATH = `${DB_PATH}.lock`;
const LOCK_STALE_MS = 30000; // a lock older than this is assumed abandoned by a crashed process
const LOCK_RETRY_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Each report run is a separate process, and sql.js keeps the whole database in memory,
// dumping the entire file back to disk on every write. Without a lock, two processes
// writing around the same time can race: whichever finishes last overwrites the file with
// a copy it loaded *before* the other's insert, silently erasing that row.
async function acquireLock(): Promise<void> {
  while (true) {
    try {
      closeSync(openSync(LOCK_PATH, 'wx')); // atomic create — fails if the lock already exists
      return;
    } catch (err: any) {
      if (err.code !== 'EEXIST') throw err;
      try {
        if (Date.now() - statSync(LOCK_PATH).mtimeMs > LOCK_STALE_MS) {
          unlinkSync(LOCK_PATH); // previous holder crashed without releasing it — clear and retry
          continue;
        }
      } catch {
        // Lock disappeared between our EEXIST and this stat — just retry.
      }
      await sleep(LOCK_RETRY_MS);
    }
  }
}

function releaseLock(): void {
  try {
    unlinkSync(LOCK_PATH);
  } catch {
    // Already gone — nothing to do.
  }
}

async function initializeDatabase(): Promise<void> {
  if (!SQL) {
    SQL = await initSqlJs();
  }

  const dataDir = join(process.cwd(), 'data');
  if (!existsSync(dataDir)) {
    await mkdir(dataDir, { recursive: true });
  }

  // Load existing database or create new one
  if (existsSync(DB_PATH)) {
    const fileBuffer = readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
    createSchema();
  }
}

function createSchema(): void {
  if (!db) throw new Error('Database not initialized');

  db.run(`
    CREATE TABLE IF NOT EXISTS daily_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      account_name TEXT NOT NULL,
      account_currency TEXT,
      account_total REAL,
      portfolio_total_cad REAL,
      daily_change REAL,
      daily_change_percent REAL,
      snapshot TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  saveDatabase();
}

function saveDatabase(): void {
  if (!db) throw new Error('Database not initialized');

  const dataDir = join(process.cwd(), 'data');
  if (!existsSync(dataDir)) {
    // This shouldn't happen if initializeDatabase was called, but just in case
    return;
  }

  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(DB_PATH, buffer);
}

export async function insertSnapshot(
  date: string,
  timestamp: string,
  accountName: string,
  accountCurrency: string,
  accountTotal: number,
  portfolioTotalCad: number,
  dailyChange: number,
  dailyChangePercent: number,
  snapshot: string
): Promise<void> {
  await acquireLock();
  try {
    // Reload fresh from disk under the lock, even if this process already has a database
    // open — another process (or, in the long-running server, an earlier request) may have
    // written since we last loaded, and we must not clobber that with a stale in-memory copy.
    if (!SQL) {
      SQL = await initSqlJs();
    }
    const dataDir = join(process.cwd(), 'data');
    if (!existsSync(dataDir)) {
      await mkdir(dataDir, { recursive: true });
    }
    if (existsSync(DB_PATH)) {
      db = new SQL.Database(readFileSync(DB_PATH));
    } else {
      db = new SQL.Database();
      createSchema();
    }

    // A given (date, account) should have exactly one snapshot — replace any existing
    // row for this day rather than accumulating one per report run, so re-running
    // (e.g. viewing charts intra-day) always reflects the latest values for "today".
    db.run(
      `DELETE FROM daily_snapshots WHERE date = ? AND account_name = ?`,
      [date, accountName]
    );
    db.run(
      `INSERT INTO daily_snapshots
       (date, timestamp, account_name, account_currency, account_total,
        portfolio_total_cad, daily_change, daily_change_percent, snapshot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        date,
        timestamp,
        accountName,
        accountCurrency,
        accountTotal,
        portfolioTotalCad,
        dailyChange,
        dailyChangePercent,
        snapshot,
      ]
    );
    saveDatabase();
  } catch (error) {
    console.error('Error inserting snapshot:', error);
    throw error;
  } finally {
    releaseLock();
  }
}

export async function getHistory(
  accountName: string,
  days: number = 30
): Promise<Array<{ date: string; accountTotal: number; snapshot: any }>> {
  if (!db) {
    await initializeDatabase();
  }

  if (!db) throw new Error('Failed to initialize database');

  try {
    // strftime('%w', date) is 0=Sunday..6=Saturday — drop weekends since markets
    // are closed and those points would just flatline the chart.
    const results = db.exec(
      `SELECT date, account_total, snapshot FROM daily_snapshots
       WHERE account_name = '${accountName.replace(/'/g, "''")}'
       AND date >= date('now', '-${days} days')
       AND strftime('%w', date) NOT IN ('0', '6')
       ORDER BY date ASC`
    );

    if (results.length === 0) {
      return [];
    }

    const columns = results[0].columns;
    const rows = results[0].values;

    return rows.map((row: any[]) => ({
      date: row[columns.indexOf('date')],
      accountTotal: row[columns.indexOf('account_total')],
      snapshot: JSON.parse(row[columns.indexOf('snapshot')] || '[]'),
    }));
  } catch (error) {
    console.error('Error retrieving history:', error);
    throw error;
  }
}

export async function getDatabase(): Promise<SqlJsDatabase> {
  if (!db) {
    await initializeDatabase();
  }
  if (!db) throw new Error('Failed to initialize database');
  return db;
}

export async function closeDatabase(): Promise<void> {
  if (db) {
    saveDatabase();
    db.close();
    db = null;
  }
}
