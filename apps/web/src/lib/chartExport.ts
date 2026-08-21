import type { StatColumn } from '@fcm/contracts';
import html2canvas from 'html2canvas';
import type { CompareEntity } from '../components/charts/compareEntity';
import { heatColor } from '../components/PercentileHeatCell';
import { CHART_THEME } from '../components/charts/palette';
import { toNumericValue } from './statPool';

export interface TrendLegendRow {
  id: string;
  name: string;
  owner?: string;
  headshotUrl?: string;
  color: string;
  l30: number | null;
  l21: number | null;
  l14: number | null;
  l7: number | null;
  szn: number | null;
}

const OUTPUT_SCALE = 2.5;
/** Draw the chart larger in exports so the PNG reads well beside the legend card. */
const CHART_EXPORT_BOOST = 1.35;

const LEGEND = {
  pad: 10,
  titleH: 20,
  headerH: 22,
  rowH: 24,
  gap: 6,
  swatch: 8,
  avatar: 18,
  valueColW: 34,
  radius: 8,
  titleSize: 11,
  headerSize: 10,
  bodySize: 12,
  nameSize: 12,
} as const;

function sanitizeFilename(label: string): string {
  return label.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'chart';
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function formatCell(v: number | null): string {
  return v == null ? '\u2013' : ordinal(v);
}

function entityInitials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase();
}

function parseSvgLength(value: string | null, fallback: number): number {
  if (!value || value.endsWith('%')) return fallback;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function findChartSvg(root: HTMLElement): SVGSVGElement {
  const svg =
    root.querySelector<SVGSVGElement>('svg.recharts-surface') ??
    root.querySelector<SVGSVGElement>('[data-chart-surface] svg') ??
    root.querySelector<SVGSVGElement>('svg');
  if (!svg) throw new Error('Chart SVG not found');
  return svg;
}

/** Pixel size of the plotted SVG — always follow viewBox, never layout-inflated widths. */
function resolveSvgRasterSize(svg: SVGSVGElement): { width: number; height: number } {
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  let width = viewBox.width > 0 ? viewBox.width : rect.width;
  let height = viewBox.height > 0 ? viewBox.height : rect.height;
  width = parseSvgLength(svg.getAttribute('width'), width);
  height = parseSvgLength(svg.getAttribute('height'), height);
  if (width <= 1) width = rect.width;
  if (height <= 1) height = rect.height;
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

function prepareSvgClone(svg: SVGSVGElement): {
  clone: SVGSVGElement;
  width: number;
  height: number;
} {
  const { width, height } = resolveSvgRasterSize(svg);
  const viewBox = svg.getAttribute('viewBox');

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('viewBox', viewBox ?? `0 0 ${width} ${height}`);
  clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone
    .querySelectorAll('.recharts-tooltip-cursor, .recharts-active-bar')
    .forEach((el) => el.remove());

  return { clone, width, height };
}

async function svgToImage(svg: SVGSVGElement): Promise<HTMLImageElement> {
  const { clone } = prepareSvgClone(svg);
  const serialized = new XMLSerializer().serializeToString(clone);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const { width, height } = resolveSvgRasterSize(svg);
      if (img.naturalWidth < width * 0.5 || img.naturalHeight < height * 0.5) {
        reject(new Error('Chart SVG rasterized at unexpected size'));
        return;
      }
      resolve(img);
    };
    img.onerror = () => reject(new Error('Failed to render chart SVG'));
    img.src = url;
  });
}

function drawRasterizedChart(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  destW: number,
  destH: number,
): void {
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  ctx.drawImage(img, 0, 0, srcW, srcH, x, y, destW, destH);
}

/** Capture the compare chart - try SVG first, fall back to html2canvas. */
async function captureCompareChart(
  root: HTMLElement,
): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
  // Find the chart surface
  const surface = root.querySelector('[data-chart-surface]');
  if (!(surface instanceof HTMLElement)) throw new Error('Chart surface not found');

  // Get dimensions from the surface element
  const rect = surface.getBoundingClientRect();
  const width = Math.max(400, Math.round(rect.width));
  const height = Math.max(300, Math.round(rect.height));

  // Try to find and render the SVG directly
  const svg = surface.querySelector<SVGSVGElement>('svg.recharts-surface');
  if (svg) {
    try {
      const img = await svgToImage(svg);
      const canvas = document.createElement('canvas');
      canvas.width = width * 2;
      canvas.height = height * 2;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(2, 2);
      ctx.fillStyle = CHART_THEME.panel;
      ctx.fillRect(0, 0, width, height);

      // Draw the SVG centered/scaled to fill the surface
      const svgRect = svg.getBoundingClientRect();
      const scale = Math.min(width / svgRect.width, height / svgRect.height);
      const drawW = svgRect.width * scale;
      const drawH = svgRect.height * scale;
      const drawX = (width - drawW) / 2;
      const drawY = (height - drawH) / 2;
      ctx.drawImage(img, drawX, drawY, drawW, drawH);

      return { canvas, width, height };
    } catch {
      // Fall through to html2canvas
    }
  }

  // Fallback to html2canvas
  const canvas = await html2canvas(surface, {
    backgroundColor: CHART_THEME.panel,
    scale: 2,
    logging: false,
    useCORS: true,
    width,
    height,
    windowWidth: Math.max(width, 1200),
    windowHeight: Math.max(height, 600),
  });

  return { canvas, width: canvas.width / 2, height: canvas.height / 2 };
}

async function loadHeadshot(url: string): Promise<HTMLImageElement | null> {
  try {
    const res = await fetch(url, { mode: 'no-cors', credentials: 'omit' });
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(null);
      };
      img.src = objectUrl;
    });
  } catch {
    return null;
  }
}

async function loadHeadshots(
  rows: TrendLegendRow[],
): Promise<Map<string, HTMLImageElement | null>> {
  const map = new Map<string, HTMLImageElement | null>();
  await Promise.all(
    rows.map(async (row) => {
      if (!row.headshotUrl) {
        map.set(row.id, null);
        return;
      }
      map.set(row.id, await loadHeadshot(row.headshotUrl));
    }),
  );
  return map;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawAvatar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  img: HTMLImageElement | null | undefined,
  label: string,
): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.clip();
  if (img) {
    ctx.drawImage(img, x, y, size, size);
  } else {
    ctx.fillStyle = CHART_THEME.border;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = CHART_THEME.text;
    ctx.font = `700 ${Math.round(size * 0.38)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(entityInitials(label), cx, cy + 0.5);
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.stroke();
}

function valueColumns(
  hasL21: boolean,
  hasL14: boolean,
): Array<{ key: keyof TrendLegendRow; label: string }> {
  return [
    { key: 'l30', label: 'L30' },
    ...(hasL21 ? [{ key: 'l21' as const, label: 'L21' }] : []),
    ...(hasL14 ? [{ key: 'l14' as const, label: 'L14' }] : []),
    { key: 'l7', label: 'L7' },
    { key: 'szn', label: 'Szn' },
  ];
}

function measureLegendLayout(
  ctx: CanvasRenderingContext2D,
  rows: TrendLegendRow[],
  hasL21: boolean,
  hasL14: boolean,
): { width: number; height: number; nameColW: number; valueCols: ReturnType<typeof valueColumns> } {
  const valueCols = valueColumns(hasL21, hasL14);
  const playerPrefix = LEGEND.swatch + LEGEND.gap + LEGEND.avatar + LEGEND.gap;

  ctx.font = `600 ${LEGEND.nameSize}px system-ui, sans-serif`;
  let nameColW = ctx.measureText('Player').width;
  for (const row of rows) {
    const label = row.owner ? `${row.name} (${row.owner})` : row.name;
    nameColW = Math.max(nameColW, ctx.measureText(label).width);
  }
  nameColW = Math.ceil(nameColW + playerPrefix);

  const width = LEGEND.pad * 2 + nameColW + valueCols.length * LEGEND.valueColW;
  const height = LEGEND.pad * 2 + LEGEND.titleH + LEGEND.headerH + rows.length * LEGEND.rowH;

  return { width, height, nameColW, valueCols };
}

function renderLegendCanvas(
  rows: TrendLegendRow[],
  metricLabel: string,
  hasL21: boolean,
  hasL14: boolean,
  headshots: Map<string, HTMLImageElement | null>,
): HTMLCanvasElement {
  const scratch = document.createElement('canvas');
  const measureCtx = scratch.getContext('2d')!;
  const { width, height, nameColW, valueCols } = measureLegendLayout(
    measureCtx,
    rows,
    hasL21,
    hasL14,
  );

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = 'rgba(15, 23, 42, 0.98)';
  roundRect(ctx, 0, 0, width, height, LEGEND.radius);
  ctx.fill();
  ctx.strokeStyle = CHART_THEME.border;
  ctx.lineWidth = 1;
  roundRect(ctx, 0, 0, width, height, LEGEND.radius);
  ctx.stroke();

  let y = LEGEND.pad;

  ctx.fillStyle = CHART_THEME.muted;
  ctx.font = `700 ${LEGEND.titleSize}px system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`${metricLabel.toUpperCase()} PERCENTILE`, LEGEND.pad, y);
  y += LEGEND.titleH;

  ctx.font = `700 ${LEGEND.headerSize}px system-ui, sans-serif`;
  ctx.fillText('PLAYER', LEGEND.pad, y + 6);

  let colX = LEGEND.pad + nameColW;
  for (const col of valueCols) {
    ctx.textAlign = 'right';
    ctx.fillText(col.label, colX + LEGEND.valueColW - 2, y + 6);
    colX += LEGEND.valueColW;
  }
  y += LEGEND.headerH;

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
  ctx.beginPath();
  ctx.moveTo(LEGEND.pad, y - 4);
  ctx.lineTo(width - LEGEND.pad, y - 4);
  ctx.stroke();

  for (const row of rows) {
    const rowMid = y + LEGEND.rowH / 2;
    const swatchY = rowMid - LEGEND.swatch / 2;

    ctx.fillStyle = row.color;
    ctx.fillRect(LEGEND.pad, swatchY, LEGEND.swatch, LEGEND.swatch);

    drawAvatar(
      ctx,
      LEGEND.pad + LEGEND.swatch + LEGEND.gap,
      rowMid - LEGEND.avatar / 2,
      LEGEND.avatar,
      headshots.get(row.id),
      row.name,
    );

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = CHART_THEME.text;
    ctx.font = `600 ${LEGEND.nameSize}px system-ui, sans-serif`;
    const name = row.owner ? `${row.name} (${row.owner})` : row.name;
    ctx.fillText(
      name,
      LEGEND.pad + LEGEND.swatch + LEGEND.gap + LEGEND.avatar + LEGEND.gap,
      rowMid,
    );

    colX = LEGEND.pad + nameColW;
    ctx.font = `600 ${LEGEND.bodySize}px ui-monospace, monospace`;
    for (const col of valueCols) {
      ctx.textAlign = 'right';
      const val = row[col.key];
      ctx.fillText(
        formatCell(typeof val === 'number' ? val : null),
        colX + LEGEND.valueColW - 2,
        rowMid,
      );
      colX += LEGEND.valueColW;
    }

    y += LEGEND.rowH;
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  return canvas;
}

export interface CompareTileStatExport {
  label: string;
  display: string;
  rank: number | null;
  total: number | null;
  heatBg: string | null;
}

export interface CompareTileExport {
  id: string;
  name: string;
  subtitle?: string;
  imageUrl?: string;
  kind: 'player' | 'team';
  stats: CompareTileStatExport[];
}

const COMPARE_TILE = {
  gap: 12,
  pad: 11,
  headH: 30,
  statRowH: 20,
  radius: 10,
  minW: 190,
  avatar: 22,
  nameSize: 12,
  ownerSize: 10,
  labelSize: 11,
  valueSize: 11,
  rankSize: 11,
  rankPadX: 6,
  rankMinW: 34,
} as const;

/** Shape entity + pool stats into the rows drawn beneath the compare chart in PNG exports. */
export function buildCompareTileExports(
  entities: CompareEntity[],
  columns: ReadonlyArray<StatColumn>,
  percentiles: Map<string, (value: number) => number>,
  ranks: Map<string, (value: number) => { rank: number; total: number }>,
): CompareTileExport[] {
  return entities.map((entity) => {
    const byKey = new Map(entity.stats.map((s) => [s.key, s.value]));
    return {
      id: entity.id,
      name: entity.name,
      ...(entity.subtitle ? { subtitle: entity.subtitle } : {}),
      ...(entity.imageUrl ? { imageUrl: entity.imageUrl } : {}),
      kind: entity.kind,
      stats: columns.map((col) => {
        const raw = byKey.get(col.key);
        const num = toNumericValue(raw);
        const display = raw == null ? '-' : String(raw);
        const pct = num == null ? null : (percentiles.get(col.key)?.(num) ?? null);
        const rankInfo = num == null ? null : (ranks.get(col.key)?.(num) ?? null);
        return {
          label: col.label,
          display,
          rank: rankInfo?.rank ?? null,
          total: rankInfo?.total ?? null,
          heatBg: pct == null ? null : heatColor(pct),
        };
      }),
    };
  });
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}\u2026`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}\u2026`;
}

function measureCompareTilesLayout(
  ctx: CanvasRenderingContext2D,
  tiles: CompareTileExport[],
  totalWidth: number,
): { tileW: number; height: number } {
  const count = Math.max(tiles.length, 1);
  const tileW = Math.max(
    COMPARE_TILE.minW,
    Math.floor((totalWidth - COMPARE_TILE.gap * (count - 1)) / count),
  );

  ctx.font = `700 ${COMPARE_TILE.nameSize}px system-ui, sans-serif`;
  let headH: number = COMPARE_TILE.headH;
  if (tiles.some((tile) => tile.subtitle)) {
    headH = Math.max(headH, COMPARE_TILE.headH + 10);
  }

  const maxStats = tiles.reduce((max, tile) => Math.max(max, tile.stats.length), 0);
  const height = COMPARE_TILE.pad * 2 + headH + maxStats * COMPARE_TILE.statRowH;

  return { tileW, height };
}

function renderCompareTilesCanvas(
  tiles: CompareTileExport[],
  totalWidth: number,
  headshots: Map<string, HTMLImageElement | null>,
): HTMLCanvasElement {
  const scratch = document.createElement('canvas');
  const measureCtx = scratch.getContext('2d')!;
  const { tileW, height } = measureCompareTilesLayout(measureCtx, tiles, totalWidth);

  const canvas = document.createElement('canvas');
  canvas.width = totalWidth;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const innerW = tileW - COMPARE_TILE.pad * 2;
  const labelColW = Math.floor(innerW * 0.42);
  const valueColW = Math.floor(innerW * 0.28);

  let x = 0;
  for (const tile of tiles) {
    ctx.fillStyle = 'rgba(148, 163, 184, 0.05)';
    roundRect(ctx, x, 0, tileW, height, COMPARE_TILE.radius);
    ctx.fill();
    ctx.strokeStyle = CHART_THEME.border;
    ctx.lineWidth = 1;
    roundRect(ctx, x, 0, tileW, height, COMPARE_TILE.radius);
    ctx.stroke();

    const avatarX = x + COMPARE_TILE.pad;
    const avatarY = COMPARE_TILE.pad + 2;
    drawAvatar(ctx, avatarX, avatarY, COMPARE_TILE.avatar, headshots.get(tile.id), tile.name);

    const nameX = avatarX + COMPARE_TILE.avatar + 8;
    const nameMaxW = tileW - COMPARE_TILE.pad - nameX + x;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = CHART_THEME.text;
    ctx.font = `700 ${COMPARE_TILE.nameSize}px system-ui, sans-serif`;
    ctx.fillText(truncateText(ctx, tile.name, nameMaxW), nameX, avatarY);

    if (tile.subtitle) {
      ctx.fillStyle = CHART_THEME.muted;
      ctx.font = `500 ${COMPARE_TILE.ownerSize}px system-ui, sans-serif`;
      ctx.fillText(truncateText(ctx, tile.subtitle, nameMaxW), nameX, avatarY + 14);
    }

    let rowY = COMPARE_TILE.pad + COMPARE_TILE.headH;
    for (const stat of tile.stats) {
      if (rowY > COMPARE_TILE.pad + COMPARE_TILE.headH) {
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
        ctx.beginPath();
        ctx.moveTo(x + COMPARE_TILE.pad, rowY - 4);
        ctx.lineTo(x + tileW - COMPARE_TILE.pad, rowY - 4);
        ctx.stroke();
      }

      const rowMid = rowY + COMPARE_TILE.statRowH / 2;
      const labelX = x + COMPARE_TILE.pad;

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = CHART_THEME.muted;
      ctx.font = `600 ${COMPARE_TILE.labelSize}px system-ui, sans-serif`;
      ctx.fillText(truncateText(ctx, stat.label, labelColW - 4), labelX, rowMid);

      ctx.fillStyle = CHART_THEME.text;
      ctx.font = `500 ${COMPARE_TILE.valueSize}px ui-monospace, monospace`;
      ctx.fillText(truncateText(ctx, stat.display, valueColW - 4), labelX + labelColW, rowMid);

      const rankLabel = stat.rank == null ? '\u2013' : ordinal(stat.rank);
      ctx.font = `600 ${COMPARE_TILE.rankSize}px ui-monospace, monospace`;
      const rankTextW = ctx.measureText(rankLabel).width + COMPARE_TILE.rankPadX * 2;
      const rankW = Math.max(COMPARE_TILE.rankMinW, rankTextW);
      const rankX = x + tileW - COMPARE_TILE.pad - rankW;

      if (stat.heatBg) {
        ctx.fillStyle = stat.heatBg;
        roundRect(ctx, rankX, rowMid - 9, rankW, 18, 6);
        ctx.fill();
      }

      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'center';
      ctx.fillText(rankLabel, rankX + rankW / 2, rowMid + 0.5);

      rowY += COMPARE_TILE.statRowH;
    }

    x += tileW + COMPARE_TILE.gap;
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  return canvas;
}

/** Rasterize the grouped compare chart plus entity stat tiles and trigger a PNG download. */
export async function downloadCompareChartPng(options: {
  chartRoot: HTMLElement;
  title: string;
  subtitle: string;
  tiles: CompareTileExport[];
  filename: string;
}): Promise<void> {
  const { chartRoot, title, subtitle, tiles, filename } = options;

  const pad = 32;
  const titleH = 40;
  const subtitleH = 22;
  const sectionGap = 20;
  const tilesGap = 16;

  const [chartResult, headshots] = await Promise.all([
    captureCompareChart(chartRoot),
    loadHeadshots(
      tiles.map((tile) => ({
        id: tile.id,
        name: tile.name,
        ...(tile.imageUrl ? { headshotUrl: tile.imageUrl } : {}),
        color: CHART_THEME.accent,
        l30: null,
        l21: null,
        l14: null,
        l7: null,
        szn: null,
      })),
    ),
  ]);

  const { canvas: chartCapture, width: rasterW, height: rasterH } = chartResult;
  const tilesMinW =
    tiles.length * COMPARE_TILE.minW + Math.max(0, tiles.length - 1) * COMPARE_TILE.gap;
  const layoutW = Math.max(rasterW, tilesMinW);
  const chartDrawW = Math.round(layoutW * CHART_EXPORT_BOOST);
  const chartDrawH = Math.round(rasterH * CHART_EXPORT_BOOST);

  const tilesCanvas = renderCompareTilesCanvas(tiles, chartDrawW, headshots);
  const tilesDrawH = tilesCanvas.height;

  const canvasW = pad * 2 + chartDrawW;
  const canvasH = pad + titleH + subtitleH + sectionGap + chartDrawH + tilesGap + tilesDrawH + pad;
  const canvas = document.createElement('canvas');
  canvas.width = canvasW * OUTPUT_SCALE;
  canvas.height = canvasH * OUTPUT_SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');

  ctx.scale(OUTPUT_SCALE, OUTPUT_SCALE);
  ctx.fillStyle = CHART_THEME.panel;
  ctx.fillRect(0, 0, canvasW, canvasH);

  ctx.fillStyle = CHART_THEME.text;
  ctx.font = '700 20px system-ui, sans-serif';
  ctx.fillText(title, pad, pad + 6);

  ctx.fillStyle = CHART_THEME.muted;
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillText(subtitle, pad, pad + titleH - 6);

  const chartY = pad + titleH + subtitleH + sectionGap;
  ctx.drawImage(chartCapture, pad, chartY, chartDrawW, chartDrawH);
  ctx.drawImage(tilesCanvas, pad, chartY + chartDrawH + tilesGap, chartDrawW, tilesDrawH);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png');
  });

  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sanitizeFilename(filename)}.png`;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Rasterize a whole player-focus card - the header, the stat "compare card" tiles, and the
 * recent-form trend chart with its percentile legend - into one PNG (the News section is
 * deliberately omitted). The stat tiles are drawn in a fixed left column so a single-player
 * card doesn't stretch the tile across the full width; the chart + legend sit to the right.
 * The chart is optional: when the card is collapsed to the stat panel (no chart mounted),
 * the export falls back to header + tiles.
 */
export async function downloadPlayerCardPng(options: {
  /** Element that contains the trend chart SVG (may be absent when the chart isn't mounted). */
  chartRoot: HTMLElement | null;
  title: string;
  subtitle: string;
  metricLabel: string;
  tiles: CompareTileExport[];
  legendRows: TrendLegendRow[];
  hasL21: boolean;
  hasL14: boolean;
  filename: string;
}): Promise<void> {
  const { chartRoot, title, subtitle, metricLabel, tiles, legendRows, hasL21, hasL14, filename } =
    options;

  const pad = 32;
  const titleH = 40;
  const subtitleH = 22;
  const colGap = 24;
  const rowGap = 16;
  /** Fixed width for the stat card column so one tile reads at a sensible size, not stretched. */
  const tilesColW = Math.max(
    320,
    tiles.length * COMPARE_TILE.minW + Math.max(0, tiles.length - 1) * COMPARE_TILE.gap,
  );

  // The trend chart only exists when its panel is mounted; capture it when present.
  let svg: SVGSVGElement | null = null;
  if (chartRoot) {
    try {
      svg = findChartSvg(chartRoot);
    } catch {
      svg = null;
    }
  }

  const tileHeadshotRows: TrendLegendRow[] = tiles.map((tile) => ({
    id: tile.id,
    name: tile.name,
    ...(tile.imageUrl ? { headshotUrl: tile.imageUrl } : {}),
    color: CHART_THEME.accent,
    l30: null,
    l21: null,
    l14: null,
    l7: null,
    szn: null,
  }));

  const [chartImg, tileHeadshots, legendHeadshots] = await Promise.all([
    svg ? svgToImage(svg) : Promise.resolve(null),
    loadHeadshots(tileHeadshotRows),
    loadHeadshots(legendRows),
  ]);

  const tilesCanvas = renderCompareTilesCanvas(tiles, tilesColW, tileHeadshots);

  let chartDrawW = 0;
  let chartDrawH = 0;
  let legendCanvas: HTMLCanvasElement | null = null;
  if (svg) {
    const { width: rasterW, height: rasterH } = resolveSvgRasterSize(svg);
    chartDrawW = Math.round(rasterW * CHART_EXPORT_BOOST);
    chartDrawH = Math.round(rasterH * CHART_EXPORT_BOOST);
    legendCanvas = renderLegendCanvas(legendRows, metricLabel, hasL21, hasL14, legendHeadshots);
  }

  const rightColW = legendCanvas ? Math.max(chartDrawW, legendCanvas.width) : 0;
  const rightColH = legendCanvas ? chartDrawH + rowGap + legendCanvas.height : 0;
  const contentW = rightColW > 0 ? tilesColW + colGap + rightColW : tilesColW;
  const contentH = Math.max(tilesCanvas.height, rightColH);

  const canvasW = pad * 2 + contentW;
  const canvasH = pad + titleH + subtitleH + contentH + pad;
  const canvas = document.createElement('canvas');
  canvas.width = canvasW * OUTPUT_SCALE;
  canvas.height = canvasH * OUTPUT_SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');

  ctx.scale(OUTPUT_SCALE, OUTPUT_SCALE);
  ctx.fillStyle = CHART_THEME.panel;
  ctx.fillRect(0, 0, canvasW, canvasH);

  ctx.fillStyle = CHART_THEME.text;
  ctx.font = '700 20px system-ui, sans-serif';
  ctx.fillText(title, pad, pad + 6);

  if (subtitle) {
    ctx.fillStyle = CHART_THEME.muted;
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText(subtitle, pad, pad + titleH - 6);
  }

  const contentY = pad + titleH + subtitleH;
  ctx.drawImage(tilesCanvas, pad, contentY, tilesCanvas.width, tilesCanvas.height);

  if (chartImg && legendCanvas) {
    const rightX = pad + tilesColW + colGap;
    drawRasterizedChart(ctx, chartImg, rightX, contentY, chartDrawW, chartDrawH);
    ctx.drawImage(
      legendCanvas,
      rightX,
      contentY + chartDrawH + rowGap,
      legendCanvas.width,
      legendCanvas.height,
    );
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png');
  });

  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sanitizeFilename(filename)}.png`;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Rasterize the trend chart SVG plus a percentile legend table and trigger a PNG download. */
export async function downloadTrendChartPng(options: {
  chartRoot: HTMLElement;
  metricLabel: string;
  legendRows: TrendLegendRow[];
  hasL21: boolean;
  hasL14: boolean;
}): Promise<void> {
  const { chartRoot, metricLabel, legendRows, hasL21, hasL14 } = options;
  const svg = findChartSvg(chartRoot);
  const { width: rasterW, height: rasterH } = resolveSvgRasterSize(svg);
  const chartDrawW = Math.round(rasterW * CHART_EXPORT_BOOST);
  const chartDrawH = Math.round(rasterH * CHART_EXPORT_BOOST);

  const pad = 32;
  const titleH = 40;
  const subtitleH = 22;
  const gap = 20;

  const [chartImg, headshots] = await Promise.all([svgToImage(svg), loadHeadshots(legendRows)]);
  const legendCanvas = renderLegendCanvas(legendRows, metricLabel, hasL21, hasL14, headshots);
  const legendDrawW = legendCanvas.width;
  const legendDrawH = legendCanvas.height;

  const contentW = chartDrawW + gap + legendDrawW;
  const contentH = Math.max(chartDrawH, legendDrawH);
  const canvasW = pad * 2 + contentW;
  const canvasH = pad + titleH + subtitleH + contentH + pad;
  const canvas = document.createElement('canvas');
  canvas.width = canvasW * OUTPUT_SCALE;
  canvas.height = canvasH * OUTPUT_SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');

  ctx.scale(OUTPUT_SCALE, OUTPUT_SCALE);
  ctx.fillStyle = CHART_THEME.panel;
  ctx.fillRect(0, 0, canvasW, canvasH);

  ctx.fillStyle = CHART_THEME.text;
  ctx.font = '700 20px system-ui, sans-serif';
  ctx.fillText(`${metricLabel} recent form`, pad, pad + 6);

  ctx.fillStyle = CHART_THEME.muted;
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillText(
    'Percentile among rostered pool; dashed line = season baseline',
    pad,
    pad + titleH - 6,
  );

  const contentY = pad + titleH + subtitleH;
  drawRasterizedChart(ctx, chartImg, pad, contentY, chartDrawW, chartDrawH);
  ctx.drawImage(legendCanvas, pad + chartDrawW + gap, contentY, legendDrawW, legendDrawH);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png');
  });

  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sanitizeFilename(metricLabel)}-recent-form.png`;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
