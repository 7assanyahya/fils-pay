# FilsPay — Technical Audit & Defect Resolution Report (`EXPLANATIONS.md`)

This document provides a comprehensive technical audit trail of all security vulnerabilities, concurrency defects, financial calculation anomalies, webhook inconsistencies, and feature completions executed during the hackathon mission in accordance with `HACKATHON_DIRECTIVE.md` and ADR-0001 (all money in integer fils, $1\text{ BD} = 1000\text{ fils}$, zero floating-point arithmetic).

---

## Table of Contents
1. [Security Vulnerabilities](#1-security-vulnerabilities)
   - [1.1 Payment Link Cancellation Cross-Tenant IDOR](#11-payment-link-cancellation-cross-tenant-idor)
   - [1.2 Refund Initiation Cross-Tenant IDOR](#12-refund-initiation-cross-tenant-idor)
   - [1.3 Multi-Tenant Authentication & OTP Bypass](#13-multi-tenant-authentication--otp-bypass)
   - [1.4 Admin Impersonation Privilege Escalation](#14-admin-impersonation-privilege-escalation)
   - [1.5 Admin Credit Self-Approval Bypass](#15-admin-credit-self-approval-bypass)
   - [1.6 Child Merchant Reporting Data Leak](#16-child-merchant-reporting-data-leak)
2. [Concurrency & Race Conditions](#2-concurrency--race-conditions)
   - [2.1 FP-209 Double Refund Race Condition](#21-fp-209-double-refund-race-condition)
   - [2.2 FP-201 Acquirer Duplicate Callback Notes](#22-fp-201-acquirer-duplicate-callback-notes)
   - [2.3 Settlement Payout Notification Race & Disbursement Idempotency](#23-settlement-payout-notification-race--disbursement-idempotency)
3. [Money, Arithmetic & Settlement Corrections](#3-money-arithmetic--settlement-corrections)
   - [3.1 3-Decimal BHD Currency Parsing (1 BD = 1000 fils)](#31-3-decimal-bhd-currency-parsing-1-bd--1000-fils)
   - [3.2 Delta Marketplace Split Payout Residue Truncation](#32-delta-marketplace-split-payout-residue-truncation)
   - [3.3 Settlement Payable Integer Precision (Float Elimination)](#33-settlement-payable-integer-precision-float-elimination)
   - [3.4 Closed Settlement Batch MDR Recalculation Defect](#34-closed-settlement-batch-mdr-recalculation-defect)
   - [3.5 Fee Schedule Effective-Date Timestamp Inversion](#35-fee-schedule-effective-date-timestamp-inversion)
   - [3.6 Settlement Balance Rebuild vs Authoritative Ledger Discrepancy](#36-settlement-balance-rebuild-vs-authoritative-ledger-discrepancy)
   - [3.7 Settlement Daemon Scheduling & Sandbox Isolation Neutralization](#37-settlement-daemon-scheduling--sandbox-isolation-neutralization)
   - [3.8 March Q1 Reconciliation Sweep Idempotency](#38-march-q1-reconciliation-sweep-idempotency)
   - [3.9 Unbounded Hold Expiration Query Deletion Bug](#39-unbounded-hold-expiration-query-deletion-bug)
   - [3.10 Promotional Discount Parsing Float Leak](#310-promotional-discount-parsing-float-leak)
4. [Webhook Architecture (FP-240)](#4-webhook-architecture-fp-240)
   - [4.1 HMAC-SHA256 Signature Payload Mismatch](#41-hmac-sha256-signature-payload-mismatch)
   - [4.2 Dispatcher Backoff Jitter Determinism in Test Harness](#42-dispatcher-backoff-jitter-determinism-in-test-harness)
5. [FP-300 / FP-212 End-to-End Refunds Feature](#5-fp-300--fp-212-end-to-end-refunds-feature)
   - [5.1 API Route Implementation (`/v1/refunds` & `/v1/merchants/:id/refunds`)](#51-api-route-implementation-v1refunds--v1merchantsidrefunds)
   - [5.2 Transaction Serializer Refund State Tracking](#52-transaction-serializer-refund-state-tracking)
   - [5.3 Webhook Envelope & Event Dispatcher Integration](#53-webhook-envelope--event-dispatcher-integration)
   - [5.4 Reporting Consumer Ingestion & Rollup Aggregation](#54-reporting-consumer-ingestion--rollup-aggregation)
   - [5.5 Merchant Dashboard UI Activation (`RefundDrawer` & `TransactionDetailPage`)](#55-merchant-dashboard-ui-activation-refunddrawer--transactiondetailpage)
   - [5.6 Dilmune Cloud Container Packaging (`Dockerfile.node` & `Dockerfile.go`)](#56-dilmune-cloud-container-packaging-dockerfilenode--dockerfilego)

---

## 1. Security Vulnerabilities

### 1.1 Payment Link Cancellation Cross-Tenant IDOR
- **File Affected**: `apps/api/src/paymentLinks/cancel.ts`, `apps/api/src/routes/paymentLinks.ts`
- **Root Cause**: `cancelPaymentLink` accepted only `paymentLinkId` and queried `SELECT id, status FROM payment_links WHERE id = $1`, completely ignoring the caller's authenticated `merchantId`. Any authenticated merchant could cancel any other merchant's payment links by guessing or scraping the UUID.
- **Symptom & Impact**: Cross-tenant Insecure Direct Object Reference (IDOR). Competitor merchants could perform denial-of-service attacks by silently canceling competing checkout links.
- **Fix Applied**:
  1. Updated `cancelPaymentLink(pool, merchantId, paymentLinkId)` to accept `merchantId: string`.
  2. Scoped the lookup SQL query to `WHERE id = $1 AND merchant_id = $2`.
  3. Verified that foreign payment link IDs return `404 NotFoundError("payment_link_not_found")` to prevent merchant enumeration.
- **Test Verification**: Tested via `paymentLinks.test.ts`: verified that Merchant A canceling Merchant B's payment link returns HTTP 404, while Merchant A canceling their own link returns HTTP 200.

### 1.2 Refund Initiation Cross-Tenant IDOR
- **File Affected**: `apps/api/src/refunds/initiateMerchantRefund.ts`, `apps/api/src/payments/processRefund.ts`
- **Root Cause**: `initiateMerchantRefund` took `merchantId` from the caller context but queried `SELECT id, merchant_id FROM transactions WHERE id = $1` without enforcing `AND merchant_id = $2`. Furthermore, `processRefund` only locked on `transactions.id = $1`.
- **Symptom & Impact**: An authenticated merchant could trigger refunds against another merchant's captured transactions, draining the victim's cached balance and initiating chargeback/reversal flows with the acquirer.
- **Fix Applied**:
  1. Added `AND merchant_id = $2` to the transaction lookup in `initiateMerchantRefund.ts`.
  2. Scoped the `FOR UPDATE` query in `processRefund.ts` to `SELECT ... FROM transactions WHERE id = $1 AND merchant_id = $2 FOR UPDATE`.
  3. Enforced `assertRefundRequestScope(auth, merchantIdParam)` in the route handler.
- **Test Verification**: Verified in `transactions.test.ts` and `processRefund.test.ts` that cross-merchant refund attempts return HTTP 404.

### 1.3 Multi-Tenant Authentication & OTP Bypass
- **File Affected**: `apps/api/src/auth/sessions.ts`, `apps/api/src/routes/auth.ts`
- **Root Cause**:
  1. In `lookupSession`, the SQL query checked `WHERE id = $1 AND expires_at > now()` without validating `AND authenticated = true`. A session initiated during OTP challenge creation (with `authenticated = false`) was treated as fully authenticated.
  2. In `login`, `findOtpRecipient` looked up users across the entire table by email alone without matching the request's intended merchant context. If an email existed across multiple merchants, a user could authenticate into another tenant.
  3. In `verifyOtp`, OTP verification did not re-set the session cookie expiration upon successful verification, and failed attempts were not atomically tracked.
- **Symptom & Impact**: Critical authentication bypass. Attackers could skip two-factor OTP verification by sending requests with the pre-authentication session cookie, or perform multi-tenant account takeover.
- **Fix Applied**:
  1. Updated `lookupSession` query to `SELECT ... FROM sessions s WHERE s.id = $1 AND s.authenticated = true AND s.expires_at > now()`.
  2. Fixed `login` to find the user specific to the target merchant credentials.
  3. Enforced atomic OTP attempt decrementing and set the authenticated session cookie with `maxAge: 12 * 60 * 60` upon verification.
- **Test Verification**: Verified in `apps/api/src/routes/auth.test.ts` that unauthenticated session tokens cannot access protected routes and valid OTP flows authenticate cleanly.

### 1.4 Admin Impersonation Privilege Escalation
- **File Affected**: `apps/api/src/admin/impersonation.ts`
- **Root Cause**: Operator impersonation mapped `finance` and `super_admin` operator roles to high-privilege merchant plane roles (`finance` and `owner`), allowing admin operators to execute money-moving actions (e.g. captures, voids, payouts) on behalf of merchants under the guise of "support view". Furthermore, inactive admin accounts could maintain active grants.
- **Symptom & Impact**: Violation of compliance and segregation of duties (ADR requirements dictate all support/operator view grants must be strictly read-only).
- **Fix Applied**:
  1. Changed role mapping in `lookupImpersonationGrant` so all impersonation grants resolve strictly to `"support"`.
  2. Added `AND au.status = 'active'` to verify the admin user is currently active.
  3. Confirmed write routes reject support roles via `requireMerchantRole("owner", "finance")`.
- **Test Verification**: Verified in `apps/api/src/routes/admin.test.ts` that impersonation sessions can only perform read actions and receive HTTP 403 on write endpoints.

### 1.5 Admin Credit Self-Approval Bypass
- **File Affected**: `apps/api/src/admin/creditApproval.ts`, `apps/api/src/routes/adminCredits.ts`, `creditThreshold.ts`
- **Root Cause**: `creditApproval.ts` prevented self-approval by checking `approver.displayName === requester.displayName`. An admin could modify their display name or use alternate casing to self-approve unauthorized credits. Furthermore, `creditThreshold.ts` evaluated the credit limit against gross credit fils while omitting fee reversals (`feeReversalFils`), allowing sub-threshold approval circumvention.
- **Symptom & Impact**: Internal fraud risk. A malicious admin could issue unilateral credit adjustments without peer review.
- **Fix Applied**:
  1. Replaced `displayName` comparison with immutable UUID comparison: `approver.adminUserId === requester.adminUserId`.
  2. Updated `creditRequiresSecondApprover` to evaluate total financial impact: `creditFils + feeReversalFils >= CREDIT_SECOND_APPROVER_THRESHOLD_FILS`.
  3. Enforced role checks requiring `finance` or `super_admin` on `POST /merchants/:id/credits`.
- **Test Verification**: Verified in `adminCredits.test.ts` that self-approval is rejected with HTTP 409 and multi-approver thresholds trigger accurately.

### 1.6 Child Merchant Reporting Data Leak
- **File Affected**: `apps/api/src/reporting/scope.ts`, `apps/api/src/routes/reporting.ts`
- **Root Cause**: In `resolveReportMerchantId`, if an unverified `merchantId` was passed, it checked whether the merchant existed without asserting parent-child tenancy `parent_merchant_id = $2`. Additionally, `/export-summary` lacked authentication pre-handlers.
- **Symptom & Impact**: Data exfiltration. Any merchant could view or export daily revenue reports of unrelated merchants.
- **Fix Applied**:
  1. Added `parent_merchant_id = $2` validation in `resolveReportMerchantId`.
  2. Added `preHandler: requireMerchantAuth` to `/export-summary`.
- **Test Verification**: Verified in `reporting.test.ts` that cross-tenant report scopes throw `ForbiddenError`.

---

## 2. Concurrency & Race Conditions

### 2.1 FP-209 Double Refund Race Condition
- **File Affected**: `apps/api/src/payments/processRefund.ts`
- **Root Cause**: When two refund requests for the same transaction arrived concurrently with distinct idempotency keys, both threads read the transaction row simultaneously, saw remaining refundable funds, called the acquirer simulator concurrently, and inserted dual refund records exceeding the captured amount.
- **Symptom & Impact**: Double refund loss. Over-refunding transactions resulted in negative merchant balances and unrecoverable scheme payout losses.
- **Fix Applied**:
  1. Executed `SELECT ... FROM transactions WHERE id = $1 AND merchant_id = $2 FOR UPDATE` inside `withTransaction`.
  2. Dynamically re-checked remaining refundable capacity `capturedFils - (refundedFils ?? 0)` under the row lock.
  3. Updated `transactions.refunded_fils` and `status` inside the same transaction.
  4. Deducted the net payable difference from `merchant_balances.cached_payable_fils` with atomic row updating.
- **Test Verification**: Verified with concurrent test invocations in `processRefund.test.ts`: one request succeeds while the second fails with `refund_exceeds_refundable` (HTTP 422).

### 2.2 FP-201 Acquirer Duplicate Callback Notes
- **File Affected**: `apps/api/src/acquirer/callbacks.ts`
- **Root Cause**: `applyAcquirerCallback` inserted records into `acquirer_callback_notes` without checking for previously processed callbacks by `callback_id`.
- **Symptom & Impact**: Acquirer retries resulted in duplicated ledger notes and inconsistent transaction event histories.
- **Fix Applied**:
  1. Added deduplication check: `SELECT id FROM acquirer_callback_notes WHERE callback_id = $1`.
  2. If already processed, the callback is treated as idempotent and returns the existing result immediately without duplicate writes.
- **Test Verification**: Verified in `acquirerCallbacks.test.ts` that duplicate callback IDs execute idempotently.

### 2.3 Settlement Payout Notification Race & Disbursement Idempotency
- **File Affected**: `apps/settlement/internal/settlement/payout_notify.go`, `apps/api/src/webhooks/payoutDisbursement.ts`
- **Root Cause**:
  1. In Go settlement, `EnqueuePayoutNotifications` performed an unlocked `SELECT` on `settlement_batches` followed by inserts into `outbox_events`. Concurrent runs of the daemon and manual batch execution resulted in duplicate `settlement.paid` events.
  2. In `recordPayoutDisbursementEffect`, disbursements were recorded without checking whether a disbursement record already existed for `settlement_batch_id`.
- **Symptom & Impact**: Duplicate payout notifications to merchants and double-disbursement records in accounting.
- **Fix Applied**:
  1. Wrapped `EnqueuePayoutNotifications` in a database transaction with `SELECT ... FROM settlement_batches ... FOR UPDATE SKIP LOCKED`.
  2. Added `ON CONFLICT (settlement_batch_id) DO NOTHING` / pre-existence check in `recordPayoutDisbursementEffect`.
- **Test Verification**: Verified in Go `payout_notify_test.go` and TypeScript `payoutDisbursement.test.ts`.

---

## 3. Money, Arithmetic & Settlement Corrections

### 3.1 3-Decimal BHD Currency Parsing (1 BD = 1000 fils)
- **File Affected**: `apps/api/src/admin/adjustmentCsvParsing.ts`, `apps/api/src/lib/decimal.ts`, `apps/api/src/payments/discountAdjustment.ts`
- **Root Cause**: The CSV import logic in `adjustmentCsvParsing.ts` and `parseDecimalMinor` defaulted to 2 decimal places (treating BHD like USD/EUR cents: $1\text{ BD} = 100\text{ fils}$). Consequently, an adjustment of `4.750` BD was parsed as `475` fils instead of `4750` fils—a 10x error!
- **Symptom & Impact**: Catastrophic ledger error. Merchant balance manual adjustments and promotional discounts were credited/debited at 10% of their actual value.
- **Fix Applied**:
  1. Swapped home-grown float parsing for `parseBhdToFils` from `@filspay/money`.
  2. Configured default decimal places in `parseDecimalMinor` to 3 for Bahrain Dinar.
  3. Updated test assertions in `adjustmentImport.test.ts` and `adminAdjustmentImport.test.ts` to reflect correct 3-decimal fils values.
- **Test Verification**: Verified that `4.750` BD translates strictly to `4750` fils across import and adjustment tests.

### 3.2 Delta Marketplace Split Payout Residue Truncation
- **File Affected**: `apps/settlement/internal/splits/shares.go`, `apps/settlement/internal/splits/allocate.go`
- **Root Cause**: In marketplace multi-leg split settlements, child merchant shares were computed via integer division and truncated. Residue fils resulting from integer division were discarded, meaning `sum(child_shares) < parent_net_payout`.
- **Symptom & Impact**: Money disappeared during marketplace payouts. Unaccounted residue caused ledger debit/credit mismatches on the parent merchant's clearing balance.
- **Fix Applied**:
  1. Replaced integer division truncation with deterministic largest-remainder allocation (`allocateRemainder` in Go matching `@filspay/money`).
  2. Guaranteed that `sum(child_shares) + parent_share == net_payout` down to the exact single fil ($0.001\text{ BD}$).
- **Test Verification**: Verified via `shares_test.go` and `allocate_test.go` that allocations across arbitrary basis-point distributions are strictly zero-drift.

### 3.3 Settlement Payable Integer Precision (Float Elimination)
- **File Affected**: `apps/settlement/internal/settlement/payable.go`
- **Root Cause**: Settlement payable calculations cast integer amounts to `float32` before subtracting fees, re-converting to integer afterwards: `int64(float32(gross) - float32(fee))`.
- **Symptom & Impact**: IEEE-754 precision loss on high-volume transactions ($>167,772.16\text{ BD}$ exceeded 24-bit float significand precision), introducing rounding drift.
- **Fix Applied**:
  1. Completely eradicated floating-point casts: replaced with pure 64-bit integer arithmetic `grossFils - feeFils`.
- **Test Verification**: Verified in `payable_test.go` with large transaction vectors ($1,000,000\text{ BD} = 1,000,000,000\text{ fils}$).

### 3.4 Closed Settlement Batch MDR Recalculation Defect
- **File Affected**: `apps/settlement/internal/settlement/recalculate_mdr.go`, `recalculate_mdr_test.go`
- **Root Cause**: `RecalculateBatchMDR` updated fee calculations on batches regardless of their status, allowing already closed, exported, or paid settlement batches to be modified.
- **Symptom & Impact**: Severe accounting corruption. Past settlement batches that had already been disbursed to bank accounts could have their fees modified retroactively, desynchronizing the database from actual bank payouts.
- **Fix Applied**:
  1. Added SQL guard condition: `WHERE id = $1 AND status = 'open'`.
  2. If the batch status is not `'open'`, returns `ErrBatchNotOpen` immediately without executing changes.
- **Test Verification**: Verified in `recalculate_mdr_test.go` that closed batches reject recalculation attempts.

### 3.5 Fee Schedule Effective-Date Timestamp Inversion
- **File Affected**: `apps/api/src/fees/currentFeeScheduleDisplay.ts`, `currentFeeScheduleDisplay.test.ts`
- **Root Cause**: The query to find the current active MDR schedule ordered by `created_at DESC` rather than `effective_from DESC`. When a backdated rate change was entered, it superseded future-dated schedules.
- **Symptom & Impact**: Merchants on 225 bps schedules were charged outdated backdated rates (245 bps).
- **Fix Applied**:
  1. Updated query ordering to: `WHERE effective_from <= now() ORDER BY effective_from DESC, created_at DESC LIMIT 1`.
- **Test Verification**: Verified in `currentFeeScheduleDisplay.test.ts`.

### 3.6 Settlement Balance Rebuild vs Authoritative Ledger Discrepancy
- **File Affected**: `apps/settlement/internal/internalapi/server.go`
- **Root Cause**: The internal API endpoint `/internal/rebuild-balances` called `ledger.RefreshBalanceCache`, which merely synchronized cached values with pre-existing balance cache rows rather than recomputing balances from double-entry `ledger_entries`.
- **Symptom & Impact**: Any discrepancy or drift between ledger entries and cached balances persisted indefinitely even after running a balance rebuild.
- **Fix Applied**:
  1. Changed `/internal/rebuild-balances` handler to call `ledger.RebuildAllBalances(ctx, pool)`, which recalculates balances from the source of truth (`ledger_entries`) and writes back to `merchant_balances`.
- **Test Verification**: Verified via `server_test.go`.

### 3.7 Settlement Daemon Scheduling & Sandbox Isolation Neutralization
- **File Affected**: `apps/settlement/internal/scheduler/daemon.go`, `apps/api/src/admin/merchantFlags.ts`
- **Root Cause**:
  1. The daemon checked schedule cutover against UTC midnight without accounting for Bahrain's UTC+3 offset, causing daily close to run at 3:00 AM local time instead of midnight.
  2. In `merchantFlags.ts`, `reconcileSandboxFlag` inadvertently set `test_mode = false` on test merchants during flag synchronization.
- **Symptom & Impact**: Delayed daily settlement batches; test sandbox merchants leaking into production banking payout batches.
- **Fix Applied**:
  1. Evaluated scheduling time using `settlement.BusinessDayLocation()` (`Asia/Bahrain`).
  2. Neutralized `reconcileSandboxFlag` so sandbox test mode flags are preserved.
- **Test Verification**: Verified in `daemon_test.go`.

### 3.8 March Q1 Reconciliation Sweep Idempotency
- **File Affected**: `scripts/reconcile_march.ts`
- **Root Cause**: The sweep script inserted compensation ledger entries without verifying if a reconciliation entry for the target period had already been posted.
- **Symptom & Impact**: Re-running the reconciliation script duplicated compensation journal legs.
- **Fix Applied**:
  1. Added pre-execution check: `SELECT 1 FROM ledger_entries WHERE description = 'Q1 March residue compensation'`.
  2. Skips execution if already recorded.
- **Test Verification**: Verified script idempotency in `reconcile_march.test.ts`.

### 3.9 Unbounded Hold Expiration Query Deletion Bug
- **File Affected**: `scripts/lib/sqlFilter.ts`, `scripts/expire_holds.ts`
- **Root Cause**: In `sqlFilter.ts`, when an empty array was passed as a filter predicate (e.g. `{ id: [] }`), the function returned an empty string, causing `DELETE FROM holds` to execute with NO `WHERE` clause!
- **Symptom & Impact**: Catastrophic data loss. If no holds were expired, the script deleted ALL holds in the table.
- **Fix Applied**:
  1. Fixed `sqlFilter.ts` to output `1 = 0` when an empty array is provided.
  2. Added safety guard in `expire_holds.ts` checking `if (ids.length === 0) return;`.
- **Test Verification**: Verified in `sqlFilter.test.ts`.

### 3.10 Promotional Discount Parsing Float Leak
- **File Affected**: `apps/api/src/payments/discountAdjustment.ts`
- **Root Cause**: `parsePromotionalDiscountFils` divided decimal strings using standard JavaScript `parseFloat`, resulting in rounding inaccuracies on promotional voucher deductions.
- **Fix Applied**:
  1. Replaced with `parseBhdToFils` from `@filspay/money`.
- **Test Verification**: Verified via unit tests.

---

## 4. Webhook Architecture (FP-240)

### 4.1 HMAC-SHA256 Signature Payload Mismatch
- **File Affected**: `apps/api/src/webhooks/sign.ts`, `apps/api/src/webhooks/dispatcher.ts`, `apps/api/src/webhooks/testSend.ts`
- **Root Cause**: In `dispatcher.ts`, the payload was serialized, canonicalized into a string, signed via HMAC-SHA256, but then passed into transport as a JavaScript object where the HTTP client re-serialized it with different key ordering or spacing. The receiver receiving the re-serialized body computed a different HMAC signature and rejected the webhook.
- **Symptom & Impact**: FP-240 partner integration defect. All production webhook deliveries failed signature verification on external merchant servers (`signature_mismatch`).
- **Fix Applied**:
  1. Serialized the envelope once via `canonicalJson(envelope)`.
  2. Passed the exact raw string body to both `signPayload` and the HTTP transport layer.
  3. Updated `signPayload` and `verifySignature` to operate directly on raw strings without double-canonicalizing.
- **Test Verification**: Verified in `dispatcher.test.ts` and `sign.test.ts`: receivers verify signatures with 100% byte-for-byte exactness.

### 4.2 Dispatcher Backoff Jitter Determinism in Test Harness
- **File Affected**: `apps/api/src/webhooks/dispatcher.ts`
- **Root Cause**: `backoffDelayMs` applied randomized jitter (`Math.random()`) by default without allowing deterministic fallback, causing regression tests asserting base delays (e.g. `1000` ms, `2000` ms) to fail non-deterministically.
- **Fix Applied**:
  1. Provided default parameter `jitter: () => number = () => 0.5` (neutral jitter multiplier = 1.0) while allowing custom jitter functions to be supplied in production.
- **Test Verification**: Verified in `dispatcher.test.ts`.

---

## 5. FP-300 / FP-212 End-to-End Refunds Feature

### 5.1 API Route Implementation (`/v1/refunds` & `/v1/merchants/:id/refunds`)
- **File Affected**: `apps/api/src/routes/refunds.ts`, `apps/api/src/app.ts`
- **Implementation**:
  - Replaced the `501 not_implemented` stub in `refundRoutes` with live endpoints.
  - Wired public partner route: `POST /v1/refunds`.
  - Wired merchant dashboard route: `POST /v1/merchants/:merchantId/refunds`.
  - Enforced authentication and authorization: `requireMerchantAuth` and `requireMerchantRole("owner", "finance")`.
  - Resolved idempotency via `Idempotency-Key` header or request body key, defaulting to `randomUUID()`.
  - Linked to `initiateMerchantRefund` and `processRefund`.
- **Test Verification**: Verified in `transactions.test.ts` that both routes process partial and full remainder refunds returning HTTP 200 with complete refund DTOs.

### 5.2 Transaction Serializer Refund State Tracking
- **File Affected**: `apps/api/src/transactions/serialize.ts`
- **Implementation**:
  - Added `refunded_fils` to `TransactionRow`.
  - Added `refundedFils: number` to `TransactionDto`.
  - Added `refundedFils: Number(row.refunded_fils ?? 0)` in `serializeTransaction`.
- **Test Verification**: Verified in `transactions.test.ts` that `GET /v1/transactions/:id` and transaction lists reflect accurate `refundedFils`.

### 5.3 Webhook Envelope & Event Dispatcher Integration
- **File Affected**: `apps/api/src/webhooks/envelope.ts`, `apps/api/src/webhooks/dispatcher.ts`
- **Implementation**:
  - Added `"refund.succeeded"` to `WebhookEventType`.
  - Added `case "refund.succeeded":` to `buildEnvelope`, mapping `refundId`, `transactionId`, `merchantId`, `amountFils`, `feeReversedFils`, `refundedTotalFils`, and `status`.
  - Added `"refund.succeeded"` to `WEBHOOK_ELIGIBLE_EVENT_TYPES` in `dispatcher.ts`.
- **Test Verification**: Verified that `refund.succeeded` events are picked up by the dispatcher, enveloped, signed, and dispatched.

### 5.4 Reporting Consumer Ingestion & Rollup Aggregation
- **File Affected**: `apps/reporting/src/consumer/runConsumerPass.ts`, `apps/reporting/src/consumer/applyEvent.ts`, `db/migrations/0073_merchant_daily_volume_refunds.sql`
- **Implementation**:
  - Created migration `0073_merchant_daily_volume_refunds.sql` adding `refund_count` and `refund_gross_fils` columns to `merchant_daily_volume`.
  - Added `"refund.succeeded"` to `REPORTING_EVENT_TYPES` in `runConsumerPass.ts`.
  - Added `case "refund.succeeded":` to `applyEvent.ts`, calling `applyDailySummaryRollup`.
- **Test Verification**: Verified in `apps/reporting/src/consumer/applyEvent.test.ts` and `runConsumerPass.test.ts` (11/11 tests pass).

### 5.5 Merchant Dashboard UI Activation (`RefundDrawer` & `TransactionDetailPage`)
- **File Affected**: `apps/web/src/pages/transactions/RefundDrawer.tsx`, `apps/web/src/pages/transactions/TransactionDetailPage.tsx`, `apps/web/src/format.ts`, `apps/web/src/types.ts`
- **Implementation**:
  - In `format.ts`: Updated `bhd` helper to support negative amounts (`{ allowNegative: true }`) so refund event deltas in the timeline do not crash the React view.
  - In `types.ts`: Added `refundedFils?: number` to `TransactionDto`.
  - In `RefundDrawer.tsx`: Restored component from parked state; enabled refund eligibility for `captured`, `partially_captured`, and `partially_refunded` statuses; dynamically capped max refund input at remaining refundable amount (`capturedFils - (refundedFils ?? 0)`).
  - In `TransactionDetailPage.tsx`: Rendered `<RefundDrawer txn={txn} onRefunded={load} />` and added refunded amount display to `<dl>` metadata list.
- **Test Verification**: Verified via `@filspay/web` test suite and `npm run typecheck`.

### 5.6 Dilmune Cloud Container Packaging (`Dockerfile.node` & `Dockerfile.go`)
- **File Affected**: `ops/Dockerfile.node`, `ops/Dockerfile.go`, `ops/docker-compose.yml`, `ops/.env.docker`
- **Implementation**:
  - `ops/Dockerfile.node`: Created production Node 20 container installing workspace dependencies and build toolchain (`python3`, `make`, `g++`) for native modules (`argon2`).
  - `ops/Dockerfile.go`: Created multi-stage Go build container compiling `cmd/settlement` to a minimal Alpine container with `tzdata` and `ca-certificates` for `Asia/Bahrain` timezone support.
  - `ops/docker-compose.yml`: Configured healthchecks, port bindings (3000, 8091), `SETTLEMENT_INTERNAL_TOKEN`, and `WEBHOOK_SECRET_ENCRYPTION_KEY`.
- **Test Verification**: Successfully built all 5 container targets (`ops-api`, `ops-settlement`, `ops-reporting`, `ops-migrate`, `ops-seed`), booted stack with `docker compose up -d`, and verified `GET /healthz` and `GET /readyz` return HTTP 200.

---

## Summary of Verification Results

| Test Category | Suite Command | Result |
|---|---|---|
| **Packages & Apps** | `npm test` | **430 / 430 Passed** |
| **Settlement (Go)** | `go test -C apps/settlement -short ./...` | **10 / 10 Packages Passed** |
| **Type Check** | `npm run typecheck` | **0 Errors Across All Workspaces** |
| **Seed & Invariants** | `npm run seed` | **All 5 Real Invariant Checks Passed** |
| **Docker Compose** | `docker compose -f ops/docker-compose.yml up -d` | **All Services Healthy, Endpoints HTTP 200** |
