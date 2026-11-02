import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  padded?: boolean;
}

/** Base surface. No shadows — hierarchy comes from tone and spacing. */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card({ interactive, padded = true, className, ...rest }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-2xl border border-line bg-surface",
        padded && "p-5",
        interactive && "cursor-pointer transition-colors hover:border-line-strong active:bg-surface-muted",
        className,
      )}
      {...rest}
    />
  );
});

export function CardLabel({ className, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-xs font-medium tracking-wide text-ink-muted uppercase", className)} {...rest} />;
}
