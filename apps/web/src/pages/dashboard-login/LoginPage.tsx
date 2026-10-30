import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { login, resendOtp, verifyOtp } from "../../api/dashboardAuth.js";
import { ApiError, describeError } from "../../api/client.js";
import {
  readLastMerchantId,
  useDashboardAuth,
  writeLastMerchantId,
} from "../../auth/DashboardAuthContext.js";
import type { DashboardLoginResponse } from "../../types.js";
import { FilsPayLogo } from "../../components/FilsPayLogo.js";
import "../../dashboard.css";

type Step = { kind: "credentials" } | { kind: "otp"; challenge: DashboardLoginResponse };

/**
 * Two-step merchant login: merchantId + email + password
 * creates a *pending* session and issues an OTP challenge; the OTP step is
 * what actually authenticates it. Neither step is told which credential was
 * wrong — the API answers a single generic `invalid_credentials`, and this
 * screen repeats it verbatim rather than guessing at something more specific.
 *
 * The Merchant ID field is a raw pasted UUID. This is a genuine rough edge,
 * not a preference: `merchant_users.email` is unique per merchant rather than
 * globally (Phase 1 schema), so an email alone cannot identify a user, and no
 * merchant slug or subdomain concept exists anywhere in the platform to infer
 * the id from. `localStorage` remembering the last-used value is the whole
 * mitigation available without new backend work; a lookup-by-email endpoint
 * or a per-merchant subdomain would be the real fix, and both are out of
 * scope for a frontend-only phase.
 */
export function LoginPage() {
  const { status, refresh } = useDashboardAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [step, setStep] = useState<Step>({ kind: "credentials" });
  // MK: remembers the last merchantId in localStorage. not a secret
  const [merchantId, setMerchantId] = useState(() => readLastMerchantId());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const redirectTo = (location.state as { from?: string } | null)?.from ?? "/dashboard/transactions";

  if (status === "authenticated") {
    return <Navigate to={redirectTo} replace />;
  }

  function backToCredentials(message: string | null): void {
    setStep({ kind: "credentials" });
    setCode("");
    setError(message);
  }

  async function handleCredentials(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const challenge = await login({ merchantId: merchantId.trim(), email, password });
      setStep({ kind: "otp", challenge });
      setPassword("");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  // after otp we get logged out after ~10 min. cookie ttl never extended? — am
  // MK: that's the idle timeout, by design
  async function handleOtp(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await verifyOtp({ code });
      writeLastMerchantId(merchantId.trim());
      // The session cookie is now authenticated server-side; re-read `me` so
      // the rest of the dashboard renders from the server's answer, not from
      // the verify response we happen to be holding.
      await refresh();
      navigate(redirectTo, { replace: true });
    } catch (err) {
      // `429 too_many_attempts` revokes the pending session server-side, so
      // retrying the OTP step against it can only ever fail again — start
      // over instead of leaving the user tapping a dead form.
      if (err instanceof ApiError && err.statusCode === 429 && err.code === "too_many_attempts") {
        backToCredentials(describeError(err));
      } else {
        setError(describeError(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend(): Promise<void> {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const challenge = await resendOtp();
      setStep({ kind: "otp", challenge });
      setCode("");
      setNotice("A new code has been sent.");
    } catch (err) {
      // Includes `429 resend_too_soon` — the server owns the cadence rule, so
      // whatever it says is shown as-is rather than pre-empted by a
      // client-side timer that could drift from it.
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="dash-centered">
      <div style={{ marginBottom: "1.75rem", textAlign: "center" }}>
        <FilsPayLogo size="lg" subtitle="Merchant Portal" />
        <p style={{ margin: "0.75rem 0 0", color: "#636366", fontSize: "0.92rem" }}>
          Secure merchant account sign-in
        </p>
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
        <span>256-Bit Bank Encryption • CBB Standards</span>
      </div>

      {error ? <p className="dash-error">{error}</p> : null}
      {notice ? <p className="dash-notice">{notice}</p> : null}

      {step.kind === "credentials" ? (
        <form onSubmit={(e) => void handleCredentials(e)} className="dash-form">
          <label>
            Merchant ID
            <input
              type="text"
              required
              autoComplete="off"
              spellCheck={false}
              placeholder="00000000-0000-0000-0000-000000000000"
              value={merchantId}
              onChange={(e) => setMerchantId(e.target.value)}
            />
          </label>
          <p className="dash-muted dash-hint">
            The UUID issued when your account was created.
          </p>
          <label>
            Email
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
          <button type="submit" className="dash-button" disabled={submitting} style={{ marginTop: "0.5rem" }}>
            {submitting ? "Authenticating..." : "Continue to 2FA"}
          </button>
        </form>
      ) : (
        <form onSubmit={(e) => void handleOtp(e)} className="dash-form">
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
          <button type="submit" className="dash-button" disabled={submitting}>
            {submitting ? "Verifying..." : "Confirm & Sign in"}
          </button>
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.25rem" }}>
            <button
              type="button"
              className="dash-button dash-button-secondary"
              style={{ flex: 1 }}
              disabled={submitting}
              onClick={() => void handleResend()}
            >
              Resend code
            </button>
            <button
              type="button"
              className="dash-button dash-button-secondary"
              style={{ flex: 1 }}
              onClick={() => backToCredentials(null)}
            >
              Start over
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
