import { Account, AccountData, RebalanceAction, AccountRebalance } from './types.js';

// Minimum trade cost in account currency — trades below this are not worth the ~$7 commission + setup time
const MIN_TRADE_COST = 500;

// Deviation threshold for urgent (market order) vs opportunistic (limit order)
const URGENT_DEVIATION_PCT = 5;

// Limit orders placed ±0.5% from current price
const LIMIT_OFFSET = 0.005;

export function calculateRebalance(
  accountData: AccountData,
  account: Account
): AccountRebalance | undefined {
  if (!account.stocks.some(s => s.targetWeight != null)) return undefined;
  if (accountData.total <= 0) return undefined;

  const holdingTargetSum = account.stocks.reduce((s, h) => s + (h.targetWeight ?? 0), 0);
  const cashTargetWeight = 100 - holdingTargetSum;
  const targetSumError = holdingTargetSum > 100;

  const actions: RebalanceAction[] = [];

  // accounts.stocks and accountData.holdings are always parallel arrays
  for (let i = 0; i < account.stocks.length; i++) {
    const cfg = account.stocks[i];
    if (cfg.targetWeight == null) continue;

    const hd = accountData.holdings[i];
    const targetValue = (cfg.targetWeight / 100) * accountData.total;
    const deltaValue = targetValue - hd.value;
    const deviationPct = hd.weight - cfg.targetWeight;

    let deltaShares = 0;
    let deltaCost = 0;
    // hd.price is already in account currency (convFactor applied in calculator)
    if (hd.price != null && hd.price > 0) {
      deltaShares = Math.round(deltaValue / hd.price);   // whole shares only — no fractional trading
      deltaCost = Math.abs(deltaShares) * hd.price;      // actual cost of those integer shares
    }

    const belowThreshold = deltaCost > 0 && deltaCost < MIN_TRADE_COST;
    const rawAction: 'buy' | 'sell' | 'hold' =
      deltaShares === 0 ? 'hold' : deltaShares > 0 ? 'buy' : 'sell';
    // Trades below the minimum cost threshold aren't worth the commission
    const action: 'buy' | 'sell' | 'hold' = belowThreshold ? 'hold' : rawAction;

    let orderType: 'market' | 'limit' | 'none' = 'none';
    let urgency: 'urgent' | 'opportunistic' | 'none' = 'none';
    let limitPrice: number | undefined;

    if (action !== 'hold' && hd.price != null && hd.price > 0) {
      const isUrgent = Math.abs(deviationPct) >= URGENT_DEVIATION_PCT;
      urgency = isUrgent ? 'urgent' : 'opportunistic';
      orderType = isUrgent ? 'market' : 'limit';
      if (orderType === 'limit') {
        const offset = hd.price * LIMIT_OFFSET;
        limitPrice = action === 'buy'
          ? Math.round((hd.price - offset) * 100) / 100
          : Math.round((hd.price + offset) * 100) / 100;
      }
    }

    actions.push({
      ticker: hd.ticker,
      displayTicker: hd.displayTicker,
      currentWeight: hd.weight,
      targetWeight: cfg.targetWeight,
      deviationPct,
      action,
      deltaShares: Math.abs(deltaShares),
      deltaCost,
      belowThreshold,
      orderType,
      limitPrice,
      urgency,
      convFactor: hd.convFactor,
    });
  }

  // Net cash delta excludes below-threshold trades (they won't actually be executed)
  const netCashDelta = actions.reduce((sum, a) => {
    if (a.action === 'sell') return sum + a.deltaCost;
    if (a.action === 'buy') return sum - a.deltaCost;
    return sum;
  }, 0);

  return {
    actions,
    cashCurrentWeight: accountData.cashWeight,
    cashTargetWeight,
    cashDeviationPct: accountData.cashWeight - cashTargetWeight,
    netCashDelta,
    targetSumError,
  };
}
