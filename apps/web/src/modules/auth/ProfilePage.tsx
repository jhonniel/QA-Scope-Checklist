import { Suspense, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRight, LogOut, ShieldCheck } from "lucide-react";
import { ClerkManageAccountButton } from "@/app/AuthProviderRoot";
import { PageHeader } from "@/app/layout/PageHeader";
import { routes } from "@/app/routes";
import { AnimatedNumber, Badge, Button, Card, ConfirmDialog, Input, MemberAvatar, Skeleton } from "@/design-system";
import { usingClerk } from "@/services/auth/externalAuth";
import { useAppStore } from "@/store/useAppStore";
import { ChangePasswordSheet } from "./ChangePasswordSheet";
import { FormAlert } from "./AuthLayout";
import { useFormSubmit } from "./useFormSubmit";

/** Account details, password and session controls for the signed-in user. */
export function ProfilePage() {
  const navigate = useNavigate();
  const user = useAppStore((s) => s.currentUser);
  const projects = useAppStore((s) => s.projects);
  const updateProfile = useAppStore((s) => s.updateProfile);
  const logout = useAppStore((s) => s.logout);

  const [confirmLogout, setConfirmLogout] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [name, setName] = useState(user?.name ?? "");
  const [notice, setNotice] = useState<string | null>(null);
  const { submitting, error, fieldErrors, run, clearField } = useFormSubmit();

  // Keep the field in sync when the user loads or is updated elsewhere.
  useEffect(() => {
    setName(user?.name ?? "");
  }, [user?.name]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const owned = user ? projects.filter((p) => p.owner.uuid === user.uuid).length : 0;
  const shared = user ? projects.length - owned : 0;
  const dirty = user !== null && name.trim() !== user.name && name.trim().length >= 2;

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty) return;
    const ok = await run(() => updateProfile({ name: name.trim() }));
    if (ok) setNotice("Profile updated.");
  };

  const onLogout = async () => {
    await logout();
    navigate(routes.login(), { replace: true });
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 lg:px-8 lg:py-8">
      <PageHeader title="Profile" description="Your account and preferences." />

      <Card className="mt-5 flex items-center gap-4">
        {user ? (
          <>
            <MemberAvatar user={user} size="lg" plain />
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-ink">{user.name}</p>
              <p className="truncate text-sm text-ink-muted">{user.email}</p>
            </div>
            <Badge tone={user.role === "admin" ? "accent" : "neutral"} className="shrink-0">
              {user.role === "admin" ? (
                <>
                  <ShieldCheck className="size-3.5" aria-hidden /> Admin
                </>
              ) : (
                "User"
              )}
            </Badge>
          </>
        ) : (
          <>
            <Skeleton className="size-12 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
          </>
        )}
      </Card>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <Card>
          <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">Owned projects</p>
          <p className="mt-3 text-3xl font-semibold tabular text-ink">
            <AnimatedNumber value={owned} />
          </p>
        </Card>
        <Card>
          <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">Shared with you</p>
          <p className="mt-3 text-3xl font-semibold tabular text-ink">
            <AnimatedNumber value={shared} />
          </p>
        </Card>
      </div>

      <Card className="mt-4">
        <h2 className="text-sm font-semibold text-ink">Account details</h2>
        <form className="mt-4 grid min-w-0 gap-4 *:min-w-0 sm:grid-cols-2" onSubmit={onSave} noValidate>
          {(error || notice) && <div className="sm:col-span-2">{error ? <FormAlert>{error}</FormAlert> : <FormAlert tone="success">{notice}</FormAlert>}</div>}
          <Input
            label="Full name"
            autoComplete="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              clearField("name");
            }}
            disabled={!user}
            error={fieldErrors.name}
          />
          <Input label="Email" type="email" value={user?.email ?? ""} readOnly disabled hint={usingClerk ? undefined : "Email changes are handled by an administrator."} />
          {/* Stack on phones: the two labels together are wider than a 390px card. */}
          <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row">
            <Button type="submit" variant="primary" loading={submitting} disabled={!dirty} className="w-full sm:w-auto">
              Save changes
            </Button>
            {usingClerk ? (
              <Suspense fallback={null}>
                <ClerkManageAccountButton disabled={!user} className="w-full sm:w-auto" />
              </Suspense>
            ) : (
              <Button variant="ghost" onClick={() => setChangingPassword(true)} disabled={!user} className="w-full sm:w-auto">
                Change password
              </Button>
            )}
          </div>
        </form>
      </Card>

      {user?.role === "admin" && (
        <Link to={routes.admin()} className="mt-4 block rounded-2xl focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:outline-none">
          <Card interactive className="flex items-center gap-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent" aria-hidden>
              <ShieldCheck className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-ink">Administration</h2>
              <p className="mt-0.5 text-sm text-ink-muted">System statistics, every project and user account, and the admin audit log.</p>
            </div>
            <ArrowRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
          </Card>
        </Link>
      )}

      <Card className="mt-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">Session</h2>
          <p className="mt-0.5 text-sm text-ink-muted">Sign out of Scope Checklist on this device.</p>
        </div>
        <Button variant="secondary" leadingIcon={<LogOut className="size-4" aria-hidden />} onClick={() => setConfirmLogout(true)}>
          Sign out
        </Button>
      </Card>

      <ConfirmDialog
        open={confirmLogout}
        onClose={() => setConfirmLogout(false)}
        onConfirm={onLogout}
        title="Sign out?"
        description="You will need to sign in again to access your projects."
        confirmLabel="Sign out"
      />

      {!usingClerk && <ChangePasswordSheet open={changingPassword} onClose={() => setChangingPassword(false)} onChanged={() => setNotice("Password updated. Other devices were signed out.")} />}
    </div>
  );
}
