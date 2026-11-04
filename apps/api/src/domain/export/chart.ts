import { deflateSync } from "node:zlib";
import { RESOLVED_TASK_STATUSES, TASK_STATUSES, type TaskStatus } from "@scope/contracts";
import type { ChecklistDocument } from "./document.ts";

/**
 * Progress chart for exported documents.
 *
 * `statusBreakdown` turns the document's items into ordered slices; `renderPieChartPng`
 * rasterises the pie; `renderLabeledPieChartPng` draws the Excel-style chart
 * (callout labels and leader lines) that Word embeds. Rasterising uses only
 * `node:zlib` — no native canvas or headless browser.
 */

export interface StatusSlice {
  status: TaskStatus;
  count: number;
  /** Share of all items, 0–100 with one decimal. */
  percent: number;
}

export interface ProgressSummary {
  total: number;
  resolved: number;
  /** Whole-number percentage, the same rounding as the web app's progress bars. */
  percent: number;
  /** Statuses that occur at least once, in contract order (same as Excel category order). */
  slices: StatusSlice[];
}

/** Count items per status across every section included in the document. */
export function statusBreakdown(doc: Pick<ChecklistDocument, "sections">): ProgressSummary {
  const counts = new Map<TaskStatus, number>();
  let total = 0;
  let resolved = 0;
  for (const section of doc.sections) {
    for (const item of section.items) {
      total += 1;
      counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
      if (RESOLVED_TASK_STATUSES.includes(item.status)) resolved += 1;
    }
  }
  const slices = TASK_STATUSES.filter((status) => (counts.get(status) ?? 0) > 0).map((status) => {
    const count = counts.get(status) ?? 0;
    return { status, count, percent: total === 0 ? 0 : Math.round((count / total) * 1000) / 10 };
  });
  return { total, resolved, percent: total === 0 ? 0 : Math.round((resolved / total) * 100), slices };
}

export interface PieSlice {
  value: number;
  /** Hex colour without `#`. */
  color: string;
}

export interface PieChartOptions {
  /** Width and height in pixels (square). */
  size?: number;
  /** Hex colour without `#`, or null for a transparent background. */
  background?: string | null;
}

export interface LabeledPieSlice extends PieSlice {
  label: string;
  percent: number;
}

export interface LabeledPieChartOptions {
  /** Diameter of the pie in pixels. */
  pieSize?: number;
  /** Hex colour without `#`. */
  background?: string;
}

/** A PNG plus the pixel size so Word can keep the aspect ratio. */
export interface LabeledPieChartPng {
  png: Buffer;
  width: number;
  height: number;
  pieSize: number;
}

/**
 * Draw slices clockwise from 12 o'clock into a square RGBA PNG. Edges are
 * anti-aliased by super-sampling only the pixels that straddle a boundary.
 */
export function renderPieChartPng(slices: PieSlice[], options: PieChartOptions = {}): Buffer {
  const size = Math.max(16, Math.floor(options.size ?? 480));
  const { rgba } = rasterizePie(slices, size, options.background ?? null);
  return encodePng(size, size, rgba);
}

/**
 * Excel-style pie: slices clockwise from 12 o'clock in contract order, with
 * callout labels (name + percent) and leader lines outside the circle.
 */
export function renderLabeledPieChartPng(slices: LabeledPieSlice[], options: LabeledPieChartOptions = {}): LabeledPieChartPng {
  const pieSize = Math.max(64, Math.floor(options.pieSize ?? 480));
  const background = options.background ?? "FFFFFF";
  const visible = slices.filter((s) => s.value > 0);
  if (visible.length === 0) throw new Error("A pie chart needs at least one slice with a positive value.");

  const fontScale = pieSize >= 360 ? 2 : 1;
  const glyphW = 5 * fontScale;
  const glyphH = 7 * fontScale;
  const glyphGap = fontScale;
  const lineGap = 3 * fontScale;
  const labelGap = 10 * fontScale;
  const stub = Math.max(10, Math.round(pieSize * 0.04));
  const pad = Math.max(16, Math.round(pieSize * 0.06));
  const longest = visible.reduce((n, s) => Math.max(n, textWidth(s.label, glyphW, glyphGap), textWidth(formatPercent(s.percent), glyphW, glyphGap)), 0);
  const labelCol = longest + stub + 16;
  const labelBlock = glyphH * 2 + lineGap;
  const width = pieSize + labelCol * 2 + pad * 2;
  const minHeight = pieSize + pad * 2;
  const stacked = visible.length * (labelBlock + labelGap) - labelGap + pad * 2;
  const height = Math.max(minHeight, stacked);

  const cx = width / 2;
  const cy = height / 2;
  const radius = pieSize / 2 - 1;
  const { rgba: pie } = rasterizePie(visible, pieSize, background);
  const canvas = Buffer.alloc(width * height * 4);
  const bg = hexToRgb(background);
  fillRgba(canvas, bg);
  blit(canvas, width, pie, pieSize, Math.round(cx - pieSize / 2), Math.round(cy - pieSize / 2));

  const ink = hexToRgb("1B1B1F");
  const leader = hexToRgb("6B6C74");
  const placements = placeLabels(visible, cx, cy, radius, stub, labelBlock, labelGap, pad, height);

  for (const p of placements) {
    const slice = visible[p.index];
    drawLine(canvas, width, height, p.edgeX, p.edgeY, p.elbowX, p.elbowY, leader);
    drawLine(canvas, width, height, p.elbowX, p.elbowY, p.lineEndX, p.elbowY, leader);
    fillCircle(canvas, width, height, p.edgeX, p.edgeY, Math.max(2, fontScale + 1), leader);
    const textX = p.side === "left" ? p.lineEndX - textWidth(slice.label, glyphW, glyphGap) : p.lineEndX;
    const percent = formatPercent(slice.percent);
    const percentX = p.side === "left" ? p.lineEndX - textWidth(percent, glyphW, glyphGap) : p.lineEndX;
    drawText(canvas, width, height, slice.label, textX, p.textY, ink, fontScale);
    drawText(canvas, width, height, percent, percentX, p.textY + glyphH + lineGap, ink, fontScale);
  }

  return { png: encodePng(width, height, canvas), width, height, pieSize };
}

export function formatPercent(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

interface LabelPlacement {
  index: number;
  side: "left" | "right";
  edgeX: number;
  edgeY: number;
  elbowX: number;
  elbowY: number;
  lineEndX: number;
  textY: number;
}

/** 0 at 12 o'clock, increasing clockwise — same convention as the pie rasteriser. */
function pointOnCircle(cx: number, cy: number, radius: number, turn: number): { x: number; y: number } {
  const a = turn * Math.PI * 2;
  return { x: cx + Math.sin(a) * radius, y: cy - Math.cos(a) * radius };
}

function placeLabels(
  slices: LabeledPieSlice[],
  cx: number,
  cy: number,
  radius: number,
  stub: number,
  labelBlock: number,
  labelGap: number,
  pad: number,
  height: number,
): LabelPlacement[] {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  let acc = 0;
  const raw = slices.map((s, index) => {
    const start = acc;
    acc += s.value / total;
    const mid = start + (acc - start) / 2;
    const edge = pointOnCircle(cx, cy, radius, mid);
    const elbow = pointOnCircle(cx, cy, radius + stub, mid);
    const side: "left" | "right" = mid < 0.5 ? "right" : "left";
    return { index, side, mid, edge, elbow, preferredY: elbow.y - labelBlock / 2 };
  });

  const placeSide = (side: "left" | "right") => {
    const group = raw.filter((p) => p.side === side).sort((a, b) => a.preferredY - b.preferredY || a.mid - b.mid);
    let y = pad;
    const ys: number[] = [];
    for (const p of group) {
      const next = Math.max(y, p.preferredY);
      ys.push(next);
      y = next + labelBlock + labelGap;
    }
    const overflow = y - labelGap + pad - height;
    const shift = overflow > 0 ? overflow : 0;
    return group.map((p, i) => ({ ...p, textY: ys[i] - shift }));
  };

  return [...placeSide("left"), ...placeSide("right")].map((p) => {
    const lineEndX = p.side === "left" ? Math.min(p.elbow.x, cx - radius - stub - 8) : Math.max(p.elbow.x, cx + radius + stub + 8);
    const elbowY = p.textY + labelBlock / 2;
    return {
      index: p.index,
      side: p.side,
      edgeX: p.edge.x,
      edgeY: p.edge.y,
      elbowX: p.elbow.x,
      elbowY,
      lineEndX,
      textY: p.textY,
    };
  });
}

function rasterizePie(slices: PieSlice[], size: number, background: string | null): { rgba: Buffer; size: number } {
  const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  if (total <= 0) throw new Error("A pie chart needs at least one slice with a positive value.");

  const colors = slices.map((s) => hexToRgb(s.color));
  const bg = background ? hexToRgb(background) : null;
  const ends: number[] = [];
  let acc = 0;
  for (const s of slices) {
    acc += Math.max(0, s.value) / total;
    ends.push(acc);
  }
  ends[ends.length - 1] = 1;

  const centre = size / 2;
  const radius = size / 2 - 1;
  const radiusSq = radius * radius;

  const sliceAt = (x: number, y: number): number => {
    const dx = x - centre;
    const dy = y - centre;
    if (dx * dx + dy * dy > radiusSq) return -1;
    let turn = Math.atan2(dx, -dy) / (2 * Math.PI);
    if (turn < 0) turn += 1;
    for (let i = 0; i < ends.length; i += 1) if (turn < ends[i]) return i;
    return ends.length - 1;
  };

  const rgba = Buffer.alloc(size * size * 4);
  const SUB = 4;
  const put = (offset: number, r: number, g: number, b: number, a: number) => {
    rgba[offset] = r;
    rgba[offset + 1] = g;
    rgba[offset + 2] = b;
    rgba[offset + 3] = a;
  };
  const colourOf = (index: number) => (index >= 0 ? colors[index] : bg);

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const offset = (py * size + px) * 4;
      const corners = [sliceAt(px, py), sliceAt(px + 1, py), sliceAt(px, py + 1), sliceAt(px + 1, py + 1)];
      if (corners.every((c) => c === corners[0])) {
        const c = colourOf(corners[0]);
        if (c) put(offset, c.r, c.g, c.b, 255);
        else put(offset, 0, 0, 0, 0);
        continue;
      }
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SUB; sy += 1) {
        for (let sx = 0; sx < SUB; sx += 1) {
          const c = colourOf(sliceAt(px + (sx + 0.5) / SUB, py + (sy + 0.5) / SUB));
          if (!c) continue;
          r += c.r;
          g += c.g;
          b += c.b;
          a += 1;
        }
      }
      if (a === 0) put(offset, 0, 0, 0, 0);
      else put(offset, Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round((a / (SUB * SUB)) * 255));
    }
  }
  return { rgba, size };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace(/^#/, "");
  const value = /^[0-9a-f]{6}$/i.test(clean) ? parseInt(clean, 16) : 0x808080;
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function fillRgba(rgba: Buffer, color: { r: number; g: number; b: number }): void {
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = color.r;
    rgba[i + 1] = color.g;
    rgba[i + 2] = color.b;
    rgba[i + 3] = 255;
  }
}

function blit(dest: Buffer, destW: number, src: Buffer, srcSize: number, dx: number, dy: number): void {
  for (let y = 0; y < srcSize; y += 1) {
    const ty = dy + y;
    if (ty < 0) continue;
    const destH = dest.length / (destW * 4);
    if (ty >= destH) break;
    for (let x = 0; x < srcSize; x += 1) {
      const tx = dx + x;
      if (tx < 0 || tx >= destW) continue;
      const si = (y * srcSize + x) * 4;
      const a = src[si + 3];
      if (a === 0) continue;
      const di = (ty * destW + tx) * 4;
      if (a === 255) {
        dest[di] = src[si];
        dest[di + 1] = src[si + 1];
        dest[di + 2] = src[si + 2];
        dest[di + 3] = 255;
        continue;
      }
      const t = a / 255;
      dest[di] = Math.round(src[si] * t + dest[di] * (1 - t));
      dest[di + 1] = Math.round(src[si + 1] * t + dest[di + 1] * (1 - t));
      dest[di + 2] = Math.round(src[si + 2] * t + dest[di + 2] * (1 - t));
      dest[di + 3] = 255;
    }
  }
}

function plot(rgba: Buffer, width: number, height: number, x: number, y: number, color: { r: number; g: number; b: number }): void {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= width || py >= height) return;
  const i = (py * width + px) * 4;
  rgba[i] = color.r;
  rgba[i + 1] = color.g;
  rgba[i + 2] = color.b;
  rgba[i + 3] = 255;
}

function drawLine(rgba: Buffer, width: number, height: number, x0: number, y0: number, x1: number, y1: number, color: { r: number; g: number; b: number }): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    plot(rgba, width, height, x0 + dx * t, y0 + dy * t, color);
  }
}

function fillCircle(rgba: Buffer, width: number, height: number, cx: number, cy: number, radius: number, color: { r: number; g: number; b: number }): void {
  const r = Math.ceil(radius);
  const rSq = radius * radius;
  for (let y = -r; y <= r; y += 1) {
    for (let x = -r; x <= r; x += 1) {
      if (x * x + y * y <= rSq) plot(rgba, width, height, cx + x, cy + y, color);
    }
  }
}

function textWidth(text: string, glyphW: number, gap: number): number {
  const n = [...text].length;
  return n === 0 ? 0 : n * glyphW + (n - 1) * gap;
}

function drawText(rgba: Buffer, width: number, height: number, text: string, x: number, y: number, color: { r: number; g: number; b: number }, scale: number): void {
  let cursor = Math.round(x);
  const top = Math.round(y);
  for (const char of text) {
    const rows = glyph(char);
    for (let row = 0; row < 7; row += 1) {
      const bits = rows[row];
      for (let col = 0; col < 5; col += 1) {
        if (((bits >> (4 - col)) & 1) === 0) continue;
        for (let sy = 0; sy < scale; sy += 1) {
          for (let sx = 0; sx < scale; sx += 1) {
            plot(rgba, width, height, cursor + col * scale + sx, top + row * scale + sy, color);
          }
        }
      }
    }
    cursor += 5 * scale + scale;
  }
}

/** 5×7 glyphs as 7 row bitmasks (5 bits). Unknown characters fall back to a box. */
function glyph(char: string): number[] {
  return GLYPHS[char] ?? [0b11111, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11111];
}

const GLYPHS: Record<string, number[]> = {
  " ": [0, 0, 0, 0, 0, 0, 0],
  "%": [0b11001, 0b11010, 0b00100, 0b01000, 0b10110, 0b00110, 0],
  "(": [0b00100, 0b01000, 0b01000, 0b01000, 0b01000, 0b01000, 0b00100],
  ")": [0b01000, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01000],
  "-": [0, 0, 0, 0b11111, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 0b01100, 0b01100],
  "/": [0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0, 0],
  "0": [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  "1": [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  "2": [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  "3": [0b01110, 0b10001, 0b00001, 0b00110, 0b00001, 0b10001, 0b01110],
  "4": [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  "5": [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  "6": [0b01110, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b01110],
  "7": [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  "8": [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  "9": [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00001, 0b01110],
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01110],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01110, 0b10001, 0b10000, 0b01110, 0b00001, 0b10001, 0b01110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
  a: [0, 0, 0b01110, 0b00001, 0b01111, 0b10001, 0b01111],
  b: [0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b11110],
  c: [0, 0, 0b01110, 0b10000, 0b10000, 0b10001, 0b01110],
  d: [0b00001, 0b00001, 0b01111, 0b10001, 0b10001, 0b10001, 0b01111],
  e: [0, 0, 0b01110, 0b10001, 0b11111, 0b10000, 0b01110],
  f: [0b00110, 0b01000, 0b11100, 0b01000, 0b01000, 0b01000, 0b01000],
  g: [0, 0, 0b01111, 0b10001, 0b01111, 0b00001, 0b01110],
  h: [0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b10001],
  i: [0b00100, 0, 0b01100, 0b00100, 0b00100, 0b00100, 0b01110],
  j: [0b00010, 0, 0b00110, 0b00010, 0b00010, 0b10010, 0b01100],
  k: [0b10000, 0b10000, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010],
  l: [0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  m: [0, 0, 0b11010, 0b10101, 0b10101, 0b10101, 0b10101],
  n: [0, 0, 0b11110, 0b10001, 0b10001, 0b10001, 0b10001],
  o: [0, 0, 0b01110, 0b10001, 0b10001, 0b10001, 0b01110],
  p: [0, 0, 0b11110, 0b10001, 0b11110, 0b10000, 0b10000],
  q: [0, 0, 0b01111, 0b10001, 0b01111, 0b00001, 0b00001],
  r: [0, 0, 0b10110, 0b11000, 0b10000, 0b10000, 0b10000],
  s: [0, 0, 0b01111, 0b10000, 0b01110, 0b00001, 0b11110],
  t: [0b01000, 0b01000, 0b11100, 0b01000, 0b01000, 0b01001, 0b00110],
  u: [0, 0, 0b10001, 0b10001, 0b10001, 0b10011, 0b01101],
  v: [0, 0, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  w: [0, 0, 0b10001, 0b10001, 0b10101, 0b10101, 0b01010],
  x: [0, 0, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001],
  y: [0, 0, 0b10001, 0b10001, 0b01111, 0b00001, 0b01110],
  z: [0, 0, 0b11111, 0b00010, 0b00100, 0b01000, 0b11111],
};

// ---- minimal PNG encoder (8-bit RGBA, no filtering) -----------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(...parts: Buffer[]): number {
  let crc = 0xffffffff;
  for (const part of parts) for (let i = 0; i < part.length; i += 1) crc = CRC_TABLE[(crc ^ part[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typeBytes = Buffer.from(type, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeBytes, body));
  return Buffer.concat([length, typeBytes, body, crc]);
}

export function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  if (rgba.length !== width * height * 4) throw new Error("RGBA buffer does not match the image dimensions.");
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
