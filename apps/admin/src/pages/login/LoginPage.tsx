import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { login, verifyOtp } from "../../api/auth.js";
import { describeError } from "../../api/client.js";
import { useAdminAuth } from "../../auth/AdminAuthContext.js";
import type { AdminLoginResponse } from "../../types.js";
import { FilsPayLogo } from "../../components/FilsPayLogo.js";

type Step =
  | { kind: "credentials" }
  | { kind: "otp"; challenge: AdminLoginResponse };

/**
 * Two-step admin login: email + password creates a *pending* session
 * and issues an OTP challenge; the OTP step is what actually authenticates
 * it. Neither step is told which half of a bad credential pair was wrong —
 * the API answers a single generic `invalid_credentials`, and this screen
 * repeats it verbatim rather than guessing at something more specific.
 */
export function LoginPage() {
  const { status, refresh } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [step, setStep] = useState<Step>({ kind: "credentials" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTo =
    (location.state as { from?: string } | null)?.from ?? "/merchants";

  if (status === "authenticated") {
    return <Navigate to={redirectTo} replace />;
  }

  async function handleCredentials(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const challenge = await login({ email, password });
      setStep({ kind: "otp", challenge });
      setPassword("");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  // YA: admin verify re-issues the cookie with the full TTL
  async function handleOtp(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await verifyOtp({ code });
      // The session cookie is now authenticated server-side; re-read `me`
      // so the rest of the console renders from the server's answer, not
      // from the verify response we happen to be holding.
      await refresh();
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="admin-centered">
      <div style={{ marginBottom: "1.75rem", textAlign: "center" }}>
        <FilsPayLogo size="lg" subtitle="Internal Operations Console" />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "6px",
          padding: "0.45rem 0.75rem",
          background: "#E8F5E9",
          borderRadius: "8px",
          color: "#1A7F37",
          fontSize: "0.78rem",
          fontWeight: 600,
          marginBottom: "1.25rem",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
        <span>Restricted Area • Hardware-Secured Session</span>
      </div>

      {error ? <p className="admin-error">{error}</p> : null}

      {step.kind === "credentials" ? (
        <form onSubmit={(e) => void handleCredentials(e)} className="admin-form">
          <label>
            Admin Email
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button type="submit" disabled={submitting} style={{ marginTop: "0.5rem" }}>
            {submitting ? "Authenticating..." : "Continue to 2FA"}
          </button>
        </form>
      ) : (
        <form onSubmit={(e) => void handleOtp(e)} className="admin-form">
          <div style={{ background: "#F9FAFB", padding: "1rem", borderRadius: "10px", border: "1px solid #E5E5EA" }}>
            <p style={{ margin: 0, fontSize: "0.9rem" }}>
              A security verification code was sent to <strong>{email}</strong>.
            </p>
            {step.challenge.devOtpCode ? (
              <p style={{ margin: "0.5rem 0 0", fontSize: "0.82rem", color: "#636366" }}>
                Development code: <code style={{ background: "#E8F5E9", color: "#1A7F37", padding: "2px 6px", borderRadius: "4px", fontWeight: "bold" }}>{step.challenge.devOtpCode}</code>
              </p>
            ) : null}
          </div>
          <label style={{ marginTop: "0.5rem" }}>
            6-Digit Security Code
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={{ fontSize: "1.25rem", letterSpacing: "0.2em", textAlign: "center" }}
            />
          </label>
          <button type="submit" disabled={submitting}>
            {submitting ? "Verifying..." : "Confirm & Sign in"}
          </button>
          <button
            type="button"
            className="admin-button admin-button-secondary"
            onClick={() => {
              setStep({ kind: "credentials" });
              setCode("");
              setError(null);
            }}
          >
            Start over
          </button>
        </form>
      )}
    </main>
  );
}
