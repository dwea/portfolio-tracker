import sharp from 'sharp';
import { ReportData } from './types.js';

// Inline sparkline — same height as a line of text in iMessage
// Width is dynamic based on number of holdings
const HEIGHT = 32;
const PADDING_H = 2;
const SCALE_LABEL_W = 24; // space on right for ±N% label
const BAR_WIDTH = 5;  // ~en-dash width
const BAR_GAP = 2;

const COLOR_POS      = '#4ade80';
const COLOR_NEG      = '#f87171';
const COLOR_ZERO     = '#94a3b8';
const COLOR_ZEROLINE = '#666677';
const COLOR_SCALETEXT = '#9999aa';

function niceMax(value: number): number {
  if (value <= 0.5) return 0.5;
  if (value <= 1)   return 1;
  if (value <= 2)   return 2;
  if (value <= 3)   return 3;
  if (value <= 5)   return 5;
  return Math.ceil(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export async function generateSparkline(data: ReportData, outputPath: string): Promise<void> {
  const holdings = data.accounts.flatMap(acc => acc.holdings);

  if (holdings.length === 0) return;

  const n = holdings.length;
  const WIDTH = PADDING_H * 2 + SCALE_LABEL_W + n * BAR_WIDTH + (n - 1) * BAR_GAP;

  const maxAbsPercent = Math.max(...holdings.map(h => Math.abs(h.changePercent)));
  const scale = niceMax(maxAbsPercent);

  const zeroY = HEIGHT / 2;
  const halfBar = HEIGHT / 2 - 1; // 1px margin top/bottom

  const bars: string[] = [];

  holdings.forEach((holding, i) => {
    const x = PADDING_H + i * (BAR_WIDTH + BAR_GAP);
    const pct = holding.changePercent;
    const clamped = clamp(Math.abs(pct), 0, scale);
    const barH = Math.max(1, Math.round((clamped / scale) * halfBar));
    const color = pct > 0 ? COLOR_POS : pct < 0 ? COLOR_NEG : COLOR_ZERO;
    const barY = pct >= 0 ? zeroY - barH : zeroY;

    bars.push(`<rect x="${x}" y="${barY}" width="${BAR_WIDTH}" height="${barH}" fill="${color}"/>`);
  });

  // Scale label on the right, vertically centred
  const scaleLabel = `±${scale}%`;

  const svg = `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">

  <!-- Zero axis -->
  <line x1="${PADDING_H}" y1="${zeroY}" x2="${WIDTH - SCALE_LABEL_W - PADDING_H}" y2="${zeroY}" stroke="${COLOR_ZEROLINE}" stroke-width="0.5"/>

  <!-- Bars -->
  ${bars.join('\n  ')}

  <!-- Scale label -->
  <text x="${WIDTH - 2}" y="${zeroY + 4}" font-size="9" font-family="sans-serif" fill="${COLOR_SCALETEXT}" text-anchor="end">${scaleLabel}</text>

</svg>`;

  await sharp(Buffer.from(svg)).png().toFile(outputPath);
}
