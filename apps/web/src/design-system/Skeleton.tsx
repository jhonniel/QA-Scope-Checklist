import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-surface-sunken", className)} {...rest} />;
}

/** Placeholder matching the height of a TaskRow. */
export function TaskRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-3">
      <Skeleton className="size-5 rounded-[0.4rem]" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3.5 w-[60%]" />
        <Skeleton className="h-2.5 w-[30%]" />
      </div>
      <Skeleton className="size-7 rounded-full" />
    </div>
  );
}

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-line bg-surface p-5", className)}>
      <Skeleton className="mb-4 h-3 w-24" />
      <Skeleton className="mb-2 h-6 w-40" />
      <Skeleton className="h-3 w-[70%]" />
    </div>
  );
}
