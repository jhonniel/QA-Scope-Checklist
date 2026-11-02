import { useMemo } from "react";
import { RESOLVED_TASK_STATUSES, TASK_STATUSES, type Task, type TaskStatus } from "@scope/contracts";
import { TASK_STATUS_META } from "@/lib/taskStatus";

interface Slice {
  status: TaskStatus;
  count: number;
  percent: number;
}

/**
 * Mirrors the "Progress" block the API renders into the DOCX: a pie of the
 * exported tasks by status (clockwise from 12 o'clock, largest first, same
 * colours as the status dots) with a legend of label, count and share.
 */
export function ProgressChartPreview({ tasks }: { tasks: Pick<Task, "status">[] }) {
  const { total, resolved, percent, slices } = useMemo(() => summarise(tasks), [tasks]);
  if (total === 0) return null;

  return (
    <section className="mt-6" aria-label="Progress">
      <h2 className="text-[13px] font-semibold">Progress</h2>
      <p className="mt-0.5 text-[12px]">
        <span className="font-semibold">{percent}% complete</span>
        <span className="text-ink-muted">
          {" "}
          · {resolved} resolved of {total} items
        </span>
      </p>
      <div className="mt-3 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
        <svg viewBox="-1 -1 2 2" className="size-32 shrink-0 -rotate-90" role="img" aria-label={slices.map((s) => `${TASK_STATUS_META[s.status].label} ${s.count} (${formatPercent(s.percent)})`).join(", ")}>
          {slices.length === 1 ? (
            <circle r="1" cx="0" cy="0" fill={TASK_STATUS_META[slices[0].status].color} />
          ) : (
            arcs(slices).map((a) => <path key={a.status} d={a.d} fill={TASK_STATUS_META[a.status].color} />)
          )}
        </svg>
        <table className="text-[11px] leading-5" aria-label="Status breakdown">
          <tbody>
            {slices.map((s) => (
              <tr key={s.status}>
                <td className="pr-2">
                  <span className="block size-2.5 rounded-[2px]" style={{ backgroundColor: TASK_STATUS_META[s.status].color }} aria-hidden />
                </td>
                <td className="pr-6">{TASK_STATUS_META[s.status].label}</td>
                <td className="pr-4 text-right font-semibold tabular-nums">{s.count}</td>
                <td className="text-right text-ink-muted tabular-nums">{formatPercent(s.percent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  const slices: Slice[] = TASK_STATUSES.filter((s) => (counts.get(s) ?? 0) > 0)
    .map((status) => ({ status, count: counts.get(status) ?? 0, percent: Math.round(((counts.get(status) ?? 0) / total) * 1000) / 10 }))
    .sort((a, b) => b.count - a.count || TASK_STATUSES.indexOf(a.status) - TASK_STATUSES.indexOf(b.status));
  return { total, resolved, percent: total === 0 ? 0 : Math.round((resolved / total) * 100), slices };
}

/** Pie wedges on the unit circle; the SVG is rotated -90° so the first wedge starts at 12 o'clock. */
function arcs(slices: Slice[]): { status: TaskStatus; d: string }[] {
  const total = slices.reduce((sum, s) => sum + s.count, 0);
  let start = 0;
  return slices.map((s) => {
    const end = start + (s.count / total) * Math.PI * 2;
    const large = end - start > Math.PI ? 1 : 0;
    const d = `M 0 0 L ${Math.cos(start)} ${Math.sin(start)} A 1 1 0 ${large} 1 ${Math.cos(end)} ${Math.sin(end)} Z`;
    start = end;
    return { status: s.status, d };
  });
}

function formatPercent(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}
