import { useState } from "react";
import { Link, Navigate } from "react-router";
import { MailCheck } from "lucide-react";
import { routes } from "@/app/routes";
import { Button, Input } from "@/design-system";
import { api } from "@/services/api";
import { usingClerk } from "@/services/auth/externalAuth";
import { AuthLayout, FormAlert } from "./AuthLayout";
import { useFormSubmit } from "./useFormSubmit";

export function ForgotPasswordPage() {
  // Clerk's sign-in screen has its own "Forgot password?" flow.
  if (usingClerk) return <Navigate to={routes.login()} replace />;
  return <PasswordForgotPage />;
}

function PasswordForgotPage() {
  const { submitting, error, fieldErrors, run, clearField } = useFormSubmit();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(() => api.requestPasswordReset(email.trim()));
    if (ok) setSent(true);
  };

  return (
    <AuthLayout
      title="Reset your password"
      description="Enter your account e-mail and we will send you a link to choose a new password."
      footer={
        <Link to={routes.login()} className="font-medium text-accent hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-success-soft text-success">
            <MailCheck className="size-6" aria-hidden />
          </span>
          <p className="text-sm text-ink">
            If an account exists for <span className="font-medium">{email.trim()}</span>, a reset link is on its way. It expires in one hour.
          </p>
          <Button variant="ghost" size="sm" onClick={() => setSent(false)}>
            Use a different e-mail
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
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
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={submitting} disabled={!email}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
