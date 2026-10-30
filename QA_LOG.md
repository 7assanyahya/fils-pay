# QA Log — end-to-end pass, branch `7asn` (2026-10-30)

Whole stack run locally and every use case exercised the way a user would (browser through `scripts/dev/proxy.mjs`, plus HTTP), checking the UI, the API response and the database rows. Money is integer fils (1 BD = 1000 fils). Root causes and fixes for every FIXED row are in [EXPLANATIONS.md §4.5](EXPLANATIONS.md#45-end-to-end-qa-pass-fixes-2026-10-30). Screenshots are in [`docs/screenshots/`](docs/screenshots/).

**Totals:** 10 use cases: 4 PASS (UC1, UC2, UC5, UC10) and 6 where bugs were found and FIXED (UC3, UC4, UC6, UC7, UC8, UC9). Findings: 10 bugs FIXED, 1 left as is because a locked test pins it (QA-B3), 5 INTENDED, plus the 3 known open items DEF-03/07/08.

**Final run (2026-10-30, head after the follow-up fixes):** `npm test` 458/458; `go test ./...` 7/7 packages with tests `ok` (3 have none); `npm run typecheck` 0 errors; fresh database: 72/72 migrations; `npm run seed` 5/5 REAL. Refund demo re-run on the final code: reversals 278 and 36 + 35 + 36 = 107, every account nets to 0, reconciliation `gapFils: 0`.

| # | Steps | Expected | Actual | Result | Evidence | Commit |
|---|---|---|---|---|---|---|
| 1 | Merchant login → OTP → dashboard; wrong password; pending `/me`; 5 wrong OTPs; 20 parallel wrong OTPs; resend after 3 wrong; logout | Generic 401; pending session can't reach `/me`; lock at 5; parallel ≤ 5; resend keeps budget; logout kills session | Wrong pw 401 `invalid_credentials`; pending `/me` 401; 5× 401 then 429 and session revoked (right code then 401); 20 parallel → 5× 401 + 15× 429, `attempt_count = 5`; resend <30s 429, after resend `attempt_count = 3`, 2 more then 429; logout 204, old cookie 401. Browser login → OTP → transactions list in 3-decimal BD | **PASS** | `otp_challenges.attempt_count`; `uc1-dashboard-after-otp.jpg` | — |
| 2 | Authorize 12.345 + full capture, authorize 10.000 + partial 4.755 (API key); timeline; Beta key on Alpha txn | Captured/partially_captured; 3-dp amounts; ordered events; cross-merchant 404 | As expected. Fee 107 = 4,755 × 225 bps (Alpha's effective schedule); 4 balanced legs; UI shows 10.000 / 4.755 BHD; events `authorized → partially_captured`; Beta GET/capture/void/events all 404 | **PASS** | `ledger_entries` per txn; UI detail page | — |
| 3 | Create link, public read, pay, pay again, cancel, cancel paid, cancel other merchant's, expired + old `submittedAt`, declined card, 8 concurrent pays, UI checkout | 201/200/200/409/204/409/404-403/410/402 then payable/one charge | All as expected (8 concurrent → 1× 200 + 7× 409 `payment_link_processing`, 1 transaction). **Bug:** public read returned the API key's `key_hash` as `merchantIntegrationId` | **FIXED** | live response before/after; `uc3-checkout-after-fix.jpg` | `8eb377d` |
| 4 | Refunds: 3 partials via `/v1/refunds`; drawer partial 2.345 + blank full; `/v1/merchants/:id/refunds`; > refundable; 2 concurrent full; other merchant's txn; support role; webhook; timeline; rollup; settlement report; reconciliation | Fee reversals sum to fee; balanced legs; signed webhook; rollups/reports tie out; negatives rejected | **Bug:** 36+36+36 = 108 reversed on a 107 fee (`platform_fee_revenue` −1). After fix 36+35+36 = 107, all accounts net 0. Drawer: 53 + 225 = 278 = fee; timeline `refund_partial`/`refunded`. Merchant route 200; 5,001 > 5,000 → 422; concurrent → 1× 200 + 1× 409; foreign txn 404/403/404; support 403 on both routes. `refund.succeeded` delivered, HMAC over raw bytes valid. Refund rollups = SQL. Batch report OK. Reconciliation same-day gap = payout legs in window (**intended**, see below); seeded range gap 0. **Bug (follow-up):** reconciliation priced pending captures at `merchants.mdr_bps`, so Alpha (225 bps schedule) showed a 25-fil unexplained gap per 10 BD; after fix gap 0 | **FIXED** | `uc4-drawer-partial-refund.jpg`, `uc4-drawer-full-refund.jpg`; ledger sums | `c5e4630`, `7a14eb8` |
| 5 | `settlement run-batch --date=2026-10-30`; re-run; planted event at 2026-11-01T21:30Z | net = gross − fee; refunds deducted; payout legs; scheme lines ×10; residue legs; BIGINT counter += gross; Bahrain day; test-mode excluded; idempotent; split sums | 60 merchants paid; 0 batches with net ≠ gross − fee; Alpha gross 13,750 = captures 43,605 − claimed refunds 29,855; fee 309 + reversals 673 = journaled 982; payout legs 27/27; 0 lines not ×10; 15 residue lines, 0 mismatched legs (DEF-04 ok); `total_processed_fils` BIGINT 0 → 287,283 = batched gross (DEF-02 ok); Gamma excluded; re-run 60× alreadyClosed/paid, ledger unchanged; Delta Marketplace 3,714 = 1,114 + 743 + 1,857; planted event excluded from 11-01, included in 11-02 | **PASS** | SQL checks; CLI output | — |
| 6 | Register endpoint, test send, verify signature, replay, archive, failing endpoint (max 4, base 2s), malformed ids | Valid signatures; replay re-delivers; backoff then stop | Test send signature valid, one flipped byte invalid; replay 202, new row with `replay_of_delivery_id`, valid; failing endpoint 4 attempts (+2s, +5s, +9s) then `exhausted`. **Bug:** malformed ids → 500. **Bug (follow-up):** deleting an endpoint with deliveries → 500 (FK); after migration `0078` → 204 with the deliveries kept. Admin archive/replay is covered in UC8's gate matrix only | **FIXED** | `webhook_deliveries` rows; receiver log | `ed3c566`, `fdda2a5` |
| 7 | Signed callback; tampered; missing header; stale/future (300s window); 6 and 8 concurrent duplicates; malformed JSON | 200; 401s; one note per callback | As expected (stale accepted only under the dev default max-age 0; with production's 300s: 401 `timestamp_out_of_range`). 1 note per duplicate burst. **Bug:** malformed JSON → 500 | **FIXED** | `acquirer_callback_notes` counts | `1b8c198` |
| 8 | Admin login/OTP; 19-endpoint × 4-actor gate matrix; impersonation; credits; CSV import; key rotation; MDR recalc; balance rebuild (DEF-01) | Gates hold; impersonation view-only; second approver > 50 BD, no self-approval; 4.75 → 4,750, 4.755 → 4,755; grace then stop; paid batch untouched; cache = ledger | Gates hold (support 403 on every money action, anon 401). **Bug:** impersonation (and merchant support) could capture/void. Credits: ≤ 50.000 posts, 60 BD pending, self-approve 409, support 403, second approver posts once. CSV 4,750 / 4,755 / 120,000 with balanced legs. **Bug:** re-rotating an old key revived it. MDR recalc left paid rows unchanged. **Bug (follow-up):** at an unchanged rate it re-charged claimed refunds' fee reversals, priced at `mdr_bps` instead of the schedule, and zeroed batches with no linked events; after fix a live re-run adjusts nothing. Rebuild: 0 cache/ledger mismatches (DEF-01 ok). Credit ledger dating left as is (locked, QA-B3) | **FIXED** | gate matrix output; `uc8-admin-merchant-support-role.jpg` | `619f18a`, `e000cf0`, `4443ed4` |
| 9 | Dashboard/analytics totals vs SQL over Bahrain days; payout trends; Rebuild analytics | Rollups = SQL | Live traffic matches once seed-created outbox rows are discounted. **Bug:** Rebuild analytics zeroed refund rollups (62 / 253.879 BD → 0). After fix: 0 mismatches across all merchants and days | **FIXED** | comparison queries | `631ae3c` |
| 10 | `expire_holds.ts` with expired-active, unexpired-active and released holds; re-run; read `reconcile_march.ts` + run its tests | Expired flipped, nothing deleted, others untouched | 5 expired, 142 → 142 rows, unexpired active, released released, re-run 0 (DEF-06 ok). `reconcile_march.ts` uses Bahrain bounds and ADR-0002 accounts (DEF-05 ok); not run against the DB; script tests 8/8 | **PASS** | SQL before/after | — |

## INTENDED (not bugs)

| Use case | Behaviour | Proof |
|---|---|---|
| UC3 | Public link read returns `merchantPublicKey` (key prefix) | Pinned by `apps/api/src/routes/paymentLinks.test.ts:126` |
| UC4 | Reconciliation shows a gap equal to the net payout when a day is closed *and* paid on the same day | `apps/api/src/routes/settlement.test.ts:160-172`: the daemon pays the next day, so payout legs fall outside the window. Excluding payout legs, ledger 13,441 = settlement 13,441 |
| UC6 | A replayed delivery gets a new `delivery_event_id` | Pinned by `apps/api/src/routes/webhooks.test.ts:350`; `replay.ts:24` (the `headers.ts` comment is stale) |
| UC9 | Payout trends keep the status from when `settlement.batch_closed` was consumed | Pinned by `apps/reporting/src/consumer/applyEvent.test.ts:121`; `docs/ADMIN.md`: dashboards lag, use **Rebuild analytics** |
| UC9 | Seeded August transactions roll up on the seed day | The consumer buckets by outbox `created_at` (`applyEvent.ts:5`); the seed stamps backfilled outbox rows with the seed time. Rebuild analytics re-buckets by event time |

## Follow-up fixes and remaining decision

| ID | Use case | Finding | Outcome |
|---|---|---|---|
| QA-B1 | UC6 | Deleting an endpoint with deliveries → 500, FK `webhook_deliveries_endpoint_id_fkey` (`0022`, `NOT NULL`, no `ON DELETE`) | **FIXED** `fdda2a5`: migration `0078`, `ON DELETE SET NULL`. Deliveries are kept, as `0068`'s header ("deliveries are never deleted") and `cancel.ts` require |
| QA-B2 | UC8 | `RecalculateMDR` moved money at an unchanged rate (refund reversals re-charged, `mdr_bps` instead of schedule, event-less batches zeroed) | **FIXED** `4443ed4`. Still a policy question: re-pricing refunded volume after a genuine rate change (DEF-08 area) |
| — | UC4 | Reconciliation pending estimate used `merchants.mdr_bps` (false "0046 trigger" comment) | **FIXED** `7a14eb8` |
| QA-B3 | UC8 | Manual credits post ledger legs at the effective date (`credits.ts:157`); handover says ledger rows go in at `now()` | **Left as is**: pinned by the locked test `apps/api/src/admin/credits.test.ts:186` (with a finance sign-off note). Changing it means editing a locked test |

Not changed: `docs/ADMIN.md` says support can issue small credits; the code refuses (403). Allowing it would loosen authorization, so it needs the owner's call.

## Known items (from EXECUTION_PLAN.md)

| ID | Status |
|---|---|
| DEF-01, 02, 04, 05, 06 | Regression-checked live in UC8, UC5, UC5, UC10, UC10: no regressions |
| DEF-03 | BLOCKED/known: volume-tier discount awaiting finance sign-off (not reached in QA: counter 287,283 ≪ 2,000,000,000) |
| DEF-07 | BLOCKED/known: display-only balance adjustments (locked test) |
| DEF-08 | Deferred/known: post-payout MDR corrections |

## Environment changes made to run the stack

- `scripts/dev/proxy.mjs` (committed) on `localhost:8173` → web and `localhost:8174` → admin; frontends run with `VITE_API_BASE_URL` / `VITE_ADMIN_API_BASE_URL` / `VITE_WEB_BASE_URL` pointing at the proxies. No CORS added to the API.
- API env for testing only: `ACQUIRER_FAILURE_RATE=0` (deterministic approvals), `ACQUIRER_CALLBACK_SIGNING_SECRET=dev-acq-secret`, `ACQUIRER_CALLBACK_REQUIRE_SIGNATURE=true`, `ACQUIRER_CALLBACK_MAX_AGE_SECONDS=300` (production defaults), `WEBHOOK_MAX_ATTEMPTS=4`, `WEBHOOK_BACKOFF_BASE_MS=2000`, `WEBHOOK_BACKOFF_CAP_MS=8000`, `WEBHOOK_POLL_INTERVAL_MS=1000`, `CHECKOUT_BASE_URL=http://localhost:8173`.
- The browser pane suppresses native dialogs, so for the refund drawer's `window.confirm` I stubbed `confirm` to return true in the page. Not an app change.
- Test data planted by QA: one capture event moved to 2026-11-01T21:30Z (boundary test), one key's `revoke_after` moved into the past (grace expiry), two holds' `expires_at` moved into the past.
- Migration `0077` was not yet applied to the local database and was applied by `npm run migrate` at the start.
