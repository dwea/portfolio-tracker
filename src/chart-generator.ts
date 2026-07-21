import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getHistory } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface ChartDataPoint {
  date: string;
  accountTotal: number;
  holdings: Array<{ ticker: string; shares: number; price: number | null }>;
}

// Escape special XML characters for safe SVG inclusion
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Generate SVG line chart with account total (thick line) and holding values (thin lines)
function generateChartSVG(
  accountName: string,
  dataPoints: ChartDataPoint[],
  currency: string
): string {
  if (dataPoints.length === 0) {
    return '<svg width="800" height="400"><text x="10" y="20">No data available</text></svg>';
  }

  // Dimensions
  const width = 800;
  const height = 400;
  const marginLeft = 60;
  const marginRight = 170; // Room for the value column + ticker/Total label column on the right
  const marginTop = 40;
  const marginBottom = 60;
  const chartWidth = width - marginLeft - marginRight;
  const chartHeight = height - marginTop - marginBottom;

  // Per ticker: a running $ growth series — each day adds (shares held going into
  // that day) * (that day's price change) — and a pure price-return % series
  // (relative to the ticker's first-appearance price). A holding with no price
  // (e.g. the synthetic Cash row) simply never accrues growth. This keeps a share
  // purchase/sale from ever looking like a gain or loss on the chart, and the
  // account total is the sum of each ticker's price-driven growth rather than raw
  // value, so it also isn't skewed by trades or cash deposits/withdrawals.
  const allTickersForCalc = new Set<string>();
  dataPoints.forEach((p) => p.holdings.forEach((h) => allTickersForCalc.add(h.ticker)));

  const tickerPercent: { [key: string]: number[] } = {};
  const totalGrowth: number[] = new Array(dataPoints.length).fill(0);

  allTickersForCalc.forEach((ticker) => {
    let prevPrice: number | null = null;
    let prevShares = 0;
    let priceBase: number | null = null;
    let cumGrowth = 0;
    const growthArr: number[] = new Array(dataPoints.length).fill(0);
    const percentArr: number[] = new Array(dataPoints.length).fill(0);

    dataPoints.forEach((point, idx) => {
      const h = point.holdings.find((hh) => hh.ticker === ticker);
      const price = h ? h.price : null;

      if (priceBase === null && price !== null) priceBase = price;
      if (prevPrice !== null && price !== null) {
        cumGrowth += prevShares * (price - prevPrice);
      }
      growthArr[idx] = cumGrowth;
      percentArr[idx] = (priceBase !== null && price !== null)
        ? ((price - priceBase) / priceBase) * 100
        : (idx > 0 ? percentArr[idx - 1] : 0);

      if (price !== null) prevPrice = price;
      if (h) prevShares = h.shares;
    });

    tickerPercent[ticker] = percentArr;
    growthArr.forEach((g, idx) => { totalGrowth[idx] += g; });
  });

  const baselineTotal = dataPoints[0].accountTotal;
  const percentChangePoints = dataPoints.map((point, idx) => ({
    ...point,
    accountTotalPercent: baselineTotal > 0 ? (totalGrowth[idx] / baselineTotal) * 100 : 0,
    holdingsPercent: point.holdings.map((h) => ({
      ticker: h.ticker,
      percentChange: tickerPercent[h.ticker][idx],
    })),
  }));

  // Find percentage range
  let minPercent = Infinity;
  let maxPercent = -Infinity;

  percentChangePoints.forEach((point) => {
    minPercent = Math.min(minPercent, point.accountTotalPercent);
    maxPercent = Math.max(maxPercent, point.accountTotalPercent);
    point.holdingsPercent.forEach((h) => {
      minPercent = Math.min(minPercent, h.percentChange);
      maxPercent = Math.max(maxPercent, h.percentChange);
    });
  });

  const percentRange = maxPercent - minPercent || 10;
  const padding = percentRange * 0.15;
  const yMin = minPercent - padding;
  const yMax = maxPercent + padding;

  // Helper: convert percentage to Y coordinate
  const percentToY = (percent: number): number => {
    return marginTop + chartHeight - ((percent - yMin) / (yMax - yMin)) * chartHeight;
  };

  // Helper: convert index to X coordinate
  const indexToX = (index: number): number => {
    return marginLeft + (index / (dataPoints.length - 1)) * chartWidth;
  };

  // Get all unique tickers — Cash is excluded from the chart itself (it has no price,
  // so its line would always sit flat at 0%, which just clutters the legend).
  const allTickers = new Set<string>();
  dataPoints.forEach((p) => p.holdings.forEach((h) => allTickers.add(h.ticker)));
  allTickers.delete('Cash');
  allTickers.delete('CASH');
  const tickers = Array.from(allTickers);

  // Color palette for holdings
  const holdingColors: { [key: string]: string } = {};
  const colors = [
    '#d3d3d3', '#a9a9a9', '#808080', '#696969', '#505050',
    '#36454f', '#2f4f4f', '#708090', '#778899', '#b0c4de',
  ];
  tickers.forEach((ticker, idx) => {
    holdingColors[ticker] = colors[idx % colors.length];
  });

  let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;

  // Background
  svg += `<rect width="${width}" height="${height}" fill="white"/>`;

  // Grid lines
  for (let i = 0; i <= 5; i++) {
    const y = marginTop + (i / 5) * chartHeight;
    svg += `<line x1="${marginLeft}" y1="${y}" x2="${width - marginRight}" y2="${y}" stroke="#efefef" stroke-width="1"/>`;
  }

  // Zero line (reference)
  const zeroY = percentToY(0);
  svg += `<line x1="${marginLeft}" y1="${zeroY}" x2="${width - marginRight}" y2="${zeroY}" stroke="#999" stroke-width="1" stroke-dasharray="4,4" opacity="0.6"/>`;

  // Y-axis labels (percentages)
  for (let i = 0; i <= 5; i++) {
    const percent = yMin + (i / 5) * (yMax - yMin);
    const y = percentToY(percent);
    const label = `${percent.toFixed(1)}%`;
    svg += `<text x="${marginLeft - 10}" y="${y + 4}" text-anchor="end" font-size="11" fill="#666">${label}</text>`;
  }

  // Draw holding lines (thin, subtle) and track end points + last value for labels
  const tickerEndPoints: { [key: string]: { x: number; y: number; value: number } } = {};
  tickers.forEach((ticker) => {
    const points: string[] = [];
    let lastX = 0;
    let lastY = 0;
    let lastValue = 0;
    percentChangePoints.forEach((point, idx) => {
      const holding = point.holdingsPercent.find((h) => h.ticker === ticker);
      if (holding !== undefined) {
        const x = indexToX(idx);
        const y = percentToY(holding.percentChange);
        points.push(`${x},${y}`);
        lastX = x;
        lastY = y;
        lastValue = holding.percentChange;
      }
    });

    if (points.length > 0) {
      svg += `<polyline points="${points.join(' ')}" fill="none" stroke="${holdingColors[ticker]}" stroke-width="1.5" opacity="0.5"/>`;
      tickerEndPoints[ticker] = { x: lastX, y: lastY, value: lastValue };
    }
  });

  // Draw main account total line (thick, dark)
  const accountPoints: string[] = [];
  let accountLastX = 0;
  let accountLastY = 0;
  let accountLastPercent = 0;
  percentChangePoints.forEach((point, idx) => {
    const x = indexToX(idx);
    const y = percentToY(point.accountTotalPercent);
    accountPoints.push(`${x},${y}`);
    accountLastX = x;
    accountLastY = y;
    accountLastPercent = point.accountTotalPercent;
  });
  svg += `<polyline points="${accountPoints.join(' ')}" fill="none" stroke="#1a1a1a" stroke-width="2.5"/>`;

  // Unified right-column labels: Total sits in the same stacked column as every ticker,
  // positioned as close as possible to its own line's last point without overlapping
  // any other label. Each row shows "value  label", the value right-aligned so it grows
  // leftward (away from the label) as it gets longer, rather than colliding with it.
  interface LabelRow {
    key: string;
    endX: number;
    endY: number;
    value: number;
    color: string;
    isTotal: boolean;
    labelY: number;
  }

  const labelRows: LabelRow[] = tickers
    .filter((ticker) => tickerEndPoints[ticker])
    .map((ticker) => ({
      key: ticker,
      endX: tickerEndPoints[ticker].x,
      endY: tickerEndPoints[ticker].y,
      value: tickerEndPoints[ticker].value,
      color: holdingColors[ticker],
      isTotal: false,
      labelY: tickerEndPoints[ticker].y + 4,
    }));

  labelRows.push({
    key: 'Total',
    endX: accountLastX,
    endY: accountLastY,
    value: accountLastPercent,
    color: '#1a1a1a',
    isTotal: true,
    labelY: accountLastY + 4,
  });

  // Sort by natural Y and stack downward to resolve overlaps
  labelRows.sort((a, b) => a.labelY - b.labelY);
  const labelLineHeight = 13;
  for (let i = 0; i < labelRows.length; i++) {
    for (let j = i + 1; j < labelRows.length; j++) {
      if (labelRows[i].labelY + labelLineHeight > labelRows[j].labelY - 1) {
        labelRows[j].labelY = labelRows[i].labelY + labelLineHeight + 1;
      }
    }
  }

  const estimateTextWidth = (str: string): number => str.length * 6.5;
  const formatRowValue = (v: number): string => `${v.toFixed(1)}%`;
  const valueColWidth = Math.max(...labelRows.map((r) => estimateTextWidth(formatRowValue(r.value))));
  const plotRightEdge = width - marginRight;
  const GAP_LINE_TO_VALUE = 20; // gap between the plot area and the value column
  const GAP_VALUE_TO_LABEL = 10; // gap between the value column and the label column
  const valueRightX = plotRightEdge + GAP_LINE_TO_VALUE + valueColWidth;
  const labelLeftX = valueRightX + GAP_VALUE_TO_LABEL;

  labelRows.forEach((row) => {
    const escapedKey = escapeXml(row.key);
    const movedDistance = Math.abs(row.labelY - (row.endY + 4));

    // Connector line back to the line's actual last point if the label had to move.
    if (movedDistance > 6) {
      svg += `<line x1="${row.endX}" y1="${row.endY}" x2="${labelLeftX - 4}" y2="${row.labelY - 5}" stroke="${row.color}" stroke-width="0.5" opacity="0.3"/>`;
    }

    // Value: right-aligned, white backing box so longer numbers never collide with the label.
    const valueStr = formatRowValue(row.value);
    const valueColor = row.value >= 0 ? '#1a1a1a' : '#dc2626';
    svg += `<rect x="${valueRightX - valueColWidth - 4}" y="${row.labelY - 9}" width="${valueColWidth + 8}" height="16" fill="white"/>`;
    svg += `<text x="${valueRightX}" y="${row.labelY}" text-anchor="end" font-size="10" font-family="Arial, Helvetica, sans-serif" fill="${valueColor}">${valueStr}</text>`;

    // Label: left-aligned, starting a fixed gap after the value column.
    svg += `<text x="${labelLeftX}" y="${row.labelY}" font-size="11" font-weight="bold" font-family="Arial, Helvetica, sans-serif" fill="${row.color}" opacity="${row.isTotal ? 1 : 0.85}">${escapedKey}</text>`;
  });

  // X-axis
  svg += `<line x1="${marginLeft}" y1="${marginTop + chartHeight}" x2="${width - marginRight}" y2="${marginTop + chartHeight}" stroke="#333" stroke-width="1"/>`;

  // X-axis labels (dates without year)
  for (let i = 0; i < dataPoints.length; i += Math.max(1, Math.floor(dataPoints.length / 6))) {
    const point = dataPoints[i];
    const x = indexToX(i);
    const dateWithoutYear = point.date.substring(5); // Remove YYYY- prefix
    svg += `<text x="${x}" y="${marginTop + chartHeight + 20}" text-anchor="middle" font-size="11" fill="#666">${dateWithoutYear}</text>`;
  }

  // Y-axis
  svg += `<line x1="${marginLeft}" y1="${marginTop}" x2="${marginLeft}" y2="${marginTop + chartHeight}" stroke="#333" stroke-width="1"/>`;

  // Title
  svg += `<text x="${width / 2}" y="25" text-anchor="middle" font-size="16" font-weight="bold">${accountName} — % Change from Price, Since Earliest Data</text>`;

  svg += '</svg>';
  return svg;
}

// Main function to generate and save chart
export async function generateAccountChart(
  _db: any, // Unused, for API compatibility
  accountName: string,
  accountCurrency: string,
  days: number = 30
): Promise<string> {
  const chartsDir = path.join(__dirname, '../public/charts');
  if (!fs.existsSync(chartsDir)) {
    fs.mkdirSync(chartsDir, { recursive: true });
  }

  try {
    const history = await getHistory(accountName, days);

    if (history.length === 0) {
      // Return a simple placeholder chart
      const svg = `<svg width="800" height="400"><text x="10" y="20">No historical data yet for ${accountName}</text></svg>`;
      const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
      const filename = `${accountName}-trend.png`;
      const filepath = path.join(chartsDir, filename);
      fs.writeFileSync(filepath, buffer);
      return `/charts/${filename}`;
    }

    const dataPoints: ChartDataPoint[] = history.map((row) => ({
      date: row.date,
      accountTotal: row.accountTotal,
      holdings: row.snapshot.map((h: any) => ({
        ticker: h.displayTicker || h.ticker,
        shares: h.shares,
        price: typeof h.price === 'number' ? h.price : null,
      })),
    }));

    // Generate SVG
    const svg = generateChartSVG(accountName, dataPoints, accountCurrency === 'CAD' ? 'C$' : '$');

    // Convert SVG to PNG
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();

    const filename = `${accountName}-trend.png`;
    const filepath = path.join(chartsDir, filename);
    fs.writeFileSync(filepath, buffer);

    return `/charts/${filename}`;
  } catch (error: any) {
    console.error(`Error generating chart for ${accountName}:`, error);
    // Return placeholder on error
    const svg = `<svg width="800" height="400"><text x="10" y="20">Error generating chart for ${accountName}</text></svg>`;
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
    const filename = `${accountName}-trend-error-${new Date().toISOString().split('T')[0]}.png`;
    const filepath = path.join(chartsDir, filename);
    fs.writeFileSync(filepath, buffer);
    return `/charts/${filename}`;
  }
}
