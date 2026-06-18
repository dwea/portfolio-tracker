import { ReportData, AccountData, FormatOptions, HoldingData, AccountRebalance } from './types.js';

const DEFAULT_FORMAT_OPTIONS: FormatOptions = {
  showChangeIcons: true,
  showValue: true,
  showChange: true,
  showWeight: true,
  showPrice: false,
  showAllInCAD: true,
  showWarnings: true,
  showWatching: true,
};

function currencySymbol(currency: 'CAD' | 'USD'): string {
  return currency === 'CAD' ? 'C$' : '$';
}

// Derive a display symbol for the grand total — use C$ if all accounts are CAD, else $
function grandTotalSymbol(accounts: AccountData[]): string {
  return accounts.every(a => a.currency === 'CAD') ? 'C$' : '$';
}

// Returns the display symbol and divisor for a holding.
// When showAllInCAD=false and the holding has a convFactor (i.e. it's a USD stock
// in a CAD account), we show native USD values by dividing back out the conversion.
function holdingDisplay(holding: HoldingData, accountSym: string, showAllInCAD: boolean): { sym: string; div: number } {
  if (!showAllInCAD && holding.convFactor) {
    return { sym: '$', div: holding.convFactor };
  }
  return { sym: accountSym, div: 1 };
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
}

function formatValue(value: number, sym: string): string {
  return `${sym}${formatNumber(value)}`;
}

function formatChange(value: number, percent: number, sym: string = '$'): string {
  const sign = value >= 0 ? '＋' : '－';
  return `${sign}${Math.abs(percent).toFixed(1)}% (${sign}${sym}${formatNumber(Math.abs(value))})`;
}

function formatWeight(weight: number): string {
  return `${weight.toFixed(0)}%`;
}

function applyTickerSuffix(ticker: string, opts: FormatOptions): string {
  if (opts.showTickerSuffix) return ticker;
  return ticker.replace(/\.(TO|NE|V|TSX|US)$/i, '');
}

function getHoldingAlerts(ticker: string, triggers: string[]): string[] {
  const prefix = ticker + ' ';
  return triggers
    .filter(t => t.startsWith(prefix))
    .map(t => t.slice(prefix.length));
}

export function formatShort(data: ReportData, options?: FormatOptions): string {
  const opts = { ...DEFAULT_FORMAT_OPTIONS, ...options };
  let output = `${data.reportName}\n`;
  output += `${data.timestamp}\n\n`;

  // Grand total
  const grandSym = grandTotalSymbol(data.accounts);
  const grandIcon = opts.showChangeIcons ? (data.grandTotalChange >= 0 ? '🟩' : '🟥') : '';
  const grandSign = data.grandTotalChange >= 0 ? '＋' : '－';
  output += `${grandIcon}${grandIcon ? ' ' : ''}Total: ${formatValue(data.grandTotal, grandSym)} `;
  output += `(${grandSign}${Math.abs(data.grandTotalChangePercent).toFixed(1)}% ${grandSign}${formatValue(Math.abs(data.grandTotalChange), grandSym)})\n`;
  output += `--------------------\n\n`;

  const multiAccount = data.accounts.length > 1;

  for (const account of data.accounts) {
    const sym = currencySymbol(account.currency);

    if (multiAccount) {
      const accIcon = opts.showChangeIcons ? (account.totalChange >= 0 ? '🟩' : '🟥') : '';
      const accSign = account.totalChange >= 0 ? '＋' : '－';
      output += `${accIcon}${accIcon ? ' ' : ''}${account.name}: ${formatValue(account.total, sym)} `;
      output += `(${accSign}${Math.abs(account.totalChangePercent).toFixed(1)}% ${accSign}${formatValue(Math.abs(account.totalChange), sym)})\n`;
    }

    if (opts.showWarnings !== false && account.triggers.length > 0) {
      for (const alert of account.triggers) {
        output += `  ⚠️ ${alert}\n`;
      }
    }

    if (opts.showWatching !== false) {
      const watchHoldings = account.holdings.filter(h => h.shares === 0);
      if (watchHoldings.length > 0) {
        const showAllInCAD = opts.showAllInCAD !== false;
        output += `- - - - watching - - - -\n`;
        for (const holding of watchHoldings) {
          const { sym: hSym, div } = holdingDisplay(holding, sym, showAllInCAD);
          let line = '';
          if (opts.showChangeIcons) {
            line += holding.lookupFailed ? '⚠️' : (holding.changePercent >= 0 ? '🟩' : '🟥');
          }
          line += `   ${applyTickerSuffix(holding.displayTicker, opts)}`;
          if (opts.showPrice && holding.price != null) line += ` ${hSym}${(holding.price / div).toFixed(2)}`;
          if (opts.showChange) {
            const sign = holding.changePercent >= 0 ? '＋' : '－';
            line += ` ${sign}${Math.abs(holding.changePercent).toFixed(1)}%`;
          }
          output += line + '\n';
        }
      }
    }
  }

  return output.trim();
}

export function formatDetailed(data: ReportData, options?: FormatOptions): string {
  const opts = { ...DEFAULT_FORMAT_OPTIONS, ...options };
  let output = `${data.reportName}\n`;
  output += `${data.timestamp}\n`;

  // Grand total
  const grandSym = grandTotalSymbol(data.accounts);
  const grandIcon = opts.showChangeIcons ? (data.grandTotalChange >= 0 ? '🟩' : '🟥') : '';
  output += `\n${grandIcon}${grandIcon ? ' ' : ''}Total: ${formatValue(data.grandTotal, grandSym)} `;
  output += formatChange(data.grandTotalChange, data.grandTotalChangePercent, grandSym);
  output += '\n';

  output += `--------------------\n`;

  const multiAccount = data.accounts.length > 1;

  for (const account of data.accounts) {
    const sym = currencySymbol(account.currency);

    if (multiAccount) {
      const accIcon = opts.showChangeIcons ? (account.totalChange >= 0 ? '🟩' : '🟥') : '';
      output += `${accIcon}${accIcon ? ' ' : ''}${account.name}  ${formatValue(account.total, sym)}  `;
      output += formatChange(account.totalChange, account.totalChangePercent, sym);
      output += '\n';
    }

    // Split into owned (shares > 0) and watch (shares = 0)
    const sortBy = opts.sortBy || 'value';
    const ownedSorter = (a: any, b: any) => {
      switch (sortBy) {
        case 'alpha':        return applyTickerSuffix(a.displayTicker, opts).localeCompare(applyTickerSuffix(b.displayTicker, opts));
        case 'changePercent': return b.changePercent - a.changePercent;
        case 'change':       return b.change - a.change;
        case 'weight':       return b.weight - a.weight;
        default:             return b.value - a.value;
      }
    };
    const ownedHoldings = [...account.holdings].filter(h => h.shares > 0).sort(ownedSorter);
    // Watch holdings: use changePercent sort if selected, otherwise alpha
    const watchSorter = sortBy === 'changePercent'
      ? (a: any, b: any) => b.changePercent - a.changePercent
      : (a: any, b: any) => applyTickerSuffix(a.displayTicker, opts).localeCompare(applyTickerSuffix(b.displayTicker, opts));
    const watchHoldings = [...account.holdings].filter(h => h.shares === 0).sort(watchSorter);

    const showAllInCAD = opts.showAllInCAD !== false;
    for (const holding of ownedHoldings) {
      const { sym: hSym, div } = holdingDisplay(holding, sym, showAllInCAD);
      let line = '';
      if (opts.showChangeIcons) {
        line += holding.lookupFailed ? '⚠️' : (holding.changePercent >= 0 ? '🟩' : '🟥');
      }
      line += `   ${applyTickerSuffix(holding.displayTicker, opts)}`;
      if (opts.showPrice && holding.price != null) line += ` ${hSym}${(holding.price / div).toFixed(2)}`;
      if (opts.showValue) line += ` ${formatValue(holding.value / div, hSym)}`;
      if (opts.showChange) line += ` ${formatChange(holding.change / div, holding.changePercent, hSym)}`;
      if (opts.showWeight) line += ` ${formatWeight(holding.weight)}`;
      output += line + '\n';

      if (opts.showWarnings !== false) {
        const alerts = getHoldingAlerts(holding.displayTicker, account.triggers);
        for (const alert of alerts) {
          output += `      ⚠️ ${alert}\n`;
        }
      }
    }

    if (opts.showWatching !== false && watchHoldings.length > 0) {
      output += `- - - - watching - - - -\n`;
      for (const holding of watchHoldings) {
        const { sym: hSym, div } = holdingDisplay(holding, sym, showAllInCAD);
        let line = '';
        if (opts.showChangeIcons) {
          line += holding.lookupFailed ? '⚠️' : (holding.changePercent >= 0 ? '🟩' : '🟥');
        }
        line += `   ${applyTickerSuffix(holding.displayTicker, opts)}`;
        if (opts.showPrice && holding.price != null) line += ` ${hSym}${(holding.price / div).toFixed(2)}`;
        // For watch holdings, only show % change (no $ value since shares = 0)
        if (opts.showChange) {
          const sign = holding.changePercent >= 0 ? '＋' : '－';
          line += ` ${sign}${Math.abs(holding.changePercent).toFixed(1)}%`;
        }
        output += line + '\n';
      }
    }

    if (account.cash > 0) {
      let cashLine = `   CASH ${formatValue(account.cash, sym)}`;
      if (opts.showWeight) cashLine += ` ${formatWeight(account.cashWeight)}`;
      output += cashLine + '\n';
    }

    if (multiAccount) output += '--------------------\n';
  }

  return output;
}

function formatRebalanceAccount(r: AccountRebalance, sym: string, opts: FormatOptions): string {
  if (r.targetSumError) return `   -- Targets exceed 100%, check config --\n`;

  let out = '';
  for (const a of r.actions) {
    const dev = (a.deviationPct >= 0 ? '+' : '') + a.deviationPct.toFixed(1);
    const tk = applyTickerSuffix(a.displayTicker, opts);
    if (a.action === 'hold') {
      const suffix = a.belowThreshold ? ' small' : ` (${dev}%)`;
      out += `   ${tk} ${a.currentWeight.toFixed(0)}%→${a.targetWeight.toFixed(0)}%${suffix}\n`;
    } else {
      const sign = a.action === 'buy' ? '➕' : '➖';
      const shares = String(a.deltaShares);
      let orderSuffix = '';
      if (a.orderType === 'market') orderSuffix = ' market';
      else if (a.orderType === 'limit' && a.limitPrice != null) {
        const lSym = a.convFactor ? '$' : sym;
        const lPrice = a.convFactor ? a.limitPrice / a.convFactor : a.limitPrice;
        orderSuffix = ` limit ${lSym}${lPrice.toFixed(2)}`;
      }
      out += `   ${sign}${tk} ${shares}sh ${sym}${formatNumber(a.deltaCost)} ${a.currentWeight.toFixed(0)}%→${a.targetWeight.toFixed(0)}%${orderSuffix}\n`;
    }
  }

  const cashDev = (r.cashDeviationPct >= 0 ? '+' : '') + r.cashDeviationPct.toFixed(1);
  out += `   CASH ${r.cashCurrentWeight.toFixed(0)}%→${r.cashTargetWeight.toFixed(0)}% (${cashDev}%)\n`;

  if (Math.abs(r.netCashDelta) > 1) {
    const label = r.netCashDelta >= 0 ? 'freed' : 'needed';
    out += `   net: ${sym}${formatNumber(Math.abs(r.netCashDelta))} ${label}\n`;
  }

  return out;
}

export function formatRebalanceReport(data: ReportData, options?: FormatOptions): string {
  const opts = { ...DEFAULT_FORMAT_OPTIONS, ...options };
  let output = `${data.reportName} — Rebalance\n${data.timestamp}\n`;

  let anyTargets = false;
  for (const account of data.accounts) {
    if (!account.rebalance || account.rebalance.actions.length === 0) continue;
    anyTargets = true;

    const sym = currencySymbol(account.currency);
    output += `\n${account.name}  ${formatValue(account.total, sym)}\n`;
    output += formatRebalanceAccount(account.rebalance, sym, opts);
    output += '--------------------\n';
  }

  if (!anyTargets) {
    output += '\n(No rebalance targets set. Use the editor to generate a strategy.)\n';
  }

  return output.trim();
}
