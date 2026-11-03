import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, animate, motion, useDragControls, useMotionValue, useReducedMotion, type PanInfo } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { transitions } from "@/lib/motion";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { useLockBodyScroll, useVisualViewport } from "@/lib/useVisualViewport";

export type SheetDesktopVariant = "panel" | "dialog" | "sheet";

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * Fractions of the viewport height the sheet can rest at, ascending.
   * Default is a single near-full snap. Example: `[0.55, 0.94]`.
   */
  snapPoints?: number[];
  /** Index into `snapPoints` to open at. Defaults to the first (smallest). */
  initialSnap?: number;
  /** How the same sheet renders on desktop (`lg` and up). */
  desktop?: SheetDesktopVariant;
  /** Width class for the desktop panel / dialog. */
  desktopWidthClassName?: string;
  /** Extra classes on the scrollable content area. */
  contentClassName?: string;
  /** Hide the header close button. */
  hideClose?: boolean;
  /** Actions rendered in the header, before the close button. */
  headerActions?: ReactNode;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * BottomSheet — the primary secondary-surface pattern.
 *
 * Mobile: rises from the bottom with a grabber, rounded top corners, dimmed
 * backdrop, drag-to-dismiss and snap points. Stays above the on-screen
 * keyboard. Desktop: renders as a side panel (default), a centered dialog,
 * or keeps the sheet form.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  snapPoints = [0.94],
  initialSnap = 0,
  desktop = "panel",
  desktopWidthClassName,
  contentClassName,
  hideClose,
  headerActions,
}: BottomSheetProps) {
  const isDesktop = useIsDesktop();
  const reduceMotion = useReducedMotion();
  const variant: SheetDesktopVariant = isDesktop ? desktop : "sheet";
  const titleId = useId();
  const descId = useId();

  useLockBodyScroll(open);

  // Escape to close + focus restore.
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      const first = containerRef.current?.querySelector<HTMLElement>("[data-autofocus]") ?? containerRef.current;
      first?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      restoreFocusRef.current?.focus?.({ preventScroll: true });
    };
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === "Tab" && containerRef.current) {
      const nodes = Array.from(containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const header = (title || !hideClose || headerActions) && (
    <div className="flex items-start gap-3 px-5 pt-1 pb-3 lg:pt-5">
      <div className="min-w-0 flex-1">
        {title && (
          <h2 id={titleId} className="text-base font-semibold text-ink leading-6">
            {title}
          </h2>
        )}
        {description && (
          <p id={descId} className="mt-0.5 text-sm text-ink-muted">
            {description}
          </p>
        )}
      </div>
      {headerActions}
      {!hideClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mt-1 -mr-2 flex size-9 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-surface-muted hover:text-ink"
        >
          <X className="size-5" aria-hidden />
        </button>
      )}
    </div>
  );

  const body = (
    <>
      <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 scrollbar-thin", !header && "pt-2 lg:pt-5", contentClassName)} data-sheet-content>
        {children}
      </div>
      {footer && (
        <div className="shrink-0 border-t border-line bg-surface px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] lg:pb-5">
          {footer}
        </div>
      )}
    </>
  );

  const aria = {
    role: "dialog" as const,
    "aria-modal": true,
    "aria-labelledby": title ? titleId : undefined,
    "aria-describedby": description ? descId : undefined,
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div key="sheet-root" className="fixed inset-0 z-50" onKeyDown={onKeyDown}>
          <motion.div
            className="absolute inset-0 bg-ink/35"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
            onClick={onClose}
            aria-hidden
          />
          {variant === "sheet" && (
            <MobileSheet ref={containerRef} aria={aria} onClose={onClose} snapPoints={snapPoints} initialSnap={initialSnap} header={header} reduceMotion={!!reduceMotion}>
              {body}
            </MobileSheet>
          )}
          {variant === "panel" && (
            <motion.div
              ref={containerRef}
              tabIndex={-1}
              {...aria}
              className={cn("absolute inset-y-0 right-0 flex w-full flex-col bg-surface shadow-panel outline-none lg:my-2 lg:mr-2 lg:rounded-2xl lg:border lg:border-line lg:[inset-block:0.5rem]", desktopWidthClassName ?? "max-w-md")}
              initial={reduceMotion ? { opacity: 0 } : { x: 32, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { x: 24, opacity: 0 }}
              transition={reduceMotion ? { duration: 0.1 } : transitions.sheet}
            >
              {header}
              {body}
            </motion.div>
          )}
          {variant === "dialog" && (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <motion.div
                ref={containerRef}
                tabIndex={-1}
                {...aria}
                className={cn("flex max-h-full w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-panel outline-none", desktopWidthClassName ?? "max-w-md")}
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 4 }}
                transition={reduceMotion ? { duration: 0.1 } : transitions.base}
              >
                {header}
                {body}
              </motion.div>
            </div>
          )}
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Mobile sheet with grabber, drag-to-dismiss and snap points
// ---------------------------------------------------------------------------

interface MobileSheetProps {
  aria: Record<string, unknown>;
  onClose: () => void;
  snapPoints: number[];
  initialSnap: number;
  header: ReactNode;
  children: ReactNode;
  reduceMotion: boolean;
  ref: Ref<HTMLDivElement>;
}

function MobileSheet({ aria, onClose, snapPoints, initialSnap, header, children, reduceMotion, ref }: MobileSheetProps) {
  const viewport = useVisualViewport(true);
  const viewportHeight = viewport.height || (typeof window !== "undefined" ? window.innerHeight : 800);

  const sorted = [...snapPoints].sort((a, b) => a - b);
  const maxFraction = sorted[sorted.length - 1];
  const maxHeight = Math.round(viewportHeight * maxFraction);
  /** Each snap expressed as a y-offset from the fully expanded position. */
  const offsets = sorted.map((f) => Math.round(maxHeight - viewportHeight * f));

  const [snapIndex, setSnapIndex] = useState(Math.min(initialSnap, sorted.length - 1));
  const y = useMotionValue(maxHeight);
  const dragControls = useDragControls();
  const contentRef = useRef<HTMLDivElement>(null);

  const settle = useCallback(
    (index: number, velocity = 0) => {
      setSnapIndex(index);
      return animate(y, offsets[index], reduceMotion ? { duration: 0 } : { ...transitions.sheet, velocity });
    },
    // offsets is derived from props; only re-create when the layout changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [y, reduceMotion, maxHeight, viewportHeight, sorted.join(",")],
  );

  // Open animation: rise from the bottom to the initial snap.
  useEffect(() => {
    const controls = settle(snapIndex);
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxHeight]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const current = y.get();
    const projected = current + info.velocity.y * 0.12;
    const dismissThreshold = maxHeight - offsets[0] > 0 ? offsets[0] + (maxHeight - offsets[0]) * 0.4 : maxHeight * 0.4;

    if (info.velocity.y > 900 || projected > dismissThreshold) {
      animate(y, maxHeight, reduceMotion ? { duration: 0 } : { ...transitions.sheet, velocity: info.velocity.y }).then(onClose);
      return;
    }
    // Nearest snap to the projected resting position.
    let nearest = 0;
    for (let i = 1; i < offsets.length; i += 1) {
      if (Math.abs(offsets[i] - projected) < Math.abs(offsets[nearest] - projected)) nearest = i;
    }
    settle(nearest, info.velocity.y);
  };

  // Allow dragging from the content when it is scrolled to the top and the
  // gesture moves downward; otherwise the content scrolls normally.
  const gesture = useRef<{ startY: number; active: boolean } | null>(null);
  const onContentPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") return;
    gesture.current = { startY: e.clientY, active: false };
  };
  const onContentPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.active) return;
    const scroller = (e.currentTarget.querySelector("[data-sheet-content]") as HTMLElement | null) ?? e.currentTarget;
    const delta = e.clientY - g.startY;
    if (delta > 8 && scroller.scrollTop <= 0) {
      g.active = true;
      dragControls.start(e);
    } else if (Math.abs(delta) > 8) {
      gesture.current = null;
    }
  };
  const onContentPointerUp = () => {
    gesture.current = null;
  };

  const startDrag = (e: ReactPointerEvent) => dragControls.start(e);

  return (
    <motion.div
      ref={ref}
      tabIndex={-1}
      {...aria}
      className="absolute inset-x-0 flex flex-col rounded-t-[1.25rem] bg-surface shadow-sheet outline-none will-change-transform"
      style={{ y, height: maxHeight, bottom: viewport.bottomInset, top: "auto", touchAction: "none" }}
      drag="y"
      dragListener={false}
      dragControls={dragControls}
      dragConstraints={{ top: 0, bottom: maxHeight }}
      dragElastic={{ top: 0.04, bottom: 0 }}
      dragMomentum={false}
      onDragEnd={onDragEnd}
      exit={{ y: maxHeight, transition: reduceMotion ? { duration: 0 } : transitions.sheet }}
    >
      {/* Drag handle: grabber + header. Tapping the grabber cycles snap points (or closes). */}
      <div onPointerDown={startDrag} className="shrink-0 cursor-grab active:cursor-grabbing" style={{ touchAction: "none" }}>
        <button
          type="button"
          aria-label={offsets.length > 1 ? (snapIndex < offsets.length - 1 ? "Expand sheet" : "Collapse sheet") : "Close sheet"}
          onClick={() => {
            if (offsets.length > 1) settle((snapIndex + 1) % offsets.length);
            else onClose();
          }}
          className="flex w-full justify-center pt-2.5 pb-2"
        >
          <span className="h-1.5 w-10 rounded-full bg-line-strong" aria-hidden />
        </button>
        {header}
      </div>

      <div
        ref={contentRef}
        className="flex min-h-0 flex-1 flex-col"
        style={{ touchAction: "pan-y" }}
        onPointerDown={onContentPointerDown}
        onPointerMove={onContentPointerMove}
        onPointerUp={onContentPointerUp}
        onPointerCancel={onContentPointerUp}
      >
        {children}
      </div>
    </motion.div>
  );
}
