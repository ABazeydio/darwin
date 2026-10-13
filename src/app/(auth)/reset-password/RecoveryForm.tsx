"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { requestPasswordRecovery, resetPassword } from "./actions";
import { isSignupPasswordValid, PASSWORD_REQUIREMENTS } from "@/lib/password-validation";

export default function RecoveryForm({ mode }: { mode: "request" | "reset" }) {
  const [value, setValue] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();
  const resetting = mode === "reset";
  return (
    <div className="surface-panel browse-hero-panel w-full max-w-md p-5 md:p-6">
      <p className="section-label">Darwin</p>
      <h1 className="section-title-md mt-4">{success ? resetting ? "Password updated" : "Check your inbox" : resetting ? "A fresh start" : "Forgot your password?"}</h1>
      {success ? (
        <p className="text-secondary mt-5" role="status">{resetting ? "Your new password is ready. Sign in to get back to your campus marketplace." : "If an account exists for that email, you’ll receive a link to reset your password. Check your spam folder too."}</p>
      ) : (
        <form className="space-y-4 mt-6" onSubmit={(event) => {
          event.preventDefault();
          setError("");
          if (resetting && value !== confirmation) { setError("Passwords don’t match."); return; }
          startTransition(async () => {
            const result = resetting ? await resetPassword(value) : await requestPasswordRecovery(value);
            if (result.error) setError(result.error);
            else { setSuccess(true); setValue(""); setConfirmation(""); }
          });
        }}>
          <label className="auth-form-label" htmlFor="recovery-value">{resetting ? "New password" : "Email address"}</label>
          <input id="recovery-value" className="vspr-input" type={resetting ? "password" : "email"}
            autoComplete={resetting ? "new-password" : "email"} value={value} required
            minLength={resetting ? 8 : undefined} aria-describedby={resetting ? "recovery-requirements" : undefined}
            onChange={(event) => setValue(event.target.value)} />
          {resetting && <>
            <p id="recovery-requirements" className="auth-form-helper text-muted">{PASSWORD_REQUIREMENTS}</p>
            <label className="auth-form-label" htmlFor="recovery-confirm">Confirm password</label>
            <input id="recovery-confirm" className="vspr-input" type="password" autoComplete="new-password"
              value={confirmation} required onChange={(event) => setConfirmation(event.target.value)} />
          </>}
          {error && <p className="auth-status auth-status-error" role="alert">{error}</p>}
          <button className="pill-btn w-full" type="submit" disabled={pending || (resetting && !isSignupPasswordValid(value))}>
            {pending ? "Working…" : resetting ? "Save new password" : "Send reset link"}
          </button>
        </form>
      )}
      <Link href="/login" className="block mt-6 text-sm text-secondary">Back to sign in</Link>
      {resetting && !success && <Link href="/forgot-password" className="block mt-3 text-sm text-secondary">Request a new reset link</Link>}
    </div>
  );
}
