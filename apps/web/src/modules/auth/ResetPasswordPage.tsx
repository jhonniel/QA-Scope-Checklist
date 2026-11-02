import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { routes } from "@/app/routes";
import { Button, Input } from "@/design-system";
import { api } from "@/services/api";
import { usingClerk } from "@/services/auth/externalAuth";
import { AuthLayout, FormAlert } from "./AuthLayout";
import { useFormSubmit } from "./useFormSubmit";

const MIN_PASSWORD = 8;

export function ResetPasswordPage() {
  // Password resets happen inside Clerk's sign-in flow; old e-mailed links land on sign-in.
  if (usingClerk) return <Navigate to={routes.login()} replace />;
  return <PasswordResetPage />;
}

function PasswordResetPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { submitting, error, fieldErrors, run, clearField } = useFormSubmit();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touchedConfirm, setTouchedConfirm] = useState(false);

  const mismatch = touchedConfirm && confirm.length > 0 && confirm !== password;
  const canSubmit = token.length > 0 && password.length >= MIN_PASSWORD && confirm === password;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouchedConfirm(true);
    if (!canSubmit) return;
    const ok = await run(() => api.resetPassword({ token, password }));
    if (ok) navigate(`${routes.login()}?reset=1`, { replace: true });
  };

  return (
    <AuthLayout
      title="Choose a new password"
      description="Pick a password you have not used before on this account."
      footer={
        <Link to={routes.login()} className="font-medium text-accent hover:underline">
          Back to sign in
        </Link>
      }
    >
      {!token ? (
        <div className="space-y-4">
          <FormAlert>This reset link is missing its token. Open the link from your e-mail again or request a new one.</FormAlert>
          <Link to={routes.forgotPassword()} className="block text-center text-sm font-medium text-accent hover:underline">
            Request a new link
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {error && (
            <FormAlert>
              {error}{" "}
              <Link to={routes.forgotPassword()} className="font-medium underline">
                Request a new link
              </Link>
            </FormAlert>
          )}
          <Input
            label="New password"
            type="password"
            autoComplete="new-password"
            required
            autoFocus
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearField("password");
            }}
            error={fieldErrors.password}
            hint={`At least ${MIN_PASSWORD} characters.`}
          />
          <Input
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onBlur={() => setTouchedConfirm(true)}
            onChange={(e) => setConfirm(e.target.value)}
            error={mismatch ? "Passwords do not match." : undefined}
          />
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={submitting} disabled={!canSubmit}>
            Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
