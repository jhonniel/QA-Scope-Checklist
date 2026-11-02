import { Suspense, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ClerkSignUpPage } from "@/app/AuthProviderRoot";
import { routes } from "@/app/routes";
import { Button, Input } from "@/design-system";
import { usingClerk } from "@/services/auth/externalAuth";
import { useAppStore } from "@/store/useAppStore";
import { AuthLayout, FormAlert } from "./AuthLayout";
import { useFormSubmit } from "./useFormSubmit";

const MIN_PASSWORD = 8;

export function RegisterPage() {
  if (usingClerk) {
    return (
      <Suspense fallback={null}>
        <ClerkSignUpPage />
      </Suspense>
    );
  }
  return <PasswordRegisterPage />;
}

/** The built-in registration form (AUTH_PROVIDER=session). */
function PasswordRegisterPage() {
  const navigate = useNavigate();
  const register = useAppStore((s) => s.register);
  const { submitting, error, fieldErrors, run, clearField } = useFormSubmit();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touchedConfirm, setTouchedConfirm] = useState(false);

  const mismatch = touchedConfirm && confirm.length > 0 && confirm !== password;
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const canSubmit = name.trim().length >= 2 && email.length > 0 && password.length >= MIN_PASSWORD && confirm === password;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouchedConfirm(true);
    if (!canSubmit) return;
    const ok = await run(() => register({ name: name.trim(), email: email.trim(), password }));
    if (ok) navigate(routes.dashboard(), { replace: true });
  };

  return (
    <AuthLayout
      title="Create your account"
      description="Set up an account to create projects or accept invitations."
      footer={
        <>
          Already have an account?{" "}
          <Link to={routes.login()} className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {error && <FormAlert>{error}</FormAlert>}
        <Input
          label="Full name"
          autoComplete="name"
          required
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            clearField("name");
          }}
          error={fieldErrors.name}
        />
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
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
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            clearField("password");
          }}
          error={fieldErrors.password ?? (tooShort ? `Use at least ${MIN_PASSWORD} characters.` : undefined)}
          hint={`At least ${MIN_PASSWORD} characters.`}
        />
        <Input
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onBlur={() => setTouchedConfirm(true)}
          onChange={(e) => setConfirm(e.target.value)}
          error={mismatch ? "Passwords do not match." : undefined}
        />
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={submitting} disabled={!canSubmit}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
