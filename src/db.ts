import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { mkdir } from 'fs/promises';

let db: SqlJsDatabase | null = null;
let SQL: any = null;
const DB_PATH = join(process.cwd(), 'data', 'portfolio.db');

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
  if (!db) {
    await initializeDatabase();
  }

  if (!db) throw new Error('Failed to initialize database');

  try {
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
    const results = db.exec(
      `SELECT date, account_total, snapshot FROM daily_snapshots
       WHERE account_name = '${accountName.replace(/'/g, "''")}'
       AND date >= date('now', '-${days} days')
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
