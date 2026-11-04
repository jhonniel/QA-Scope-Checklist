/** Height for an auto-growing textarea: at least `minPx`, at most `maxPx`. */
export function clampTextareaHeight(scrollHeight: number, minPx: number, maxPx: number): number {
  const min = Math.max(0, minPx);
  const max = Math.max(min, maxPx);
  if (!Number.isFinite(scrollHeight)) return min;
  return Math.min(max, Math.max(min, scrollHeight));
}
