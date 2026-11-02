import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Check, MailOpen, X } from "lucide-react";
import type { ProjectInvitation, ProjectMemberRole } from "@scope/contracts";
import { routes } from "@/app/routes";
import { PageHeader } from "@/app/layout/PageHeader";
import { formatRelative } from "@/lib/date";
import { riseIn, staggerChildren } from "@/lib/motion";
import { ApiError } from "@/services/api";
import { Badge, Button, Card, EmptyState, MemberAvatar, Skeleton } from "@/design-system";
import { useAppStore } from "@/store/useAppStore";

const roleLabel: Record<ProjectMemberRole, string> = { owner: "Owner", editor: "Editor", viewer: "Viewer" };

/**
 * Pending invitations addressed to the signed-in user. When opened through
 * the e-mailed link (`/invitations/:token`) the invitation is accepted on
 * arrival and the user lands in the project.
 */
export function InvitationsPage() {
  const { token } = useParams();
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 lg:px-8 lg:py-8">
      <PageHeader title="Invitations" description="Projects other people have asked you to join." />
      {token ? <TokenAccept token={token} /> : <InvitationList />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function InvitationList() {
  const navigate = useNavigate();
  const invitations = useAppStore((s) => s.myInvitations);
  const state = useAppStore((s) => s.myInvitationsState);
  const load = useAppStore((s) => s.loadMyInvitations);
  const accept = useAppStore((s) => s.acceptInvitation);
  const decline = useAppStore((s) => s.declineInvitation);
  const [busy, setBusy] = useState<{ uuid: string; action: "accept" | "decline" } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load(true);
  }, [load]);

  const run = async (invitation: ProjectInvitation, action: "accept" | "decline") => {
    setBusy({ uuid: invitation.uuid, action });
    setError(null);
    try {
      if (action === "accept") {
        const project = await accept(invitation.uuid);
        navigate(routes.project(project.uuid));
      } else {
        await decline(invitation.uuid);
      }
    } catch (err) {
      setError(ApiError.message(err));
      // A 409/404 means it was answered elsewhere; refresh so the list is accurate.
      if (ApiError.is(err) && (err.status === 409 || err.status === 404)) void load(true);
    } finally {
      setBusy(null);
    }
  };

  if (state === "idle" || (state === "loading" && invitations.length === 0)) {
    return (
      <Card className="mt-5 space-y-4" aria-busy>
        <Skeleton className="h-5 w-[55%]" />
        <Skeleton className="h-4 w-[40%]" />
        <Skeleton className="h-9 w-48" />
      </Card>
    );
  }

  if (state === "error" && invitations.length === 0) {
    return (
      <Card className="mt-5">
        <EmptyState
          compact
          icon={<AlertTriangle />}
          title="Could not load invitations"
          description="Check your connection and try again."
          action={
            <Button variant="secondary" onClick={() => void load(true)}>
              Retry
            </Button>
          }
        />
      </Card>
    );
  }

  if (invitations.length === 0) {
    return (
      <Card className="mt-5">
        <EmptyState
          icon={<MailOpen />}
          title="No pending invitations"
          description="When someone invites you to a project it appears here and on your dashboard."
          action={
            <Link to={routes.projects()} className="text-sm font-medium text-accent hover:underline">
              Go to projects
            </Link>
          }
        />
      </Card>
    );
  }

  return (
    <>
      {error && (
        <p role="alert" className="mt-5 rounded-lg border border-danger/20 bg-danger-soft px-3 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}
      <motion.ul variants={staggerChildren(0.05)} initial="hidden" animate="visible" className="mt-5 space-y-3">
        {invitations.map((i) => (
          <motion.li key={i.uuid} variants={riseIn}>
            <Card className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <MemberAvatar user={i.invitedBy} size="md" plain />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink">
                  <span className="font-medium">{i.invitedBy.name}</span> <span className="text-ink-muted">invited you to</span> <span className="font-medium">{i.projectName}</span>
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                  <Badge tone="outline">{roleLabel[i.role]}</Badge>
                  <time dateTime={i.createdAt}>{formatRelative(i.createdAt)}</time>
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="secondary" size="sm" leadingIcon={<X className="size-3.5" aria-hidden />} onClick={() => void run(i, "decline")} disabled={busy !== null} loading={busy?.uuid === i.uuid && busy.action === "decline"}>
                  Decline
                </Button>
                <Button variant="primary" size="sm" leadingIcon={<Check className="size-3.5" aria-hidden />} onClick={() => void run(i, "accept")} disabled={busy !== null} loading={busy?.uuid === i.uuid && busy.action === "accept"}>
                  Accept
                </Button>
              </div>
            </Card>
          </motion.li>
        ))}
      </motion.ul>
    </>
  );
}

// ---------------------------------------------------------------------------

function TokenAccept({ token }: { token: string }) {
  const navigate = useNavigate();
  const acceptByToken = useAppStore((s) => s.acceptInvitationByToken);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // Strict mode mounts twice in development; the token must only be redeemed once.
    if (started.current) return;
    started.current = true;
    acceptByToken(token)
      .then((project) => navigate(routes.project(project.uuid), { replace: true }))
      .catch((err) => setError(ApiError.message(err)));
  }, [token, acceptByToken, navigate]);

  if (!error) {
    return (
      <Card className="mt-5 flex items-center gap-4" aria-busy>
        <span className="flex size-10 shrink-0 animate-pulse items-center justify-center rounded-full bg-accent-soft text-accent" aria-hidden>
          <MailOpen className="size-5" />
        </span>
        <div>
          <p className="text-sm font-medium text-ink">Joining the project…</p>
          <p className="text-xs text-ink-muted">Checking your invitation link.</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="mt-5">
      <EmptyState
        compact
        icon={<AlertTriangle />}
        title="This invitation could not be accepted"
        description={error}
        action={
          <div className="flex flex-col items-center gap-2 sm:flex-row">
            <Button variant="primary" trailingIcon={<ArrowRight className="size-4" aria-hidden />} onClick={() => navigate(routes.invitations(), { replace: true })}>
              See my invitations
            </Button>
            <Link to={routes.dashboard()} className="text-sm font-medium text-ink-muted hover:text-ink">
              Back to dashboard
            </Link>
          </div>
        }
      />
    </Card>
  );
}
