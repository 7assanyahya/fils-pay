# FilsPay — Security Review & Threat Assessment

**Date:** 2026-10-30  
**Scope:** `apps/api/`, `apps/settlement/`, `apps/reporting/`, database schemas, and external interfaces.  
**Branch:** `7asn`  

---

## 1. Executive Summary

A comprehensive security review was conducted across the FilsPay payment stack, evaluating authentication, authorization, input validation, external resource handling (SSRF), cryptographic routines, and concurrency safety. All findings identified during the review and the preceding QA pass have been patched and verified with dedicated regression test suites.

---

## 2. Security Vulnerabilities Resolved

### 2.1 Server-Side Request Forgery (SSRF) in Merchant Webhooks
* **Commit:** `876aabc`
* **Files:** [`apps/api/src/webhooks/ssrfGuard.ts`](../apps/api/src/webhooks/ssrfGuard.ts), [`transport.ts`](../apps/api/src/webhooks/transport.ts), [`create.ts`](../apps/api/src/webhooks/create.ts)
* **Tests:** [`apps/api/src/webhooks/ssrfGuard.new.test.ts`](../apps/api/src/webhooks/ssrfGuard.new.test.ts)
* **Vulnerability:** Webhook registration (`POST /v1/webhooks`) validated only that URLs began with `http:` or `https:`. The code comment claiming `create.ts blocks private IPs` was false. An attacker or malicious merchant could register internal addresses (e.g. `http://settlement:8091`, `http://127.0.0.1:3000`, cloud metadata endpoints `http://169.254.169.254`, or container network addresses) and read excerpts of internal HTTP responses via delivery logs. Furthermore, the HTTP transport followed redirects and read unbounded response bodies.
* **Resolution:**
  - In production (`NODE_ENV === "production"`), endpoint creation rejects `localhost`, IPv4/IPv6 loopback (`127.0.0.0/8`, `::1`), RFC 1918 private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), IPv4 link-local (`169.254.0.0/16`), IPv6 link-local (`fe80::/10`), CGNAT (`100.64.0.0/10`), and multicast IP addresses.
  - The HTTP transport performs DNS resolution prior to dispatch and re-checks the resolved IP address against the SSRF guard before initiating the socket connection.
  - HTTP redirects are explicitly disabled (`redirect: "manual"`).
  - Response body reads are capped at 64 KiB to prevent denial-of-service via memory exhaustion.
  - Development and test environments preserve local receiver functionality for automated tests.

---

### 2.2 Account Login Throttling (Brute-Force & OTP Bypass Defense)
* **Commit:** `7bd05ab`
* **Files:** [`apps/api/src/auth/loginThrottle.ts`](../apps/api/src/auth/loginThrottle.ts), [`apps/api/src/routes/auth.ts`](../apps/api/src/routes/auth.ts), [`apps/api/src/routes/adminAuth.ts`](../apps/api/src/routes/adminAuth.ts)
* **Tests:** [`apps/api/src/auth/loginThrottle.new.test.ts`](../apps/api/src/auth/loginThrottle.new.test.ts)
* **Vulnerability:** Neither merchant nor admin login routes (`POST /v1/auth/login`, `POST /v1/admin/auth/login`) rate-limited authentication attempts. An attacker could brute-force passwords indefinitely. Furthermore, once a password was compromised, each subsequent login attempt generated a brand-new OTP challenge with a fresh 5-guess budget, allowing an attacker to bypass the per-challenge OTP limit across multiple login calls.
* **Resolution:**
  - Implemented an in-memory sliding window throttle per email account.
  - Enforced a hard limit of **10 failed password attempts** or **20 issued OTP challenges** within a **15-minute sliding window**. Exceeding thresholds returns `429 Too Many Requests` (`{"error":"too_many_login_attempts"}`).
  - Successful logins do not penalize the failure counter.
  - Throttles are partitioned strictly by normalized email; attacking one account does not impact other users.

---

### 2.3 Formula Injection (CSV Injection) in Transaction Exports
* **Commit:** `a76f610`
* **Files:** [`apps/api/src/transactions/exportCsv.ts`](../apps/api/src/transactions/exportCsv.ts)
* **Tests:** [`apps/api/src/transactions/exportCsv.formula.new.test.ts`](../apps/api/src/transactions/exportCsv.formula.new.test.ts)
* **Vulnerability:** Transaction references (`reference_id`) and metadata are free-text strings originating from merchant API clients or customer checkout payloads. When exported to CSV via `GET /v1/transactions/export`, fields beginning with formula triggers (`=`, `+`, `-`, `@`, `\t`, `\r`) could execute arbitrary spreadsheet formulas (Dynamic Data Exchange / command execution) when opened by finance operators in Microsoft Excel or Google Sheets.
* **Resolution:** Sanitized exported CSV cells: any text cell starting with `= + - @ \t \r` is prepended with a single quote (`'`), neutralizing spreadsheet formula execution. Ordinary values remain completely unmodified.

---

### 2.4 API Key Hash Leakage on Public Endpoints
* **Commit:** `8eb377d`
* **Files:** [`apps/api/src/paymentLinks/read.ts`](../apps/api/src/paymentLinks/read.ts)
* **Tests:** [`apps/api/src/paymentLinks/publicRead.new.test.ts`](../apps/api/src/paymentLinks/publicRead.new.test.ts)
* **Vulnerability:** `GET /v1/payment-links/:token` is an unauthenticated public endpoint. It previously included the merchant's secret `key_hash` in the response DTO as `merchantIntegrationId`. Although a hash, exposing credential material violates least-privilege principles and leaks persistent tenant identifiers to arbitrary buyers.
* **Resolution:** Replaced `merchantIntegrationId` with `null`. The display prefix `merchantPublicKey` was retained as required by locked tests.

---

### 2.5 Privilege Escalation: Impersonation Capture and Void
* **Commit:** `619f18a`
* **Files:** [`apps/api/src/routes/transactions.ts`](../apps/api/src/routes/transactions.ts)
* **Tests:** [`apps/api/src/routes/transactions.impersonation.new.test.ts`](../apps/api/src/routes/transactions.impersonation.new.test.ts)
* **Vulnerability:** `POST /v1/transactions/:id/capture` and `/void` enforced `requireMerchantAuth` but omitted role checks. Admin impersonation grants (which structurally assign the read-only `support` merchant role) and genuine `support` merchant users were able to capture and void transactions, moving company money without authorization.
* **Resolution:** Chained `requireMerchantRole("owner", "finance")` on both `/capture` and `/void` endpoints, preventing `support` users and impersonation sessions from triggering financial state mutations.

---

### 2.6 Expired API Key Revival via Re-Rotation
* **Commit:** `e000cf0`
* **Files:** [`apps/api/src/admin/apiKeys.ts`](../apps/api/src/admin/apiKeys.ts)
* **Tests:** [`apps/api/src/admin/apiKeysRerotate.new.test.ts`](../apps/api/src/admin/apiKeysRerotate.new.test.ts)
* **Vulnerability:** `rotateApiKeyAsAdmin` checked only whether an API key had an explicit `revoked_at` timestamp. Rotating an old key whose 24-hour grace window had expired revived the key by issuing a new key and extending `revoke_after` to `now() + 24h`, inadvertently resurrecting compromised keys.
* **Resolution:** Gated rotation to verify the target key has not already been rotated (`WHERE rotated_to_key_id IS NULL`), answering `409 api_key_already_rotated` on stale keys.

---

## 3. Audited Mechanisms Verified Secure

During the audit, the following security-critical mechanisms were inspected and verified to follow secure patterns:

1. **SQL Injection Resistance:**
   - All database queries throughout `apps/api/`, `apps/settlement/`, and `apps/reporting/` utilize parameterized placeholders (`$1`, `$2`, etc.) via `pg` and `pgx`.
   - The only dynamic SQL queries construct fixed PostgreSQL `LISTEN` channel names via sanitization, completely decoupled from user inputs.
2. **Session Cookie Hardening:**
   - Cookies (`session`, `admin_session`, `impersonation`) enforce `httpOnly: true`, `sameSite: "lax"`, and dynamically apply `secure: true` in production environments (`NODE_ENV === "production"`).
   - Session identifiers are generated using high-entropy CSPRNG tokens (`crypto.randomBytes(32)`).
3. **KYC Document Upload Security:**
   - File uploads via `POST /v1/merchants/:id/kyc` validate true file types by inspecting binary magic bytes (JPEG `FF D8 FF`, PNG `89 50 4E 47`, PDF `%PDF-`), discarding client-supplied MIME types.
   - Files are stored on disk named by their SHA-256 content hashes, neutralizing directory traversal (`../`) attacks.
4. **Idempotency Key Integrity:**
   - Financial mutations enforce unique idempotency keys validated against UUID format (`crypto.randomUUID`), preventing duplicate execution of requests.
5. **Cryptographic Randomness:**
   - All secret generation (session IDs, OTP salt/hashes, webhook signing keys, payment link slugs) uses Node.js `node:crypto` (`randomInt`, `randomBytes`).
   - `Math.random()` is confined exclusively to frontend React component list keys.

---

## 4. Residual Risks & Recommended Hardening

While the critical attack surface is secured, the following residual risks should be prioritized for upcoming release cycles:

| Risk Area | Description | Recommended Mitigation |
| :--- | :--- | :--- |
| **Compose Dev Secrets** | `ops/docker-compose.yml` and `.env.docker` contain hardcoded dev credentials (`filspay_dev_password`, dev tokens). | Inject all production database and webhook secrets via an external secrets manager (e.g. AWS Secrets Manager, HashiCorp Vault). |
| **CORS Policy** | The API issues no CORS headers, necessitating an identical-origin reverse proxy (`scripts/dev/proxy.mjs`) for frontend traffic. | Implement a structured Fastify CORS plugin allowing only explicitly allowlisted merchant dashboard domains. |
| **KYC Content-Disposition** | Download endpoints reflect the merchant's raw uploaded filename in `Content-Disposition`. | Sanitize filename characters (`[^\w.-]`) or replace with a synthetic download filename (e.g. `document-${id}.pdf`). |
| **SSRF DNS Rebinding Gap** | The SSRF check performs a pre-flight DNS lookup before `fetch` initiates its own resolution, creating a theoretical time-of-check to time-of-use (TOCTOU) DNS-rebinding window. | Configure a custom HTTP agent / dispatcher (e.g. `undici.Agent`) that binds the connection directly to the validated IP address without a secondary DNS resolution. |
| **In-Memory Rate Limiting** | Login throttles and load-shedding counters are held in process memory. Multi-replica API deployments would track attempts separately per pod. | Back rate-limiting and throttle counters with a shared Redis or Postgres cluster table when scaling past a single container instance. |
