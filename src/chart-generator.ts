import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getHistory } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface ChartDataPoint {
  date: string;
  accountTotal: number;
  holdings: Array<{ ticker: string; value: number }>;
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
  const marginRight = 100; // Increased to accommodate ticker labels
  const marginTop = 40;
  const marginBottom = 60;
  const chartWidth = width - marginLeft - marginRight;
  const chartHeight = height - marginTop - marginBottom;

  // Get baseline (first data point) values
  const baselineTotal = dataPoints[0].accountTotal;
  const baselineHoldings: { [key: string]: number } = {};
  dataPoints[0].holdings.forEach((h) => {
    baselineHoldings[h.ticker] = h.value;
  });

  // Calculate percentage changes
  const percentChangePoints = dataPoints.map((point) => ({
    ...point,
    accountTotalPercent: baselineTotal > 0 ? ((point.accountTotal - baselineTotal) / baselineTotal) * 100 : 0,
    holdingsPercent: point.holdings.map((h) => ({
      ticker: h.ticker,
      percentChange: baselineHoldings[h.ticker] && baselineHoldings[h.ticker] > 0
        ? ((h.value - baselineHoldings[h.ticker]) / baselineHoldings[h.ticker]) * 100
        : 0
    }))
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

  // Get all unique tickers
  const allTickers = new Set<string>();
  dataPoints.forEach((p) => p.holdings.forEach((h) => allTickers.add(h.ticker)));
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

  // Draw holding lines (thin, subtle) and track end points for labels
  const tickerEndPoints: { [key: string]: { x: number; y: number } } = {};
  tickers.forEach((ticker) => {
    const points: string[] = [];
    let lastX = 0;
    let lastY = 0;
    percentChangePoints.forEach((point, idx) => {
      const holding = point.holdingsPercent.find((h) => h.ticker === ticker);
      if (holding !== undefined) {
        const x = indexToX(idx);
        const y = percentToY(holding.percentChange);
        points.push(`${x},${y}`);
        lastX = x;
        lastY = y;
      }
    });

    if (points.length > 0) {
      svg += `<polyline points="${points.join(' ')}" fill="none" stroke="${holdingColors[ticker]}" stroke-width="1.5" opacity="0.5"/>`;
      tickerEndPoints[ticker] = { x: lastX, y: lastY };
    }
  });

  // Draw main account total line (thick, dark)
  const accountPoints: string[] = [];
  let accountLastX = 0;
  let accountLastY = 0;
  percentChangePoints.forEach((point, idx) => {
    const x = indexToX(idx);
    const y = percentToY(point.accountTotalPercent);
    accountPoints.push(`${x},${y}`);
    accountLastX = x;
    accountLastY = y;
  });
  svg += `<polyline points="${accountPoints.join(' ')}" fill="none" stroke="#1a1a1a" stroke-width="2.5"/>`;

  // Add ticker labels at the end of each line (large font for mobile readability)
  tickers.forEach((ticker) => {
    const endPoint = tickerEndPoints[ticker];
    if (endPoint) {
      const labelX = endPoint.x + 12;
      const labelY = endPoint.y + 6;
      const escapedTicker = escapeXml(ticker);
      svg += `<text x="${labelX}" y="${labelY}" font-size="18" font-weight="bold" fill="${holdingColors[ticker]}" opacity="0.85">${escapedTicker}</text>`;
    }
  });

  // Add "Total" label at the end of account total line
  const escapedAccountName = escapeXml(accountName);
  svg += `<text x="${accountLastX + 12}" y="${accountLastY + 6}" font-size="18" font-weight="bold" fill="#1a1a1a">Total</text>`;
  svg += `<text x="${accountLastX + 12}" y="${accountLastY + 20}" font-size="12" fill="#666">${escapedAccountName}</text>`;

  // X-axis
  svg += `<line x1="${marginLeft}" y1="${marginTop + chartHeight}" x2="${width - marginRight}" y2="${marginTop + chartHeight}" stroke="#333" stroke-width="1"/>`;

  // X-axis labels (dates)
  for (let i = 0; i < dataPoints.length; i += Math.max(1, Math.floor(dataPoints.length / 6))) {
    const point = dataPoints[i];
    const x = indexToX(i);
    svg += `<text x="${x}" y="${marginTop + chartHeight + 20}" text-anchor="middle" font-size="11" fill="#666">${point.date}</text>`;
  }

  // Y-axis
  svg += `<line x1="${marginLeft}" y1="${marginTop}" x2="${marginLeft}" y2="${marginTop + chartHeight}" stroke="#333" stroke-width="1"/>`;

  // Title
  svg += `<text x="${width / 2}" y="25" text-anchor="middle" font-size="16" font-weight="bold">${accountName} — % Change from Earliest Data</text>`;

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
        value: h.value,
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
