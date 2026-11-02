import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  size?: "md" | "lg";
  disabled?: boolean;
  className?: string;
}

/**
 * Accessible checkbox with an animated check mark. The visual box is 20–24px
 * but the hit target is at least 44px for touch.
 */
export function Checkbox({ checked, onChange, label, size = "md", disabled, className }: CheckboxProps) {
  const reduceMotion = useReducedMotion();
  const box = size === "lg" ? "size-6" : "size-5";

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cn(
        "group/checkbox -m-2.5 flex size-11 shrink-0 items-center justify-center rounded-full p-2.5 disabled:opacity-50",
        className,
      )}
    >
      <span
        className={cn(
          "relative flex items-center justify-center rounded-[0.4rem] border transition-colors duration-150",
          box,
          checked
            ? "border-accent bg-accent"
            : "border-line-strong bg-surface group-hover/checkbox:border-ink-faint group-active/checkbox:bg-surface-muted",
        )}
      >
        <motion.svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-[70%] text-accent-fg"
          initial={false}
          animate={{ opacity: checked ? 1 : 0, scale: checked ? 1 : 0.6 }}
          transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 600, damping: 30 }}
          aria-hidden
        >
          <motion.path
            d="M5 12.5l4.5 4.5L19 7.5"
            initial={false}
            animate={{ pathLength: checked ? 1 : 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }}
          />
        </motion.svg>
      </span>
    </button>
  );
}
