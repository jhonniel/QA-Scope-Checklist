import { useEffect, useState } from "react";

export interface VisualViewportState {
  /** Height of the visible area (shrinks when the mobile keyboard opens). */
  height: number;
  /** Distance the visual viewport is offset from the layout viewport top. */
  offsetTop: number;
  /** Space hidden at the bottom of the layout viewport (keyboard height). */
  bottomInset: number;
}

function read(): VisualViewportState {
  if (typeof window === "undefined") return { height: 0, offsetTop: 0, bottomInset: 0 };
  const vv = window.visualViewport;
  if (!vv) return { height: window.innerHeight, offsetTop: 0, bottomInset: 0 };
  const bottomInset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  return { height: vv.height, offsetTop: vv.offsetTop, bottomInset };
}

/**
 * Tracks the visual viewport so fixed-position sheets can stay above the
 * on-screen keyboard on iOS/Android, where the layout viewport does not shrink.
 */
export function useVisualViewport(enabled = true): VisualViewportState {
  const [state, setState] = useState<VisualViewportState>(read);

  useEffect(() => {
    if (!enabled) return;
    const vv = window.visualViewport;
    const update = () => setState(read());
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [enabled]);

  return state;
}

let lockCount = 0;
let previousOverflow = "";

/** Prevent background scrolling while an overlay is open (ref-counted). */
export function useLockBodyScroll(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    if (lockCount === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    lockCount += 1;
    return () => {
      lockCount -= 1;
      if (lockCount === 0) document.body.style.overflow = previousOverflow;
    };
  }, [locked]);
}
