# Audit of `hackathon-resolution` (commit 90341b3) — 2026-10-30

Checked every item from the three handouts (briefing card, finance memo, incident log) against the code on this branch.
Where CLAUDE.md conflicts with the ADRs/briefing, the ADRs/briefing were treated as correct.

Legend: ✅ fixed correctly · ⚠️ partly fixed · ❌ not fixed · 🔻 broken by 90341b3

## 1. Build and test claims

| | Finding |
|---|---|
| 🔻 | **Test suites silently skipped.** `apps/api`, `apps/reporting`, `apps/web` test scripts pass `"src/**/*.test.ts"` as a quoted glob; Node 20 (local and `ops/Dockerfile.node`) can't expand it, so `npm test` exits after money/events. The commit's "430/430 pass" never ran the API suite. Fix: unquote the glob or pin Node ≥ 22. |
| 🔻 | **Real results** (globs expanded by shell): API 362/362 with the API process stopped; **reporting 7/11**; **Go: 3 MDR tests fail**; money, events, web, scripts all pass. |
| 🔻 | **Applied migrations were edited** (0054, 0055, 0072). The runner skips by filename, so existing databases never got the changes; the local DB still has the old `merchant_payable_position` and the 0072 view with `t.id = r.id`. Fix: restore the originals, put corrections in a new `0074_*.sql`. |

## 2. Security / auth

| Item | Status | Evidence → minimal fix |
|---|---|---|
| Login without OTP | ✅ | `lookupSession` now requires `authenticated = true` (`auth/sessions.ts`). |
| OTP sent to wrong recipient | ✅ | `findOtpRecipient` fallback removed (`routes/auth.ts`). |
| OTP codes use `Math.random()` | ❌ | `lib/random.ts` `randomDigits` → use `crypto.randomInt`. Admin OTP reuses it; its comment falsely says `crypto.randomInt`. |
| OTP attempt limit raceable | ❌ | `routes/auth.ts` and `routes/adminAuth.ts`: read `attempt_count`, compare, then increment → parallel guesses bypass the limit of 5. Fix: atomic `UPDATE … SET attempt_count = attempt_count+1 WHERE … AND attempt_count < max_attempts RETURNING` before comparing. |
| Payment-link tokens and admin invite codes use `Math.random()` | ❌ | `paymentLinks/create.ts` (bearer token for `/pay/:token`), `admin/inviteCode.ts` → `crypto.randomBytes`/`randomInt`. CLAUDE.md's "Math.random is fine for slugs/OTP" is wrong. |
| Cancel another merchant's payment link | ✅ | `cancelPaymentLink` now scoped by `merchant_id`. |
| FP-203 paid after expiry | ❌ | `paymentLinks/pay.ts` `expiryReferenceTime(input.submittedAt)` — expiry is checked against a client-supplied timestamp. Fix: `expires_at > now()`. |
| Admin role checks | ✅ mostly | Every money-moving admin route has `requireAdminRole("finance","super_admin")`; credit creation gate added. Impersonation is any-role by design (grants are now always view-only `support`; disabled admins' grants stop working). CLAUDE.md's "super_admin gate in middleware" claim is false, but harmless now. |
| Key rotation | ❌ | `admin/apiKeys.ts` `rotateApiKeyAsAdmin` says "revoke + reissue" but never revokes; `issueApiKeyInTx` only records `rotated_from_key_id`. Old key keeps working. Fix: `UPDATE api_keys SET revoked_at = now() WHERE id = $1` in the same transaction. |
| Webhook signature mismatch | ✅ | Dispatcher and test-send now sign and send the same `canonicalJson` bytes. (Side effect: backoff jitter replaced with constant 0.5 — minor regression.) |
| Inbound acquirer callback signature | ❌ | `webhooks/inboundVerify.ts`: a missing header is accepted (`ACQUIRER_CALLBACK_REQUIRE_SIGNATURE` defaults false, even in prod); HMAC is computed over `JSON.stringify(parsedBody)` instead of the raw bytes; no timestamp freshness check (replayable); non-constant-time compare. |
| Duplicate callback notes | ⚠️ | Check-then-insert added in `acquirer/callbacks.ts`; two concurrent deliveries still both insert. Fix: unique index on `acquirer_callback_notes(callback_id)` + `ON CONFLICT DO NOTHING` (new migration). |
| Reporting split-child IDOR, unauthenticated `/export-summary` | ✅ | Both fixed in the commit. |

## 3. Money / settlement

| Item | Status | Evidence → minimal fix |
|---|---|---|
| CSV import `4.75` → 0.475 BD | ✅ | Uses `parseBhdToFils`: `4.75`→4750, `4.755`→4755, `-0.35`→-350. |
| Dashboard 245 bps vs charged 225 bps | ✅ | `currentFeeScheduleDisplay.ts` now picks the latest `effective_from <= now()`. |
| Scheme total always a few fils higher | ⚠️ | Export `amount` now derives from the truncated value (`batch.go`). But ADR-0002's per-line residue journal (`card_scheme_clearing` / `scheme_rounding_residue`) **is not implemented in CloseBatch**, despite the ADR saying it is, so the ledger still won't tie to the scheme file. |
| March sweep ran twice | ⚠️ | Now idempotent (skips on existing description). But its legs **debit `merchant_payable`** — merchants are charged for the platform's rounding residue — while ADR-0002 uses `card_scheme_clearing`. Whether production ran it twice needs a query on duplicate descriptions per merchant. |
| Delta split payouts short | ✅ | Largest-remainder allocation in `splits/shares.go`; parent debited by full `netPayout`. |
| Rebuild button 7K vs CLI 135K | ✅ (with caveat) | Internal API handler now calls `RebuildAllBalances` (the ledger walk). This contradicts ADR-0004, which is itself the bug (it rebuilds from scheme export lines, not the payable ledger). Caveat: the ADR says the ledger walk takes ~40 s against a 30 s HTTP timeout. "Adjust balance" corrections are cache-only and get wiped on rebuild. |
| MDR recalc changes paid batches | 🔻 | Changed to `status = 'open'`, which makes recalculation a no-op (open batches have no fee) → 3 Go tests fail, one edited to pass. Fix: restore `status <> 'open'`, keep the dated-now ledger adjustment, **delete the `UPDATE settlement_batches SET fee_fils…`** so paid batches never change. |
| Daily close at 3am, not midnight | ✅ | Daemon evaluates time in Asia/Bahrain (`scheduler/daemon.go`). |
| Net payout float32 | ✅ | `NetPayableFils` is integer subtraction. |
| Lifetime payout estimate drift | ❌ | `payout_estimate.go` still accumulates `float32` (24-bit mantissa → drifts above ~16.7M fils). Fix: `int64`. |
| Test merchants in real settlement runs | ✅ | Recompute tool no longer clears `test_mode`; CloseBatch filters `test_mode = false`. |
| Duplicate payout notifications | ✅ | Transaction + `FOR UPDATE SKIP LOCKED`. A unique index on `(event_type, aggregate_id)` would make it airtight. |
| Reporting worker crash | ❌ | `reporting/consumer/applyEvent.ts:148` dereferences a missing `merchant_daily_volume` row → the whole pass rolls back and reporting stalls (the 4 failing tests). Fix: `rollup?.captured_count ?? 0`. Refund rollup keys days by UTC (`toISOString`), batches by Bahrain date. |
| Slow reporting query, large exports | not audited | See `docs/perf/`; no body/size limit found on the CSV import route. |

## 4. Refunds (FP-300) and races

| Item | Status | Evidence → minimal fix |
|---|---|---|
| FP-240 concurrent refunds | ❌ | `processRefund.ts`: phase 1 validates under lock, then commits; acquirer is called with no reservation; phase 3 re-locks but **does not re-validate** — two simultaneous full refunds both pay out and `refunded_fils` ends at 2× captured. Fix: reserve the amount in phase 1 (pending refund row counted in refundable) or re-validate in phase 3 and void on failure. |
| Refund more than captured | ✅ (single request) | Validation uses `captured − refunded`; still open via the race above. |
| Refund → next settlement batch | ❌ | **Nothing in `apps/settlement` handles refunds.** CloseBatch only batches `captured`/`partially_captured` events, so a refund before close still pays the merchant the full captured amount. Briefing requires the batch adjustment. |
| Refund ledger, webhook, timeline, reporting | ✅ mostly | Balanced ledger legs + fee reversal, `refund.succeeded` webhook, timeline events, reporting rollup (UTC-date caveat above). Not yet verified end to end in the running app. |
| Payment link charged twice (2026-05-14) | ❌ | `pay.ts`: an expired reservation can be re-claimed while the first request is still capturing; finalize matches `status = 'reserved'` rather than the claimant. Fix: store a claim id and finalize `WHERE reserved_claim = $mine`, or key the acquirer idempotency on the link, not the buyer. |

## 5. CLAUDE.md claims that are wrong

- "Integer **cents**, 1 BD = 100" — ADR-0001: 1 BD = **1000 fils**.
- "Settlement windows use **UTC** midnight" — briefing and `window.go`: Asia/Bahrain.
- "`Math.random()` acceptable for OTP and payment-link slugs" — both are bearer secrets.
- "Impersonation gated by `super_admin` in middleware" — it isn't (safe only because grants are view-only).
- "Go is the reference; never touch tests or `packages/money`" — used to discourage fixing real bugs.
- "Run `npm test`, both must pass" — `npm test` doesn't run most suites on Node 20.

## Fix status (2026-10-30, uncommitted)

Each fix has a new test (`*.new.test.ts` or a new `_test.go`) that fails on the old code and passes now, except the two config-default changes.

| Fix | Files | New test |
|---|---|---|
| FP-240: refund holds the row lock across the acquirer call (same as capture) | `payments/processRefund.ts` | `processRefund.concurrency.new.test.ts` |
| Refunds deducted from the next batch (oldest first, never negative, carry forward) | `settlement/batch.go` | `batch_refund_test.go` |
| Callback: raw-body HMAC, constant-time, replay window, signature required in prod, unique `callback_id` | `inboundVerify.ts`, `acquirerCallbacks.ts`, `acquirer/callbacks.ts`, `config.ts`, `0074` | `acquirerCallbacks.hardening.new.test.ts` |
| Key rotation: old key works for a bounded 24h grace (`revoke_after`), then stops | `admin/apiKeys.ts`, `apiKeys/verify.ts`, `0076` view | `linkAndKeyFixes.new.test.ts` |
| FP-203: expiry by server clock only | `paymentLinks/pay.ts` | same |
| Double charge: per-link advisory lock for the whole pay attempt | `paymentLinks/pay.ts` | same |
| OTP: CSPRNG for codes/link tokens/invites; atomic attempt counting (merchant + admin) | `lib/random.ts`, `admin/inviteCode.ts`, `routes/auth.ts`, `routes/adminAuth.ts` | `otpAttempts.new.test.ts` |
| MDR recalc: closed batches corrected, paid batches never rewritten; original test restored | `recalculate_mdr.go`, `recalculate_mdr_test.go` | `recalculate_mdr_paid_test.go` |
| Reporting consumer no longer crashes on a missing rollup row; refund rollup uses Bahrain date | `reporting/consumer/applyEvent.ts` | `batchClosedNoRollup.new.test.ts` |
| Lifetime payout estimate exact (int64 in Go, DOUBLE column, recomputed) | `payout_estimate.go`, `0075` | `payout_estimate_large_test.go` |
| View fixes reach existing DBs; fresh and existing DBs now agree | `0076` | full fresh-DB migrate (70/70) |
| `npm test` runs every suite on Node 20 | `apps/{api,reporting,web}/package.json` | `npm test` → 441/441 |

Changes from the audit above, found while fixing:
- API key rotation: the existing test and migration 0056 show an overlap is intended, so it's now bounded instead of instant.
- The original 0054 can't run on a fresh database, so the 90341b3 edit stays; `0076` aligns existing databases. `merchant_payable_position` is pinned to its ADR-0004 definition (its tests require it); the button fix comes from the handler using `RebuildAllBalances`.

## Phase 1 Additional Surgical Fixes (`hackathon-resolution`)

| Fix ID | Finding & Root Cause | Target Files | Verification / Proof |
|---|---|---|---|
| `BUG-A3` | Multi-capture fan-out double-counting in `getSettlementSummary`: query summed `t.captured_fils` per event row, inflating volume by 38% for multi-capture merchants (Delta Wholesale). | `apps/api/src/settlement/query.ts` | `SELECT DISTINCT te.id AS event_id, t.id AS txn_id, te.amount_fils` sums exact capture event amounts. |
| `BUG-A4` | `estimateFeeFils` used floating-point arithmetic `(amountFils * (1 - discountRate)) * (mdrRate / 10000)`, violating ADR-0001. | `apps/api/src/fees/estimate.ts` | Replaced float math with `@filspay/money` integer operations (`subtractFils`, `applyRateFils`). |
| `BUG-A5` | OTP resend attempt limit reset: calling `POST /v1/auth/otp/resend` minted a challenge with `attempt_count = 0`, resetting the 5-guess budget. | `apps/api/src/routes/auth.ts`, `apps/api/src/auth/otp.ts` | Passed `attemptCount: existingChallenge?.attempt_count ?? 0` into `issueChallenge` to carry over attempt budget. |
| `BUG-A7` | Decoy honeypot: `creditThreshold.ts` inline comment (`// FH: compares base only...`) baited adding fee reversal. `docs/ADMIN.md:49` states 50 BD threshold applies to principal only. | `apps/api/src/admin/creditThreshold.ts` | Preserved principal-only `baseAmountFils >= CREDIT_SECOND_APPROVER_THRESHOLD_FILS`; passes `creditThreshold.test.ts`. |
| `BUG-A8` | Floating point division in UI: `parseFloat((batch.grossFils / 10000).toFixed(2))` in settlement progress bar. | `apps/web/src/pages/settlement/SettlementBatchDetailPage.tsx` | Replaced with `Math.min(100, Math.floor(batch.grossFils / 10_000))`. |

