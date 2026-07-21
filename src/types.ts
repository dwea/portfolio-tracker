export interface Holding {
  ticker: string;
  name?: string;
  shares: number;
  weightTriggerAbove?: number;
  weightTriggerBelow?: number;
  priceTriggerAbove?: number;
  priceTriggerBelow?: number;
  excludeFromAlerts?: boolean;
  targetWeight?: number;  // % of account total; set by AI strategy
  manualPrice?: number;   // fallback price (in account currency) for tickers Yahoo can't resolve, e.g. proprietary fund codes
}

export interface Account {
  name: string;
  stocks: Holding[];
  cash: number;
  currency: 'CAD' | 'USD';
  startingValue?: number;
  targetValue?: number;
}

export interface Schedule {
  when: string;
  format: 'short' | 'detailed' | 'rebalance';
  chart?: 'none' | 'image' | 'image-only';
}

export interface FormatOptions {
  showChangeIcons: boolean;
  showValue: boolean;
  showChange: boolean;
  showWeight: boolean;
  showPrice?: boolean;
  showAllInCAD?: boolean;   // default true; when false, USD holdings display in USD
  showWarnings?: boolean;   // default true; when false, ⚠️ alerts are suppressed
  showWatching?: boolean;   // default true; when false, 0-share watch holdings are hidden
  showTickerSuffix?: boolean; // default false; when true, .TO/.V etc. suffixes shown in reports
  sortBy?: 'value' | 'alpha' | 'changePercent' | 'change' | 'weight';
}

export interface Report {
  reportName: string;
  schedules: Schedule[];
  alertRecipients: string[];
  accounts: Account[];
  formatOptions?: FormatOptions;
  strategyGoals?: string;  // user's investment goals, sent to Claude for rebalancing strategy
  strategyResult?: object; // last AI suggestions response — persisted so results survive page reload
  lockedPlans?: Record<number, { targetShares: Record<string, number>; timestamp: number } | null>; // partial-fill tracker per account
}

export interface HoldingData {
  ticker: string;
  displayTicker: string;
  price?: number;
  convFactor?: number;   // USD→CAD rate used; set only for USD holdings in a CAD account
  value: number;
  change: number;
  changePercent: number;
  weight: number;
  shares: number;
  triggered: boolean;
  lookupFailed?: boolean;
  manualPriceUsed?: boolean; // true if a manually-entered price was used because Yahoo couldn't resolve this ticker
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  fiftyDayAverage?: number;
  twoHundredDayAverage?: number;
}

export interface AccountData {
  name: string;
  currency: 'CAD' | 'USD';
  total: number;
  totalChange: number;
  totalChangePercent: number;
  holdings: HoldingData[];
  cash: number;
  cashWeight: number;
  triggers: string[];
  rebalance?: AccountRebalance;
}

export interface RebalanceAction {
  ticker: string;
  displayTicker: string;
  currentWeight: number;
  targetWeight: number;
  deviationPct: number;       // currentWeight - targetWeight (signed)
  action: 'buy' | 'sell' | 'hold';
  deltaShares: number;        // absolute value; direction from action field
  deltaCost: number;          // absolute value in account currency
  belowThreshold: boolean;    // true if deltaCost < MIN_TRADE_COST
  orderType: 'market' | 'limit' | 'none';
  limitPrice?: number;        // suggested limit price in account currency (limit orders only)
  urgency: 'urgent' | 'opportunistic' | 'none';
  convFactor?: number;        // USD→CAD factor; if set, divide limitPrice by this to get native USD price
}

export interface AccountRebalance {
  actions: RebalanceAction[];
  cashCurrentWeight: number;
  cashTargetWeight: number;   // 100 - sum(holding targetWeights)
  cashDeviationPct: number;
  netCashDelta: number;       // positive = cash freed, negative = cash needed
  targetSumError: boolean;    // true if holding targets sum > 100
}

export interface ReportData {
  reportName: string;
  timestamp: string;
  accounts: AccountData[];
  grandTotal: number;
  grandTotalChange: number;
  grandTotalChangePercent: number;
}

export interface QuoteData {
  price: number;
  previousClose: number;
  currency: string;
  lookupFailed?: boolean;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  fiftyDayAverage?: number;
  twoHundredDayAverage?: number;
}
