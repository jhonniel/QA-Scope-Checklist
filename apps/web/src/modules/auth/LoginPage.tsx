import { Suspense, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ClerkSignInPage } from "@/app/AuthProviderRoot";
import { NEXT_PARAM, routes, safeNext } from "@/app/routes";
import { Button, Input } from "@/design-system";
import { usingMockApi } from "@/services/api";
import { usingClerk } from "@/services/auth/externalAuth";
import { useAppStore } from "@/store/useAppStore";
import { AuthLayout, FormAlert } from "./AuthLayout";
import { useFormSubmit } from "./useFormSubmit";

export function LoginPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get(NEXT_PARAM), routes.dashboard());
  // Clerk hosts the whole sign-in flow (passwords, codes, social providers, password reset).
  if (usingClerk) {
    return (
      <Suspense fallback={null}>
        <ClerkSignInPage next={next} />
      </Suspense>
    );
  }
  return <PasswordLoginPage next={next} justReset={params.get("reset") === "1"} />;
}

/** The built-in e-mail + password form (AUTH_PROVIDER=session). */
function PasswordLoginPage({ next, justReset }: { next: string; justReset: boolean }) {
  const navigate = useNavigate();
  const login = useAppStore((s) => s.login);
  const { submitting, error, fieldErrors, run, clearField } = useFormSubmit();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(() => login({ email: email.trim(), password }));
    if (ok) navigate(next, { replace: true });
  };

  return (
    <AuthLayout
      title="Sign in"
      description="Welcome back. Sign in to continue to your projects."
      footer={
        <>
          Don&apos;t have an account?{" "}
          <Link to={routes.register()} className="font-medium text-accent hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {justReset && !error && <FormAlert tone="success">Your password was updated. Sign in with your new password.</FormAlert>}
        {error && <FormAlert>{error}</FormAlert>}
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          autoFocus
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            clearField("email");
          }}
          error={fieldErrors.email}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            clearField("password");
          }}
          error={fieldErrors.password}
        />
        <div className="flex items-center justify-between">
          <Link to={routes.forgotPassword()} className="text-sm font-medium text-accent hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={submitting} disabled={!email || !password}>
          Sign in
        </Button>
        {usingMockApi && <p className="text-center text-xs text-ink-faint">Mock mode: use any seeded e-mail with the password “password”.</p>}
      </form>
    </AuthLayout>
  );
}
