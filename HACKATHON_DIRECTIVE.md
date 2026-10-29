# TASK DIRECTIVE: FilsPay Codebase Remediation & Feature Completion

## 1. System Invariants & Architecture Baseline
* **Currency Standard**: The system operates exclusively in Bahraini Dinar where $1\text{ BD} = 1000\text{ fils}$[cite: 8].
* **Strict Rule (ADR-0001)**: All financial math must use whole integer fils only; never store, cast, or calculate using floating-point decimals[cite: 8].
* **Settlement Timing**: Daily settlement close must execute strictly at midnight Bahrain time (UTC+3)[cite: 8].
* **Repository Layout**[cite: 8]:
  * `apps/api/`: TypeScript / Fastify API (auth, payments, webhooks, admin)[cite: 8]
  * `apps/settlement/`: Go daemon (batch close, scheme export, splits, payouts)[cite: 8]
  * `apps/reporting/`: TypeScript consumer (outbox events to rollups)[cite: 8]
  * `apps/web/` & `apps/admin/`: React frontend interfaces[cite: 8]
  * `packages/money/`: Core integer-fils arithmetic[cite: 8]
  * `packages/events/`: Outbox event definitions[cite: 8]
  * `db/migrations/`: Postgres schemas (migrations 0001 to 0072)[cite: 8]
  * `ops/`: Docker Compose and environment definitions[cite: 8]
  * `docs/`: `ARCHITECTURE.md`, `HANDOVER.md`, and `docs/adr/`[cite: 8]
* **Fix Philosophy**: Apply the smallest surgical fix that works rather than large rewrites[cite: 8]. Provide a clear explanation of what broke, why it happened, and what was affected[cite: 8].

---

## 2. Investigation & Bug Remediation Matrix

### A. Critical Security & Authorization Vulnerabilities
* **IDOR / Cross-Tenant Access**: Fix the vulnerability allowing Merchant A to cancel payment links belonging to Merchant B from their dashboard[cite: 7]. Ensure strict tenant/merchant ID scoping on all resource mutations[cite: 7].
* **OTP Bypass**: Audit auth flows in `apps/api/` where sessions are established without validating the required OTP challenge[cite: 6, 7].
* **Webhook Signatures (FP-240)**: Resolve the signature payload discrepancy between the signing generator and the sending module[cite: 6]. Correct the validation logic on incoming signatures[cite: 6].
* **Admin Role Checks**: Audit admin API routes to ensure privileged actions enforce required role-based access control (RBAC) checks[cite: 6].

### B. High-Severity Concurrency & Race Conditions
* **Concurrent Refund Exploits (FP-209)**: Eliminate double payouts caused by concurrent refund requests[cite: 6]. Implement database-level row locking (`SELECT FOR UPDATE`) or idempotency keys[cite: 6].
* **Payment Link Double Charges (Incident 2026-05-14)**: Prevent slow network requests from letting a second buyer use an active link simultaneously[cite: 6].
* **Duplicate Acquirer Notes (FP-201)**: Fix the failure in callback handling where identical acquirer notifications generate duplicate notes[cite: 6].
* **Payout Notification Duplication (Incident 2026-08-21)**: Fix race conditions between parallel background workers claiming the same payout record[cite: 6].

### C. Ledger & Monetary Calculation Integrity
* **Split Payout Truncation**: Correct split calculations for Delta Marketplace where child allocations fail to match parent totals by tens of fils[cite: 7]. Ensure remainders are deterministically attributed[cite: 7].
* **CSV Unit Ingestion**: Fix the CSV manual adjustment parser in `packages/money/` or admin routes that converts $4.755\text{ BD}$ to $4.750\text{ fils}$ and misreads $4.75\text{ BD}$ as $0.475$ ($10\times$ off)[cite: 7].
* **Refund Cap**: Prevent refunds from exceeding the original settled amount[cite: 6].
* **Batch MDR Recalculation**: Restrict fee adjustments to open settlement batches; do not recalculate already finalized/closed batches[cite: 7].
* **Fee Discrepancy (245 bps vs. 225 bps)**: Align merchant UI display fee tables with actual billing execution tables resulting from previous backfill patches[cite: 7].
* **Balance Cache Inconsistency (FP-203)**: Resolve discrepancy between Admin "Recalculate cached balances" and the CLI rebuild tool (Alpha Retail balance variance from $135\text{K}$ to $7\text{K}$)[cite: 6, 7]. Unify cache computation to read from the authoritative ledger source[cite: 6].
* **Settlement Timing & Isolation**: Fix settlement daemon run time (executing at 3:00 AM instead of midnight local UTC+3)[cite: 7, 8]. Exclude test merchants from production settlement runs[cite: 6, 7].
* **Sweep Script Idempotency**: Make the Q1 sweep script safe against multiple runs so gaps do not double if executed more than once[cite: 7].

---

## 3. Mission FP-300: Finish the Missing Feature
* **Locate Unfinished Work**: Inspect recent git commits, unfinished migration scripts ($>0072$), or commented stubs to identify the unreleased feature left behind[cite: 8, 9].
* **End-to-End Implementation Requirements**[cite: 9]:
  1. API: Build functional endpoints handling input validation and errors[cite: 9].
  2. Ledger: Record balances with exact integer fils[cite: 8, 9].
  3. Fees & Payouts: Compute accurate deductions and outbox settlement events[cite: 9].
  4. Webhooks: Dispatch signed events to external subscriber URLs[cite: 9].
  5. Reporting & Reconciliation: Ensure all records reflect correctly in timeline views and downstream rollups[cite: 9].
* **Deployment**: Create Docker configurations and verification scripts to ship the application to Dilmune Cloud hosting[cite: 8, 9].

---

## 4. Required Output Artifacts
For every issue resolved, document findings in `EXPLANATIONS.md` using this format:
```markdown
### [Issue ID / Feature Name]
* **Root Cause**: Why the bug existed in the legacy code[cite: 8].
* **Symptom & Impact**: What broke in production/finance[cite: 8].
* **Fix Applied**: Summary of minimal code changes made[cite: 8].
* **Verification**: Unit/integration tests executed to verify the fix[ci
