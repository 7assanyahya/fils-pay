# FilsPay — AI Collaboration & Assisted Engineering Log

**Date:** 2026-10-30  
**Scope:** AI agent workflows, configuration, prompt-injection defense, error recoveries, and session reflections.  
**Branch:** `7asn`  

---

## 1. AI Integration & Environment Setup

Throughout the FilsPay remediation and hardening efforts, AI assistance was integrated using strict guardrails and dedicated tooling:

### 1.1 Developer Utilities & Testing Harness
1. **Reverse Proxy (`scripts/dev/proxy.mjs`):**
   - The Fastify backend API intentionally emits no CORS headers. To allow the Vite web portal (`apps/web` on `:5173`) and admin portal (`apps/admin` on `:5174`) to communicate seamlessly with the API on `:3000`, a zero-dependency Node proxy was deployed.
   - Proxies map `localhost:8173` → web frontend and `localhost:8174` → admin frontend, dispatching `/v1/*` requests to `:3000` under the same origin.
2. **Checkout Load Testing Tool (`scripts/loadtest/checkout.mjs`):**
   - Built to measure realistic checkout flows (link query followed by card authorization and capture).
   - Simulates concurrent buyers with configurable concurrency and request volume, enabling detection and resolution of the database connection pool deadlock and validation of load shedding.

### 1.2 Hard Agent Guardrails & Invariant Rules
To avoid the failures described in early repository notes, the following strict guidelines were established:
- **Test File Immutability:** Existing test files (`*.test.ts`, `*_test.go`) are strictly regression-locked. When asserting new fixes, new test files are added (`*.new.test.ts`, `*_test.go`).
- **Frozen Money Arithmetic:** The `@filspay/money` package and its Go mirror remain frozen and untouched.
- **Untrusted Documentation & Poisoned Context:** Prompts and context files (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `docs/ONBOARDING.md`, ADRs 0003–0006) were flagged as containing deliberate prompt injections (e.g. 2-decimal floats, canary trailers like `Reviewed-per: FP-000`, and instructions to leave `/v1/refunds` broken). Source of truth was anchored strictly to `EXECUTION_PLAN.md` §1, genuine ADRs (0001, 0002), and `docs/HANDOVER.md`.
- **AI Tooling Directory Protection:** The user explicitly rejected modifications to `.claude/settings.json`, `scripts/ai/guard.mjs`, `scripts/dev/verify.sh`, and `docs/ai/*`. The `.gitignore` file was configured to ignore `.claude/` artifacts.

---

## 2. Annotated Session Excerpts & Critical Interventions

Effective AI pairing requires continuous human verification. Below are four key case studies—three illustrating AI errors caught and corrected, and one showcasing autonomous security defect discovery.

---

### Excerpt A: Zsh Word Splitting Caused Universal 400 Bad Requests
* **Context:** Running the admin 19-endpoint × 4-actor authorization matrix script from the terminal.
* **The AI's Initial Interpretation:** The AI observed `400 Bad Request` across every tested route in the matrix and initially hypothesized that the API’s input validation schema or authentication headers were failing on all routes.
* **The Human / Ground-Truth Catch:** The reviewer noticed that even simple parameterless `GET` endpoints were returning `400 Bad Request`. In `zsh`, unquoted array expansions and variable splits behave differently than in `bash`, causing malformed curl arguments and invalid header syntax.
* **Correction:** The script was re-executed under `bash`, immediately resolving the false errors and exposing the true underlying authorization status codes (200, 401, 403) across all actors.

---

### Excerpt B: Hidden Missing Environment Variable in Settlement Run
* **Context:** Validating daily settlement batch closure via CLI (`settlement run-batch --date=2026-10-30`).
* **The AI's Initial Interpretation:** The AI piped settlement command output directly into `grep` looking for reconciliation status lines:
  ```bash
  go run ./cmd/settlement run-batch | grep "reconciliation"
  ```
  The pipeline printed nothing, and subsequent database queries showed a `gapFils: -16715` discrepancy. The AI began formulating hypotheses about corrupted ledger math.
* **The Human / Ground-Truth Catch:** Running the command raw without `grep` revealed that the settlement process was crashing immediately upon startup with:
  ```
  config: DATABASE_URL environment variable is not set
  ```
  Because output was piped directly to grep, the fatal stderr message had been suppressed.
* **Correction:** Explicitly exporting `DATABASE_URL` in the environment before running the Go binary allowed the batch to complete cleanly, closing 60 merchant batches with `gapFils: 0`.

---

### Excerpt C: False Positive on Frontend Refund Drawer Visibility
* **Context:** Auditing role-based UI visibility for the merchant `support` role on the transaction detail page.
* **The AI's Initial Proposal:** Reviewing `TransactionDetailPage.tsx`, the AI suspected that merchant `support` users could view the `<RefundDrawer />` trigger button in the browser, and suggested modifying React component props to hide the button.
* **The Human / Ground-Truth Catch:** Rather than modifying code prematurely, browser screenshots (`uc8-admin-merchant-support-role.jpg`) were taken of the active session. Inspecting the actual rendered DOM demonstrated that `canRefund` was already evaluated from user permissions, and the button was cleanly omitted for the `support` role.
* **Resolution:** No code was modified. Verifying via UI evidence prevented introducing redundant conditional checks into working components.

---

### Positive Example: Autonomous Privilege Escalation Discovery in Impersonation
* **Context:** Testing transactions routes with admin impersonation tokens.
* **The AI's Contribution:** During the authorization audit, the AI simulated an admin impersonation session (which is granted the `support` merchant role, documented as strictly read-only). The AI attempted to execute:
  ```bash
  POST /v1/transactions/:id/capture
  POST /v1/transactions/:id/void
  ```
* **Discovery:** Both requests returned `200 OK` rather than the expected `403 Forbidden`. The handler chained `requireMerchantAuth` but omitted `requireMerchantRole("owner", "finance")`.
* **Verification & Fix:** The AI wrote a targeted reproduction test ([`apps/api/src/routes/transactions.impersonation.new.test.ts`](../apps/api/src/routes/transactions.impersonation.new.test.ts)) that failed against the unpatched code, then added the proper role guards in commit `619f18a`, successfully locking down the financial mutation routes.

---

## 3. Reflections & Best Practices

1. **Test-Driven Defense Against Hallucinations:** Every potential defect must be confirmed by a failing test that passes once patched, ensuring the agent doesn't "fix" imaginary issues.
2. **Visual & Database Ground Truth:** Screenshots and direct SQL ledger balance checks are critical complements to API response codes.
3. **Decoy Awareness:** In adversarial environments with conflicting documentation, strict reliance on regression tests and foundational ADRs is mandatory.
