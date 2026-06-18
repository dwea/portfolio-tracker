import YahooFinance from 'yahoo-finance2';
import { Account, Holding, AccountData, HoldingData, QuoteData } from './types.js';
import { calculateRebalance } from './rebalancer.js';

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const QUOTE_CACHE = new Map<string, QuoteData>();
let USD_TO_CAD = 1.4;

// Add delay helper
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getExchangeRate(): Promise<number> {
  try {
    const result = await yf.quote('CADUSD=X');
    if (result?.regularMarketPrice) {
      USD_TO_CAD = 1 / result.regularMarketPrice;
    }
  } catch (e) {
    console.log('Failed to fetch exchange rate, using cached:', USD_TO_CAD);
  }
  return USD_TO_CAD;
}

// Convert ticker format: TSE:XDIV -> XDIV.TO
function convertToYahooTicker(ticker: string): string {
  if (ticker.startsWith('TSE:')) {
    return ticker.replace('TSE:', '') + '.TO';
  } else if (ticker.startsWith('NASDAQ:') || ticker.startsWith('NYSE:')) {
    return ticker.split(':')[1].toUpperCase();
  }
  return ticker.toUpperCase();
}

// Ping Yahoo Finance to test connectivity and rate limit status
export async function pingYahoo(ticker: string = 'AAPL'): Promise<void> {
  const yahooTicker = convertToYahooTicker(ticker);
  console.log(`Pinging Yahoo Finance with ticker: ${yahooTicker}...`);

  try {
    const result = await yf.quote(yahooTicker);

    if (!result?.regularMarketPrice) {
      console.error(`❌ Received response but no valid data for ${yahooTicker}`);
      process.exit(1);
    }

    console.log(`✅ SUCCESS! Yahoo Finance is responding.`);
    console.log(`   Ticker: ${yahooTicker}`);
    console.log(`   Price: $${result.regularMarketPrice} ${result.currency}`);
    console.log(`   Previous Close: $${result.regularMarketPreviousClose}`);
    console.log(`\n✓ You are NOT rate limited - safe to run reports!`);
    process.exit(0);

  } catch (e: any) {
    console.error(`❌ ERROR: ${e.message}`);
    process.exit(1);
  }
}

const BATCH_CHUNK_SIZE = 20;

async function fetchQuoteChunk(uncachedTickers: string[], yahooTickers: string[]): Promise<void> {
  const maxRetries = 3;
  let lastError: any;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const backoffDelay = 2000 * Math.pow(2, attempt - 1); // 2s, 4s, 8s
      console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${backoffDelay}ms...`);
      await delay(backoffDelay);
    }

    try {
      const results = await yf.quote(yahooTickers);
      const resultsArr = Array.isArray(results) ? results : [results];

      if (!resultsArr || resultsArr.length === 0) {
        // No results — likely all tickers in this chunk are unrecognized; warn and skip rather than retry
        console.warn(`⚠ No results for chunk [${yahooTickers.join(', ')}] — tickers may be invalid`);
        return;
      }

      const resultBySymbol = new Map<string, typeof resultsArr[0]>();
      for (const result of resultsArr) {
        if (result?.symbol) resultBySymbol.set(result.symbol.toUpperCase(), result);
      }

      for (let i = 0; i < uncachedTickers.length; i++) {
        const originalTicker = uncachedTickers[i];
        const yahooTicker = yahooTickers[i];
        const result = resultBySymbol.get(yahooTicker.toUpperCase());

        if (!result?.regularMarketPrice) {
          console.warn(`⚠ No valid data for ${originalTicker}, skipping`);
          continue;
        }

        const quote: QuoteData = {
          price: result.regularMarketPrice,
          previousClose: result.regularMarketPreviousClose || result.regularMarketPrice,
          currency: result.currency || 'CAD',
          fiftyTwoWeekHigh: result.fiftyTwoWeekHigh ?? undefined,
          fiftyTwoWeekLow: result.fiftyTwoWeekLow ?? undefined,
          fiftyDayAverage: result.fiftyDayAverage ?? undefined,
          twoHundredDayAverage: result.twoHundredDayAverage ?? undefined,
        };

        console.log(`✓ Quote for ${originalTicker}: $${quote.price} ${quote.currency}`);
        QUOTE_CACHE.set(originalTicker, quote);
      }

      console.log(`✓ Successfully cached ${resultsArr.length} quotes`);
      return;

    } catch (e: any) {
      lastError = e;
      console.error(`Error fetching quotes (attempt ${attempt + 1}/${maxRetries}):`, e.message);
    }
  }

  console.error(`❌ Failed to fetch chunk after ${maxRetries} attempts:`, lastError?.message);
  throw new Error('unable to retrieve quotes, no response from yahoo');
}

async function batchFetchQuotes(tickers: string[]): Promise<void> {
  // Filter out already cached tickers
  const uncachedTickers = tickers.filter(t => !QUOTE_CACHE.has(t));

  if (uncachedTickers.length === 0) {
    console.log('All quotes already cached');
    return;
  }

  // Split into chunks to avoid Yahoo rate limits on large accounts
  const yahooTickers = uncachedTickers.map(convertToYahooTicker);
  console.log(`Fetching ${uncachedTickers.length} quotes in chunks of ${BATCH_CHUNK_SIZE}`);

  for (let i = 0; i < uncachedTickers.length; i += BATCH_CHUNK_SIZE) {
    const chunkOrig = uncachedTickers.slice(i, i + BATCH_CHUNK_SIZE);
    const chunkYahoo = yahooTickers.slice(i, i + BATCH_CHUNK_SIZE);
    if (i > 0) await delay(500); // brief pause between chunks
    await fetchQuoteChunk(chunkOrig, chunkYahoo);
  }
}

async function getQuote(ticker: string): Promise<QuoteData> {
  if (QUOTE_CACHE.has(ticker)) {
    return QUOTE_CACHE.get(ticker)!;
  }

  // If not in cache, caller should have called batchFetchQuotes first
  console.warn(`⚠ Quote for ${ticker} not found in cache, returning zero values`);
  return { price: 0, previousClose: 0, currency: 'CAD', lookupFailed: true };
}

export async function calculateAccount(account: Account): Promise<AccountData> {
  await getExchangeRate();

  // Batch fetch quotes — skip 0-share watchlist items (value is always $0)
  const allTickers = account.stocks.filter(s => s.shares > 0).map(s => s.ticker);
  await batchFetchQuotes(allTickers);

  const holdings: HoldingData[] = [];
  let totalValue = account.cash;

  // Calculate each holding
  for (const holding of account.stocks) {
    const quote = await getQuote(holding.ticker);
    let value = quote.price * holding.shares;
    let previousValue = quote.previousClose * holding.shares;

    // Convert USD to CAD if needed
    const convFactor = (quote.currency === 'USD' && account.currency === 'CAD') ? USD_TO_CAD : 1;
    if (convFactor !== 1) {
      value *= convFactor;
      previousValue *= convFactor;
    }

    const change = value - previousValue;
    // Use raw price ratio so 0-share watch holdings still show actual daily % move
    const changePercent = quote.previousClose > 0
      ? (quote.price - quote.previousClose) / quote.previousClose * 100
      : 0;

    holdings.push({
      ticker: holding.ticker,
      displayTicker: holding.ticker.includes(':')
        ? holding.ticker.split(':')[1]
        : holding.ticker,
      price: quote.lookupFailed ? undefined : quote.price * convFactor,
      convFactor: convFactor !== 1 ? convFactor : undefined,
      value,
      change,
      changePercent,
      weight: 0, // Will calculate after total
      shares: holding.shares,
      triggered: false, // Will set after trigger checks
      lookupFailed: quote.lookupFailed,
      fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh ? quote.fiftyTwoWeekHigh * convFactor : undefined,
      fiftyTwoWeekLow: quote.fiftyTwoWeekLow ? quote.fiftyTwoWeekLow * convFactor : undefined,
      fiftyDayAverage: quote.fiftyDayAverage ? quote.fiftyDayAverage * convFactor : undefined,
      twoHundredDayAverage: quote.twoHundredDayAverage ? quote.twoHundredDayAverage * convFactor : undefined,
    });

    totalValue += value;
  }

  // Calculate weights
  for (const holding of holdings) {
    holding.weight = (holding.value / totalValue) * 100;
  }

  const cashWeight = (account.cash / totalValue) * 100;

  // Calculate total change
  const previousTotal = holdings.reduce((sum, h) =>
    sum + (h.value - h.change), 0) + account.cash;
  const totalChange = totalValue - previousTotal;
  const totalChangePercent = previousTotal > 0
    ? (totalChange / previousTotal) * 100 : 0;

  // Check triggers
  const triggers: string[] = [];
  for (let i = 0; i < account.stocks.length; i++) {
    const holding = account.stocks[i];
    const data = holdings[i];

    let holdingTriggered = false;
    if (holding.weightTriggerAbove && data.weight > holding.weightTriggerAbove) {
      triggers.push(`${data.displayTicker} wt hi ${data.weight.toFixed(1)}%`);
      holdingTriggered = true;
    }
    if (holding.weightTriggerBelow && data.shares > 0 && data.weight < holding.weightTriggerBelow) {
      triggers.push(`${data.displayTicker} wt lo ${data.weight.toFixed(1)}%`);
      holdingTriggered = true;
    }
    const nativePrice = data.shares > 0 ? (data.value / data.shares) / (data.convFactor || 1) : 0;
    if (holding.priceTriggerAbove && nativePrice > holding.priceTriggerAbove) {
      triggers.push(`${data.displayTicker} > $${holding.priceTriggerAbove}`);
      holdingTriggered = true;
    }
    if (holding.priceTriggerBelow && nativePrice < holding.priceTriggerBelow) {
      triggers.push(`${data.displayTicker} < $${holding.priceTriggerBelow}`);
      holdingTriggered = true;
    }
    // Global account-level triggers (skipped if holding is excluded) — hardcoded defaults
    const price = data.shares > 0 ? data.value / data.shares : 0;
    const DAY_CHANGE_THRESHOLD = 5;    // alert if day change exceeds ±5%
    const NEAR_52WK_THRESHOLD = 0.1;   // alert if within 0.1% of 52wk high or low

    if (!holding.excludeFromAlerts && Math.abs(data.changePercent) > DAY_CHANGE_THRESHOLD) {
      const dir = data.changePercent >= 0 ? 'up' : 'down';
      triggers.push(`${data.displayTicker} ${dir} ${data.changePercent.toFixed(1)}%`);
      holdingTriggered = true;
    }
    if (!holding.excludeFromAlerts && price > 0 && data.fiftyTwoWeekLow && data.fiftyTwoWeekLow > 0) {
      const distancePct = (price - data.fiftyTwoWeekLow) / data.fiftyTwoWeekLow * 100;
      if (distancePct <= NEAR_52WK_THRESHOLD) {
        triggers.push(`${data.displayTicker} near 52wk low`);
        holdingTriggered = true;
      }
    }
    if (!holding.excludeFromAlerts && price > 0 && data.fiftyTwoWeekHigh && data.fiftyTwoWeekHigh > 0) {
      const distancePct = (data.fiftyTwoWeekHigh - price) / data.fiftyTwoWeekHigh * 100;
      if (distancePct <= NEAR_52WK_THRESHOLD) {
        triggers.push(`${data.displayTicker} near 52wk high`);
        holdingTriggered = true;
      }
    }

    data.triggered = holdingTriggered;
  }

  const accountData: AccountData = {
    name: account.name,
    currency: account.currency,
    total: totalValue,
    totalChange,
    totalChangePercent,
    holdings,
    cash: account.cash,
    cashWeight,
    triggers,
  };
  accountData.rebalance = calculateRebalance(accountData, account);
  return accountData;
}
