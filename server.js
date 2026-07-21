import dotenv from 'dotenv';
dotenv.config({ override: true });
import Anthropic from '@anthropic-ai/sdk';
import express from 'express';
import { readFile, writeFile, readdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import cron from 'node-cron';
import { getHistory, insertSnapshot, buildSnapshotHoldings } from './src/db.js';

const execAsync = promisify(exec);
const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from .env

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
// Only the real production instance (port 3000, run via PM2) should ever actually fire
// scheduled sends/snapshots. Any other port (e.g. 3001, used for preview/dev testing)
// runs with cron scheduling disabled so it can never send duplicate live notifications
// or race the production instance's writes.
const CRON_ENABLED = String(PORT) === '3000';
if (!CRON_ENABLED) {
  console.log(`[Cron] Disabled — running on port ${PORT}, not the production port (3000).`);
}

// ── Auth ─────────────────────────────────────────────────────────────────────

const UI_PASSWORD = process.env.UI_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET || (() => {
  console.warn('[Auth] SESSION_SECRET not set in .env — sessions will not survive server restarts');
  return crypto.randomBytes(32).toString('hex');
})();
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function parseCookies(header) {
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map(c => {
      const idx = c.indexOf('=');
      return idx < 0 ? [c.trim(), ''] : [c.slice(0, idx).trim(), c.slice(idx + 1).trim()];
    })
  );
}

function hashPassword(pw) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(pw).digest();
}

function createSessionToken() {
  const token = crypto.randomBytes(32).toString('hex');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(token).digest('hex');
  return `${token}.${sig}`;
}

function isValidSession(cookieHeader) {
  if (!UI_PASSWORD) return true;
  const cookies = parseCookies(cookieHeader);
  const val = cookies['pt_session'];
  if (!val) return false;
  const dot = val.lastIndexOf('.');
  if (dot < 0) return false;
  const token = val.slice(0, dot);
  const sig = val.slice(dot + 1);
  if (!token || !sig) return false;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(token).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

function setSessionCookie(res) {
  const expires = new Date(Date.now() + SESSION_DURATION_MS);
  res.setHeader('Set-Cookie',
    `pt_session=${createSessionToken()}; HttpOnly; Path=/; Expires=${expires.toUTCString()}; SameSite=Strict`
  );
}

function requireAuth(req, res, next) {
  if (!UI_PASSWORD) return next();
  const publicPaths = ['/login.html', '/api/auth/login', '/logout'];
  if (publicPaths.includes(req.path)) return next();
  if (req.path.startsWith('/charts/')) return next(); // Charts are publicly accessible for ntfy
  if (req.path.startsWith('/api/history')) return next(); // History API is publicly accessible
  if (isValidSession(req.headers.cookie)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  res.redirect('/login.html');
}

// ─────────────────────────────────────────────────────────────────────────────

// Store active cron jobs
const scheduledJobs = new Map();
const executionLogs = new Map();

// Middleware
app.use(express.json());
app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

// Serve generated data files (sparkline, etc.)
app.use(express.static(path.join(__dirname, 'data')));

// Auth endpoints
app.post('/api/auth/login', (req, res) => {
  if (!UI_PASSWORD) return res.json({ success: true });
  const { password } = req.body;
  if (!password) return res.status(401).json({ error: 'Password required' });
  try {
    if (!crypto.timingSafeEqual(hashPassword(password), hashPassword(UI_PASSWORD))) {
      return res.status(401).json({ error: 'Incorrect password' });
    }
  } catch {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  setSessionCookie(res);
  res.json({ success: true });
});

app.get('/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'pt_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict');
  res.redirect('/login.html');
});

// Legacy schedule presets
const legacyScheduleMap = {
  'weekdays-at-4pm': '0 16 * * 1-5',
  'weekdays-at-9am': '0 9 * * 1-5',
  'weekdays-at-12pm': '0 12 * * 1-5',
  'daily-at-5pm': '0 17 * * *',
  'daily-at-9am': '0 9 * * *',
  'daily-at-4pm': '0 16 * * *',
  'weekends-at-10am': '0 10 * * 0,6',
  'monday-at-9am': '0 9 * * 1',
  'friday-at-5pm': '0 17 * * 5',
};

// Parse human-readable schedule formats to cron syntax
function parseToCron(scheduleWhen) {
  // If it's already in cron format (5 parts separated by spaces), return as-is
  if (/^(\S+\s+){4}\S+$/.test(scheduleWhen)) {
    return scheduleWhen;
  }

  // New format: "weekdays-at-7", "daily-at-14"
  const match = scheduleWhen.match(/^(weekdays|daily)-at-(\d+)$/);
  if (match) {
    const days = match[1] === 'weekdays' ? '1-5' : '*';
    const hour = parseInt(match[2]);
    return `0 ${hour} * * ${days}`;
  }

  // Legacy format
  return legacyScheduleMap[scheduleWhen.toLowerCase()] || null;
}

// Get human-readable description of cron schedule
function cronToHuman(cronExpression) {
  // Try to parse the cron expression dynamically: "0 H * * days"
  const parts = cronExpression.split(/\s+/);
  if (parts.length === 5 && parts[0] === '0') {
    const hour = parseInt(parts[1]);
    const daysPart = parts[4];
    if (!isNaN(hour)) {
      const ampm = hour >= 12 ? 'pm' : 'am';
      const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
      const timeStr = `${displayHour}:00${ampm}`;
      if (daysPart === '1-5') return `Weekdays ${timeStr}`;
      if (daysPart === '*') return `Daily ${timeStr}`;
      if (daysPart === '0,6') return `Weekends ${timeStr}`;
    }
  }
  return cronExpression;
}

// Calculate next run time for a cron expression
function getNextRunTime(cronExpression) {
  try {
    const schedule = cron.schedule(cronExpression, () => {}, { scheduled: false });
    // This is a workaround - node-cron doesn't expose next run time directly
    // We'll return a placeholder for now
    return 'Scheduled';
  } catch (error) {
    return 'Invalid schedule';
  }
}

// Run a report
async function runReport(reportName, format = 'detailed', when = 'manual') {
  const logEntry = {
    timestamp: new Date().toISOString(),
    reportName,
    format,
    status: 'running'
  };

  try {
    console.log(`Running report: ${reportName} (${format})`);

    const { stdout, stderr } = await execAsync(
      `npx tsx src/runner.ts "${reportName}" ${format}`,
      { cwd: __dirname }
    );

    logEntry.status = 'success';
    logEntry.output = stdout;
    if (stderr) logEntry.stderr = stderr;

    console.log(`Report ${reportName} completed successfully`);

  } catch (error) {
    logEntry.status = 'error';
    logEntry.error = error.message;
    console.error(`Report ${reportName} failed:`, error.message);
  }

  // Store execution log keyed by reportName:when so each schedule slot is tracked independently
  const logKey = `${reportName}:${when}`;
  if (!executionLogs.has(logKey)) {
    executionLogs.set(logKey, []);
  }
  executionLogs.get(logKey).unshift(logEntry);

  // Keep only last 10 executions
  if (executionLogs.get(logKey).length > 10) {
    executionLogs.get(logKey).pop();
  }

  return logEntry;
}

// Schedule a report based on its definition
function scheduleReport(reportDef) {
  const reportName = reportDef.reportName;

  // Skip teardown/recreate if the schedule slots haven't actually changed.
  // This prevents editor saves (display options, etc.) from resetting cron jobs mid-day.
  const existingJobs = scheduledJobs.get(reportName) || [];
  if (existingJobs.length > 0) {
    const existingSig = existingJobs.map(j => `${j.when}:${j.format}`).sort().join('|');
    const newSig = (reportDef.schedules || []).map(s => `${s.when}:${s.format || 'detailed'}`).sort().join('|');
    if (existingSig === newSig) {
      console.log(`Schedules unchanged for ${reportName}, skipping reschedule`);
      return;
    }
  }

  // Clear existing jobs for this report
  if (scheduledJobs.has(reportName)) {
    scheduledJobs.get(reportName).forEach(job => job.job.stop());
    scheduledJobs.delete(reportName);
  }

  if (!reportDef.schedules || !Array.isArray(reportDef.schedules)) {
    console.log(`No schedules defined for ${reportName}`);
    return;
  }

  const jobs = [];

  for (const schedule of reportDef.schedules) {
    const cronExpression = parseToCron(schedule.when);

    if (!cronExpression) {
      console.error(`Invalid schedule format: ${schedule.when}`);
      continue;
    }

    if (!cron.validate(cronExpression)) {
      console.error(`Invalid cron expression: ${cronExpression}`);
      continue;
    }

    const format = schedule.format || 'detailed';

    console.log(`Scheduling ${reportName} (${format}): ${cronExpression} - ${cronToHuman(cronExpression)}${CRON_ENABLED ? '' : ' [disabled, non-production port]'}`);

    // Stub job when cron is disabled — never actually fires, but still supports
    // .stop() so the rest of the reschedule/bookkeeping logic works unchanged.
    const job = CRON_ENABLED
      ? cron.schedule(cronExpression, () => {
          runReport(reportName, format, schedule.when);
        })
      : { stop: () => {} };

    jobs.push({
      job,
      cronExpression,
      format,
      when: schedule.when
    });
  }

  if (jobs.length > 0) {
    scheduledJobs.set(reportName, jobs);
  }
}

// Load all reports and schedule them
async function loadAndScheduleReports() {
  const reportsDir = path.join(__dirname, 'reports');

  try {
    const files = await readdir(reportsDir);
    const jsonFiles = files.filter(f => f.endsWith('.json') && !f.startsWith('.'));

    console.log(`Loading ${jsonFiles.length} report(s)...`);

    for (const file of jsonFiles) {
      const filePath = path.join(reportsDir, file);
      const content = await readFile(filePath, 'utf-8');
      const reportDef = JSON.parse(content);

      if (reportDef.enabled !== false) { // Schedule if not explicitly disabled
        scheduleReport(reportDef);
      }
    }

    console.log(`Scheduling complete. ${scheduledJobs.size} report(s) scheduled.`);

  } catch (error) {
    console.error('Error loading reports:', error);
  }
}

// API Endpoints

// List all reports
app.get('/api/reports', async (req, res) => {
  try {
    const reportsDir = path.join(__dirname, 'reports');
    const files = await readdir(reportsDir);
    const jsonFiles = files.filter(f => f.endsWith('.json') && !f.startsWith('.'));

    const reports = [];
    for (const file of jsonFiles) {
      const filePath = path.join(reportsDir, file);
      const content = await readFile(filePath, 'utf-8');
      const reportDef = JSON.parse(content);

      reports.push({
        filename: file,
        reportName: reportDef.reportName,
        enabled: reportDef.enabled !== false,
        scheduleCount: reportDef.schedules?.length || 0
      });
    }

    res.json(reports);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get specific report
app.get('/api/reports/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'reports', filename);

    if (!existsSync(filePath)) {
      return res.status(404).json({ error: 'Report not found' });
    }

    const content = await readFile(filePath, 'utf-8');
    const reportDef = JSON.parse(content);

    res.json(reportDef);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save report
app.post('/api/reports/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'reports', filename);
    const reportDef = req.body;

    // Handle rename: oldFilename query param means the report was renamed.
    // Stop the old report's jobs and delete the old file.
    const oldFilename = req.query.oldFilename;
    if (oldFilename && oldFilename !== filename) {
      const oldFilePath = path.join(__dirname, 'reports', oldFilename);
      if (existsSync(oldFilePath)) {
        try {
          const oldContent = await readFile(oldFilePath, 'utf-8');
          const oldDef = JSON.parse(oldContent);
          if (scheduledJobs.has(oldDef.reportName)) {
            scheduledJobs.get(oldDef.reportName).forEach(job => job.job.stop());
            scheduledJobs.delete(oldDef.reportName);
            console.log(`Stopped jobs for renamed report: ${oldDef.reportName}`);
          }
        } catch (e) { /* ignore parse errors */ }
        await unlink(oldFilePath);
        console.log(`Deleted old file after rename: ${oldFilename} → ${filename}`);
      }
    }

    // If the target file already exists with a different reportName (e.g. someone manually
    // edited the file), stop the old jobs before overwriting.
    if (existsSync(filePath)) {
      try {
        const oldContent = await readFile(filePath, 'utf-8');
        const oldDef = JSON.parse(oldContent);
        if (oldDef.reportName !== reportDef.reportName && scheduledJobs.has(oldDef.reportName)) {
          scheduledJobs.get(oldDef.reportName).forEach(job => job.job.stop());
          scheduledJobs.delete(oldDef.reportName);
          console.log(`Stopped orphaned jobs: ${oldDef.reportName} → ${reportDef.reportName}`);
        }
      } catch (e) { /* ignore */ }
    }

    // Save to file
    await writeFile(filePath, JSON.stringify(reportDef, null, 2), 'utf-8');

    // Reschedule this report
    scheduleReport(reportDef);

    res.json({ success: true, message: 'Report saved and rescheduled' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a report
app.delete('/api/reports/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'reports', filename);

    if (!existsSync(filePath)) {
      return res.status(404).json({ error: 'Report not found' });
    }

    // Read report to get reportName for cleanup
    const content = await readFile(filePath, 'utf-8');
    const reportDef = JSON.parse(content);
    const reportName = reportDef.reportName;

    // Stop scheduled jobs
    if (scheduledJobs.has(reportName)) {
      scheduledJobs.get(reportName).forEach(job => job.job.stop());
      scheduledJobs.delete(reportName);
    }

    // Clear execution logs
    executionLogs.delete(reportName);

    // Delete file
    await unlink(filePath);

    res.json({ success: true, message: 'Report deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Preview a report (returns formatted text without sending)
app.post('/api/reports/:filename/preview', async (req, res) => {
  try {
    const filename = req.params.filename;
    const format = req.body.format || 'detailed';

    let filePath;
    if (req.body.config) {
      // Config passed directly — write to a temp file so preview.ts can read it
      // without touching (or rescheduling) the real report file.
      filePath = path.join(__dirname, 'reports', '.preview-temp.json');
      await writeFile(filePath, JSON.stringify(req.body.config, null, 2), 'utf-8');
    } else {
      filePath = path.join(__dirname, 'reports', filename);
      if (!existsSync(filePath)) {
        return res.status(404).json({ error: 'Report not found' });
      }
    }

    const { stdout } = await execAsync(
      `npx tsx src/preview.ts "${filePath}" ${format}`,
      { cwd: __dirname, timeout: 30000, env: { ...process.env, DOTENV_CONFIG_QUIET: 'true' } }
    );

    // For charts format, parse and return the JSON directly
    if (format === 'charts') {
      try {
        const chartsData = JSON.parse(stdout.trim());
        return res.json({ success: true, ...chartsData });
      } catch (e) {
        return res.json({ success: true, message: stdout.trim() });
      }
    }

    res.json({ success: true, message: stdout.trim() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Return structured holdings data (with live prices) for the given config
app.post('/api/reports/:filename/holdings', async (req, res) => {
  try {
    const filename = req.params.filename;

    let filePath;
    if (req.body.config) {
      filePath = path.join(__dirname, 'reports', '.preview-temp.json');
      await writeFile(filePath, JSON.stringify(req.body.config, null, 2), 'utf-8');
    } else {
      filePath = path.join(__dirname, 'reports', filename);
      if (!existsSync(filePath)) return res.status(404).json({ error: 'Report not found' });
    }

    const { stdout } = await execAsync(
      `npx tsx src/preview.ts "${filePath}" json`,
      { cwd: __dirname, timeout: 30000, env: { ...process.env, DOTENV_CONFIG_QUIET: 'true' } }
    );

    res.json(JSON.parse(stdout.trim()));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// AI rebalancing strategy — analyze all accounts and suggest target weights
app.post('/api/rebalance-strategy', async (req, res) => {
  try {
    const { config, instructions } = req.body;

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in .env' });
    }

    // 1. Fetch live holdings for ALL accounts via existing preview.ts mechanism
    const filePath = path.join(__dirname, 'reports', '.preview-temp.json');
    await writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');

    const { stdout } = await execAsync(
      `npx tsx src/preview.ts "${filePath}" json`,
      { cwd: __dirname, timeout: 30000, env: { ...process.env, DOTENV_CONFIG_QUIET: 'true' } }
    );

    const reportData = JSON.parse(stdout.trim());

    // 2. Format ALL accounts for Claude — include current weights AND existing targets
    let portfolioText = '';
    for (let i = 0; i < reportData.accounts.length; i++) {
      const account = reportData.accounts[i];
      const cfgAccount = config.accounts[i];
      const sym = cfgAccount.currency === 'CAD' ? 'C$' : '$';
      portfolioText += `\nAccount: ${account.name} (${cfgAccount.currency}, total: ${sym}${Math.round(account.total).toLocaleString()})\n`;
      for (const h of account.holdings) {
        if (h.shares === 0) continue; // skip watch-only holdings
        // Show price in the stock's native currency so Claude sets priceTriggers in native currency
        const nativeSym = h.convFactor ? '$' : sym; // USD for converted stocks, account currency otherwise
        const nativePrice = h.price != null ? (h.convFactor ? h.price / h.convFactor : h.price) : null;
        const priceStr = nativePrice != null ? `@ ${nativeSym}${nativePrice.toFixed(2)}` : '(price unavailable)';
        // Look up existing target weight from config
        const cfgStock = cfgAccount.stocks.find(s => s.ticker === h.ticker);
        const targetStr = cfgStock?.targetWeight != null ? `, target ${cfgStock.targetWeight}%` : ', no target';
        portfolioText += `- ${h.ticker}: ${h.shares} shares ${priceStr} = ${sym}${Math.round(h.value).toLocaleString()} (current ${h.weight.toFixed(1)}%${targetStr})\n`;
      }
      if (account.cash > 0) {
        const cashTarget = cfgAccount.cashTargetWeight != null ? `, target ${cfgAccount.cashTargetWeight}%` : '';
        portfolioText += `- CASH: ${sym}${Math.round(account.cash).toLocaleString()} (current ${account.cashWeight.toFixed(1)}%${cashTarget})\n`;
      }
    }

    // 3. Call Claude API — analyze all accounts in one call
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: `You are a professional portfolio advisor. Analyze ALL provided investment accounts and suggest INCREMENTAL adjustments to the existing target weights — not a full redesign from scratch.

Each holding shows its current market weight and its existing target weight. Your job is to tweak those targets in response to the investor's stated goals, market conditions, or portfolio drift. Preserve targets that are working well. Only suggest meaningful changes (avoid moves < 2% since each trade costs ~$7 commission). If a holding has no existing target, you may assign one if appropriate, or leave it at 0.

Note: stocks cannot be transferred between accounts. Each account must be rebalanced independently.

Return ONLY valid JSON in exactly this format, with no markdown or explanation outside the JSON:
{
  "strategy": "Overall strategy description (2-3 sentences)",
  "accounts": [
    {
      "accountName": "TFSA",
      "targets": [
        {
          "ticker": "XDIV.TO",
          "targetWeight": 25,
          "rationale": "One sentence rationale",
          "weightTriggerAbove": 31,
          "weightTriggerBelow": 19,
          "priceTriggerAbove": 45.00,
          "priceTriggerBelow": 33.00
        },
        {
          "ticker": "QQQ",
          "targetWeight": 15,
          "rationale": "New ETF to consolidate tech exposure",
          "weightTriggerAbove": 22,
          "weightTriggerBelow": 8,
          "priceTriggerAbove": 500.00,
          "priceTriggerBelow": 420.00,
          "new": true
        }
      ],
      "cashTargetWeight": 15,
      "notes": "Account-specific notes (optional, empty string if none)"
    }
  ],
  "notes": "Overall portfolio notes (optional, empty string if none)"
}

Rules:
- For each account: all targetWeight values (existing + new) + cashTargetWeight must sum to exactly 100
- For existing holdings, use their exact ticker strings from the input
- You may suggest new tickers not currently in the account — mark these with "new": true; these represent positions the investor should consider opening; only suggest them when it would meaningfully improve the portfolio given the stated goals
- Stocks cannot be transferred between accounts — each account is rebalanced independently
- targetWeight must be a whole number between 0 and 100
- Avoid very small target changes (< 2%) since each trade costs approximately $7 in commission
- Include all accounts from the input, in the same order
- Rationale must be one sentence maximum
- weightTriggerAbove: alert threshold above targetWeight (e.g. targetWeight + 5 to 8); whole number
- weightTriggerBelow: alert threshold below targetWeight (e.g. targetWeight - 5 to 8); whole number; omit if targetWeight is very low (< 5)
- priceTriggerAbove: price to alert on upside breakout; round to nearest $0.50; MUST be in the same currency as the price shown for that holding (e.g. $ USD for US-listed stocks shown with $, C$ for .TO stocks shown with C$)
- priceTriggerBelow: price to alert on downside break; same currency rule as priceTriggerAbove`,
      messages: [{
        role: 'user',
        content: `${portfolioText}\nInvestment goals and constraints:\n${instructions || 'Optimize for a balanced, diversified portfolio.'}`
      }]
    });

    const rawText = message.content[0].type === 'text' ? message.content[0].text : '';
    // Strip markdown code fences if Claude wrapped the JSON (e.g. ```json ... ```)
    const responseText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    if (!responseText) throw new Error('Empty response from Claude API');
    let suggestions;
    try {
      suggestions = JSON.parse(responseText);
    } catch (parseErr) {
      console.error('Strategy JSON parse failed. stop_reason:', message.stop_reason, 'raw length:', rawText.length);
      throw new Error(`Claude response parse failed (stop_reason: ${message.stop_reason}): ${parseErr.message}`);
    }
    // Normalise each account so weights sum to exactly 100
    for (const acct of (suggestions.accounts || [])) {
      const targets = acct.targets || [];
      const holdingSum = targets.reduce((s, t) => s + (t.targetWeight || 0), 0);
      const cashWeight = acct.cashTargetWeight ?? 0;
      const total = holdingSum + cashWeight;
      if (Math.round(total * 10) === 1000) continue; // already exact

      if (holdingSum <= 100) {
        // Holdings fit within 100 — absorb remainder into cash
        acct.cashTargetWeight = Math.round((100 - holdingSum) * 10) / 10;
      } else {
        // Holdings alone exceed 100 — scale them proportionally to sum to 100, zero cash
        acct.cashTargetWeight = 0;
        let distributed = 0;
        targets.forEach((t, i) => {
          if (i < targets.length - 1) {
            t.targetWeight = Math.round((t.targetWeight / holdingSum) * 100);
            distributed += t.targetWeight;
          } else {
            t.targetWeight = 100 - distributed; // last item absorbs rounding residual
          }
        });
      }
    }

    res.json({ success: true, suggestions });
  } catch (error) {
    console.error('Rebalance strategy error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Manually run a report
app.post('/api/reports/:filename/run', async (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'reports', filename);

    if (!existsSync(filePath)) {
      return res.status(404).json({ error: 'Report not found' });
    }

    const content = await readFile(filePath, 'utf-8');
    const reportDef = JSON.parse(content);
    const format = req.body.format || 'detailed';

    // Run asynchronously
    runReport(reportDef.reportName, format, 'manual');

    res.json({ success: true, message: 'Report execution started' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all schedules
app.get('/api/schedules', async (req, res) => {
  try {
    const schedules = [];

    for (const [reportName, jobs] of scheduledJobs.entries()) {
      for (const jobInfo of jobs) {
        const logs = executionLogs.get(`${reportName}:${jobInfo.when}`) || [];
        const lastRun = logs.find(log => log.status !== 'running');

        schedules.push({
          reportName,
          schedule: cronToHuman(jobInfo.cronExpression),
          cronExpression: jobInfo.cronExpression,
          format: jobInfo.format,
          when: jobInfo.when,
          nextRun: getNextRunTime(jobInfo.cronExpression),
          lastRun: lastRun ? lastRun.timestamp : null,
          lastStatus: lastRun ? lastRun.status : null,
          enabled: true
        });
      }
    }

    res.json(schedules);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get execution logs for a report
app.get('/api/reports/:filename/logs', async (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'reports', filename);

    if (!existsSync(filePath)) {
      return res.status(404).json({ error: 'Report not found' });
    }

    const content = await readFile(filePath, 'utf-8');
    const reportDef = JSON.parse(content);
    const reportName = reportDef.reportName;

    const logs = executionLogs.get(reportName) || [];
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 'all' isn't a real day count — treat it as "way more days than any account could have"
function parseDaysParam(raw) {
  if (raw === 'all') return 36500;
  const parsed = parseInt(String(raw));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

// Get historical data for an account (for charting)
app.get('/api/history', async (req, res) => {
  try {
    const { account, days = '30' } = req.query;
    if (!account) {
      return res.status(400).json({ error: 'account query parameter required' });
    }

    const history = await getHistory(String(account), parseDaysParam(days));
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get raw historical data (account total + per-holding values) for every account in a
// report, for rendering interactive charts client-side instead of static PNGs.
app.get('/api/chart-data/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'reports', filename);

    if (!existsSync(filePath)) {
      return res.status(404).json({ error: 'Report not found' });
    }

    const content = await readFile(filePath, 'utf-8');
    const reportDef = JSON.parse(content);
    const days = parseDaysParam(req.query.days);

    // Refresh today's snapshot with live quotes so intra-day chart views are accurate —
    // this overwrites whatever was saved the last time any report/chart ran today.
    try {
      const { calculateAccount } = await import('./src/calculator.js');
      const liveAccounts = [];
      for (const account of reportDef.accounts) {
        liveAccounts.push(await calculateAccount(account));
      }
      const grandTotal = liveAccounts.reduce((sum, acc) => sum + acc.total, 0);
      const grandTotalChange = liveAccounts.reduce((sum, acc) => sum + acc.totalChange, 0);
      const previousGrandTotal = grandTotal - grandTotalChange;
      const grandTotalChangePercent = previousGrandTotal > 0 ? (grandTotalChange / previousGrandTotal) * 100 : 0;

      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];
      const timestamp = now.toISOString();

      for (const account of liveAccounts) {
        await insertSnapshot(
          dateStr, timestamp, account.name, account.currency, account.total,
          grandTotal, grandTotalChange, grandTotalChangePercent,
          JSON.stringify(buildSnapshotHoldings(account))
        );
      }
    } catch (liveErr) {
      console.error('Chart live-refresh failed, falling back to last saved history:', liveErr.message);
    }

    const charts = [];
    for (const account of reportDef.accounts) {
      const history = await getHistory(account.name, days);
      charts.push({ name: account.name, currency: account.currency || 'CAD', history });
    }

    res.json({ success: true, charts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Portfolio Tracker Web Server`);
  console.log(`===============================`);
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Also available at http://192.168.1.93:${PORT}`);
  console.log(`\nPages:`);
  console.log(`  Editor:    http://192.168.1.93:${PORT}/`);
  console.log(`  Schedules: http://192.168.1.93:${PORT}/schedules.html`);
  console.log(`\nLoading and scheduling reports...`);

  // Load and schedule all reports
  loadAndScheduleReports();
});
