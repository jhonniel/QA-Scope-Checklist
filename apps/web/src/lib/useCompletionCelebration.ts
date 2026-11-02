import { useEffect, useRef, useState } from "react";

/**
 * Returns a counter that increments the moment `percent` reaches 100 from a
 * lower value while the user is looking at the same subject (`key`, e.g. a
 * project uuid). Opening something that is already complete does not fire,
 * and switching subject resets the baseline. Feed the counter to
 * `<ConfettiBurst fire={…} />`.
 */
export function useCompletionCelebration(percent: number | undefined, key: string): number {
  const [bursts, setBursts] = useState(0);
  const previous = useRef<{ key: string; percent: number | undefined }>({ key, percent: undefined });

  useEffect(() => {
    if (previous.current.key !== key) {
      previous.current = { key, percent };
      return;
    }
    const before = previous.current.percent;
    previous.current.percent = percent;
    if (before !== undefined && before < 100 && percent === 100) setBursts((n) => n + 1);
  }, [percent, key]);

  return bursts;
}

/** Pure form of the trigger rule, kept separate so it can be unit tested. */
export function shouldCelebrate(before: number | undefined, after: number | undefined): boolean {
  return before !== undefined && before < 100 && after === 100;
}
