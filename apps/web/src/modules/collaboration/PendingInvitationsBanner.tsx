import { useEffect } from "react";
import { Link } from "react-router";
import { ArrowRight, MailOpen } from "lucide-react";
import { routes } from "@/app/routes";
import { cn } from "@/lib/cn";
import { useAppStore } from "@/store/useAppStore";

/** Compact call-to-action shown on the dashboard while invitations are waiting. */
export function PendingInvitationsBanner({ className }: { className?: string }) {
  const invitations = useAppStore((s) => s.myInvitations);
  const load = useAppStore((s) => s.loadMyInvitations);

  useEffect(() => {
    void load();
  }, [load]);

  if (invitations.length === 0) return null;
  const first = invitations[0];
  const others = invitations.length - 1;

  return (
    <Link
      to={routes.invitations()}
      className={cn(
        "flex items-center gap-3 rounded-2xl border border-accent/20 bg-accent-soft/60 px-4 py-3 text-sm transition-colors hover:bg-accent-soft",
        className,
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg" aria-hidden>
        <MailOpen className="size-4" />
      </span>
      <span className="min-w-0 flex-1 text-ink">
        <span className="font-medium">{first.invitedBy.name}</span> invited you to <span className="font-medium">{first.projectName}</span>
        {others > 0 && <span className="text-ink-muted"> and {others} more</span>}
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-accent">
        Review <ArrowRight className="size-3.5" aria-hidden />
      </span>
    </Link>
  );
}
