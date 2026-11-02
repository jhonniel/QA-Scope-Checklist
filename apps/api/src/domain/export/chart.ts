import { deflateSync } from "node:zlib";
import { RESOLVED_TASK_STATUSES, TASK_STATUSES, type TaskStatus } from "@scope/contracts";
import type { ChecklistDocument } from "./document.ts";

/**
 * Progress chart for exported documents.
 *
 * `statusBreakdown` turns the document's items into ordered slices; `renderPieChartPng`
 * rasterises them into a PNG with nothing but `node:zlib` — no native canvas or
 * headless browser, so the API keeps running anywhere Node runs. Labels are not
 * drawn into the bitmap (that would need a font rasteriser); the generator prints
 * them as a real-text legend next to the image, which also stays searchable and
 * editable in Word.
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
  /** Statuses that occur at least once, largest first (ties keep the contract order). */
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
  const slices = TASK_STATUSES.filter((status) => (counts.get(status) ?? 0) > 0)
    .map((status) => {
      const count = counts.get(status) ?? 0;
      return { status, count, percent: total === 0 ? 0 : Math.round((count / total) * 1000) / 10 };
    })
    .sort((a, b) => b.count - a.count || TASK_STATUSES.indexOf(a.status) - TASK_STATUSES.indexOf(b.status));
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

/**
 * Draw slices clockwise from 12 o'clock into a square RGBA PNG. Edges are
 * anti-aliased by super-sampling only the pixels that straddle a boundary.
 */
export function renderPieChartPng(slices: PieSlice[], options: PieChartOptions = {}): Buffer {
  const size = Math.max(16, Math.floor(options.size ?? 480));
  const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  if (total <= 0) throw new Error("A pie chart needs at least one slice with a positive value.");

  const colors = slices.map((s) => hexToRgb(s.color));
  const background = options.background ? hexToRgb(options.background) : null;
  // Cumulative end angle of every slice as a fraction of the full turn.
  const ends: number[] = [];
  let acc = 0;
  for (const s of slices) {
    acc += Math.max(0, s.value) / total;
    ends.push(acc);
  }
  ends[ends.length - 1] = 1; // absorb floating-point drift

  const centre = size / 2;
  const radius = size / 2 - 1;
  const radiusSq = radius * radius;

  /** Index of the slice under a point, or -1 outside the circle. */
  const sliceAt = (x: number, y: number): number => {
    const dx = x - centre;
    const dy = y - centre;
    if (dx * dx + dy * dy > radiusSq) return -1;
    // 0 at 12 o'clock, increasing clockwise.
    let turn = Math.atan2(dx, -dy) / (2 * Math.PI);
    if (turn < 0) turn += 1;
    for (let i = 0; i < ends.length; i += 1) if (turn < ends[i]) return i;
    return ends.length - 1;
  };

  const rgba = Buffer.alloc(size * size * 4);
  const SUB = 4; // 4×4 sub-samples on edge pixels
  const put = (offset: number, r: number, g: number, b: number, a: number) => {
    rgba[offset] = r;
    rgba[offset + 1] = g;
    rgba[offset + 2] = b;
    rgba[offset + 3] = a;
  };
  const colourOf = (index: number) => (index >= 0 ? colors[index] : background);

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
      // Edge pixel: average the sub-samples (premultiplied, then un-premultiplied).
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
  return encodePng(size, size, rgba);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace(/^#/, "");
  const value = /^[0-9a-f]{6}$/i.test(clean) ? parseInt(clean, 16) : 0x808080;
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // no interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type "None" for this scanline
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
