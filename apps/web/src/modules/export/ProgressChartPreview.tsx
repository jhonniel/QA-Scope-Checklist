import { useMemo } from "react";
import { RESOLVED_TASK_STATUSES, TASK_STATUSES, type Task, type TaskStatus } from "@scope/contracts";
import { TASK_STATUS_META } from "@/lib/taskStatus";

interface Slice {
  status: TaskStatus;
  count: number;
  percent: number;
}

const VIEW_W = 640;
const VIEW_H = 360;
const CX = VIEW_W / 2;
const CY = VIEW_H / 2;
const RADIUS = 118;
const STUB = 14;
const LABEL_BLOCK = 32;
const LABEL_GAP = 10;
const PAD = 18;

/**
 * Excel-style progress pie: slices clockwise from 12 o'clock in contract
 * order, with callout labels (name + percent) and leader lines. Mirrors the
 * PNG the API embeds in the DOCX.
 */
export function ProgressChartPreview({ tasks, title = "Progress" }: { tasks: Pick<Task, "status">[]; title?: string }) {
  const { total, resolved, percent, slices } = useMemo(() => summarise(tasks), [tasks]);
  const labels = useMemo(() => placeLabels(slices), [slices]);
  if (total === 0) return null;

  return (
    <section className="mt-6" aria-label={title}>
      <h2 className="text-[13px] font-semibold">{title}</h2>
      <p className="mt-0.5 text-[12px]">
        <span className="font-semibold">{percent}% complete</span>
        <span className="text-ink-muted">
          {" "}
          · {resolved} resolved of {total} items
        </span>
      </p>
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="mx-auto mt-2 w-full max-w-[32rem]" role="img" aria-label={slices.map((s) => `${TASK_STATUS_META[s.status].label} ${formatPercent(s.percent)}`).join(", ")}>
        {slices.length === 1 ? (
          <circle cx={CX} cy={CY} r={RADIUS} fill={TASK_STATUS_META[slices[0].status].color} />
        ) : (
          arcs(slices).map((a) => <path key={a.status} d={a.d} fill={TASK_STATUS_META[a.status].color} />)
        )}
        {labels.map((p) => {
          const slice = slices[p.index];
          const meta = TASK_STATUS_META[slice.status];
          const anchor = p.side === "left" ? "end" : "start";
          return (
            <g key={slice.status}>
              <polyline points={`${p.edgeX},${p.edgeY} ${p.elbowX},${p.elbowY} ${p.lineEndX},${p.elbowY}`} fill="none" stroke="#6b6c74" strokeWidth="1" />
              <circle cx={p.edgeX} cy={p.edgeY} r="2.5" fill="#6b6c74" />
              <text x={p.lineEndX} y={p.textY + 11} textAnchor={anchor} fill="#1b1b1f" fontSize="12" fontWeight={500}>
                {meta.label}
              </text>
              <text x={p.lineEndX} y={p.textY + 26} textAnchor={anchor} fill="#1b1b1f" fontSize="12">
                {formatPercent(slice.percent)}
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}

function summarise(tasks: Pick<Task, "status">[]) {
  const counts = new Map<TaskStatus, number>();
  let resolved = 0;
  for (const t of tasks) {
    counts.set(t.status, (counts.get(t.status) ?? 0) + 1);
    if (RESOLVED_TASK_STATUSES.includes(t.status)) resolved += 1;
  }
  const total = tasks.length;
  const slices: Slice[] = TASK_STATUSES.filter((s) => (counts.get(s) ?? 0) > 0).map((status) => ({
    status,
    count: counts.get(status) ?? 0,
    percent: Math.round(((counts.get(status) ?? 0) / total) * 1000) / 10,
  }));
  return { total, resolved, percent: total === 0 ? 0 : Math.round((resolved / total) * 100), slices };
}

/** Pie wedges on the document canvas; 0 at 12 o'clock, clockwise. */
function arcs(slices: Slice[]): { status: TaskStatus; d: string }[] {
  const total = slices.reduce((sum, s) => sum + s.count, 0);
  let start = 0;
  return slices.map((s) => {
    const sweep = (s.count / total) * Math.PI * 2;
    const end = start + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const x0 = CX + Math.sin(start) * RADIUS;
    const y0 = CY - Math.cos(start) * RADIUS;
    const x1 = CX + Math.sin(end) * RADIUS;
    const y1 = CY - Math.cos(end) * RADIUS;
    const d = `M ${CX} ${CY} L ${x0} ${y0} A ${RADIUS} ${RADIUS} 0 ${large} 1 ${x1} ${y1} Z`;
    start = end;
    return { status: s.status, d };
  });
}

function pointOnCircle(radius: number, turn: number): { x: number; y: number } {
  const a = turn * Math.PI * 2;
  return { x: CX + Math.sin(a) * radius, y: CY - Math.cos(a) * radius };
}

function placeLabels(slices: Slice[]) {
  const total = slices.reduce((sum, s) => sum + s.count, 0);
  if (total === 0) return [];
  let acc = 0;
  const raw = slices.map((s, index) => {
    const start = acc;
    acc += s.count / total;
    const mid = start + (acc - start) / 2;
    const edge = pointOnCircle(RADIUS, mid);
    const elbow = pointOnCircle(RADIUS + STUB, mid);
    const side: "left" | "right" = mid < 0.5 ? "right" : "left";
    return { index, side, mid, edge, elbow, preferredY: elbow.y - LABEL_BLOCK / 2 };
  });

  const placeSide = (side: "left" | "right") => {
    const group = raw.filter((p) => p.side === side).sort((a, b) => a.preferredY - b.preferredY || a.mid - b.mid);
    let y = PAD;
    const ys: number[] = [];
    for (const p of group) {
      const next = Math.max(y, p.preferredY);
      ys.push(next);
      y = next + LABEL_BLOCK + LABEL_GAP;
    }
    const overflow = y - LABEL_GAP + PAD - VIEW_H;
    const shift = overflow > 0 ? overflow : 0;
    return group.map((p, i) => ({ ...p, textY: ys[i] - shift }));
  };

  return [...placeSide("left"), ...placeSide("right")].map((p) => ({
    index: p.index,
    side: p.side,
    edgeX: p.edge.x,
    edgeY: p.edge.y,
    elbowX: p.elbow.x,
    elbowY: p.textY + LABEL_BLOCK / 2,
    lineEndX: p.side === "left" ? Math.min(p.elbow.x, CX - RADIUS - STUB - 8) : Math.max(p.elbow.x, CX + RADIUS + STUB + 8),
    textY: p.textY,
  }));
}

function formatPercent(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}
