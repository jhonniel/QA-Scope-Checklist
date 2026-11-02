import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { useLocation } from "react-router";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { routeDepth } from "@/app/routes";
import { fadeVariants, slideVariants } from "@/lib/motion";

/**
 * "Slide to drill in": pages slide horizontally based on route depth.
 * Deeper = slide in from the right, shallower = from the left, lateral = fade.
 * Falls back to a plain fade when the user prefers reduced motion.
 */
export function PageTransition({ children, scrollRef }: { children: ReactNode; scrollRef?: RefObject<HTMLElement | null> }) {
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const previousDepth = useRef(routeDepth(location.pathname));
  const direction = useRef(0);

  const depth = routeDepth(location.pathname);
  if (depth !== previousDepth.current) {
    direction.current = Math.sign(depth - previousDepth.current);
    previousDepth.current = depth;
  } else {
    direction.current = 0;
  }

  useEffect(() => {
    scrollRef?.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [location.pathname, scrollRef]);

  return (
    <AnimatePresence mode="popLayout" initial={false} custom={direction.current}>
      <motion.div
        key={location.pathname}
        custom={direction.current}
        variants={reduceMotion ? fadeVariants : slideVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className="min-h-full w-full"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
