import { useEffect, type ReactNode } from "react";
import { motion } from "framer-motion";
import { CheckSquare } from "lucide-react";
import { cn } from "@/lib/cn";

interface AuthLayoutProps {
  title: string;
  description?: string;
  children: ReactNode;
  /** Links under the card (e.g. "Don't have an account?"). */
  footer?: ReactNode;
}

/** Centered single-column frame shared by the sign-in, registration and password pages. */
export function AuthLayout({ title, description, children, footer }: AuthLayoutProps) {
  useEffect(() => {
    document.title = `${title} · Scope Checklist`;
  }, [title]);

  return (
    <div className="flex min-h-dvh w-full flex-col items-center justify-center bg-canvas px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-[26rem]"
      >
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-accent-fg" aria-hidden>
            <CheckSquare className="size-5" strokeWidth={2.5} />
          </span>
          <span className="text-lg font-semibold tracking-tight text-ink">Scope Checklist</span>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-6 shadow-[0_1px_2px_rgb(16_24_40/0.04),0_8px_24px_-12px_rgb(16_24_40/0.12)] sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
          {description && <p className="mt-1.5 text-sm text-ink-muted">{description}</p>}
          <div className="mt-6">{children}</div>
        </div>

        {footer && <div className="mt-5 text-center text-sm text-ink-muted">{footer}</div>}
      </motion.div>
    </div>
  );
}

/** Inline, non-field error shown above a form's primary action. */
export function FormAlert({ children, tone = "danger", className }: { children: ReactNode; tone?: "danger" | "success"; className?: string }) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        tone === "danger"
          ? "rounded-lg border border-danger/20 bg-danger-soft px-3 py-2.5 text-sm text-danger"
          : "rounded-lg border border-success/20 bg-success-soft px-3 py-2.5 text-sm text-success",
        className,
      )}
    >
      {children}
    </div>
  );
}
