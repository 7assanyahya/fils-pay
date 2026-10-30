# Capacity: checkout load test, estimate and overload behaviour

Measured 2026-10-30 on branch `7asn` against the local stack (API, settlement daemon, reporting worker, Postgres 16 in Docker). The tool is [`scripts/loadtest/checkout.mjs`](../scripts/loadtest/checkout.mjs). It has no dependencies (Node 20 `fetch`).

## Scenario and method

One simulated user does what the checkout page does: `GET /v1/payment-links/:token`, then `POST /v1/payment-links/:token/pay` with an approved test card and a fresh `Idempotency-Key`. Links (1.000 BD each) are created beforehand with Alpha's API key. Users run back to back at a fixed concurrency with no think time.

```bash
API=http://localhost:3000 API_KEY=<merchant key> MERCHANT_ID=<merchant id> \
  node scripts/loadtest/checkout.mjs --users 200 --concurrency 10
```

The acquirer simulator runs with its default latency (100–400 ms per call; a checkout makes two calls, authorize and capture) and `ACQUIRER_FAILURE_RATE=0`. CPU per checkout is the API process's CPU time (`ps`) and the Postgres container's cgroup `usage_usec`, both measured over the run. Correctness was checked in SQL after every run (queries below).

Host: Intel i9-9880H laptop. The API was not CPU-limited locally, so the box estimate below is derived from measured CPU time per checkout.

## Results

| Concurrency | Checkouts | Throughput | p50 | p95 | p99 | Result codes | API CPU / checkout | Postgres CPU / checkout |
|---|---|---|---|---|---|---|---|---|
| 1 | 20 | 1.7/s | 609 ms | 800 ms | 800 ms | 20× 200 | 23 ms | 53 ms |
| 10 | 200 | **16.4/s** | 592 ms | 800 ms | 862 ms | 200× 200 | 21 ms | 43 ms |
| 20 | 400 | 16.9/s | 1,153 ms | 1,398 ms | 1,494 ms | 400× 200 | 14 ms | 42 ms |
| 40 | 800 | 17.1/s | 2,323 ms | 2,587 ms | 2,734 ms | 800× 200 | 11 ms | 39 ms |
| 80 | 1,600 | 17.1/s | 4,660 ms | 4,953 ms | 5,042 ms | 1,600× 200 | 12 ms | 45 ms |
| 300 (overload) | 900 | — | 169 ms | 5,601 ms | 7,373 ms | 86× 200, 814× 503, **0× 500** | — | — |

API resident memory after the runs: 82 MB (limit 512 MB).

### Before the capacity fixes

The same scenario at concurrency 12 (pool of 5) returned **20 of 24 checkouts as 500** after 5 s timeouts. That was a pool deadlock: each checkout held a connection for its per-link advisory lock and waited for a second one. A first fix that capped lock holders at `pool max − 1` removed the deadlock but serialised the work (3.5/s, p50 2.6 s at concurrency 10). The final fix runs each checkout on its lock connection: one connection per checkout, no deadlock possible, and 16.4/s at p50 592 ms. Commits `03c3054` and `8c02e92`; test `apps/api/src/paymentLinks/payPoolDeadlock.new.test.ts`.

## Where the bottleneck is

1. **Locally: the DB pool.** Throughput plateaus at about 17/s from concurrency 10 upward, while latency grows linearly. A checkout holds its one connection for about 0.59 s, because capture keeps the transaction row lock across the acquirer call (deliberate, DECOY-13). 10 connections ÷ 0.59 s ≈ 17/s.
2. **On the judged box: Postgres CPU.** Postgres spends about 43 ms of CPU per checkout, including the reporting consumer and webhook dispatcher work each checkout triggers. The API spends 11–23 ms.

## Estimate for the judged box (1 vCPU / 2 GB; API capped at 0.5 vCPU / 512 MB)

| Resource | Budget | Cost per checkout | Ceiling |
|---|---|---|---|
| API CPU | 500 ms/s | ~18 ms | ~28/s |
| Postgres CPU (shares the other 0.5 vCPU with settlement and reporting) | ~450 ms/s | ~43 ms | **~10/s** |
| DB pool (`PG_POOL_MAX=10`) | 10 connections | ~0.59 s held | ~17/s |
| API memory | 512 MB | 82 MB resident | not binding |

**Estimate: about 8 checkouts per second sustained with p95 under 1 s** (about 480 checkouts a minute). That's the Postgres ceiling of ~10/s, discounted because a cloud vCPU is usually slower than this laptop's core. At p95 ≤ 1 s that's about **5 buyers checking out at the same moment** (throughput × ~0.6 s). For a scenario with think time between a user's steps, multiply by (think time + 0.6 s) ÷ 0.6 s. Beyond the ceiling, latency rises with the queue; past 200 in-flight requests the API sheds load (below).

## Turning away excess load, restarting and recovering

- **Load shedding:** above `API_MAX_INFLIGHT` (200) concurrent requests the API answers `503 {"error":"overloaded"}` with `Retry-After: 1`, without touching the database. A saturated DB pool answers `503 service_busy` instead of 500. Health probes are never shed. Commit `1372627`; test `apps/api/src/plugins/overload.new.test.ts`.
- **Overload run (300 concurrent users):** 814 requests were shed in a median 169 ms, 86 checkouts completed, and there were **0 500s**. Afterwards: every paid link had exactly one captured transaction, there were no orphans from that run, and all ledger groups balanced. The next run at concurrency 10 was back to 16.3/s, 100/100 OK.
- **Crash and restart:** the API was killed with `kill -9` six seconds into a 300-user run at concurrency 20, then restarted. 83 checkouts completed, and in-flight requests failed at the client (`ECONNREFUSED` / socket errors). No double charge (every paid link had exactly one capture) and the ledger stayed balanced. The 10 links that were mid-checkout stayed `reserved` (6 with an authorization but no capture, so no money moved). After the 60 s reservation timeout all 10 were paid successfully on retry. Leftover card holds are flipped to `expired` by `scripts/expire_holds.ts`.
- **Restart policy:** `ops/docker-compose.yml` restarts postgres, api, settlement and reporting unless stopped, and the api has a `/healthz` health check (commit `89a8cd9`). Settlement re-runs are idempotent: `CloseBatch` locks the batch row in one transaction and skips closed or paid days.

## Correctness queries used after each run

```sql
-- every paid link has exactly one captured transaction for its amount
SELECT count(*) FROM payment_links p
 WHERE p.reference LIKE 'load-%' AND p.status = 'paid'
   AND (SELECT count(*) FROM transactions t
         WHERE t.id = p.transaction_id AND t.status = 'captured' AND t.captured_fils = p.amount_fils) <> 1;  -- expect 0

-- every ledger entry group balances
SELECT count(*) FROM (SELECT entry_group_id FROM ledger_entries GROUP BY 1
  HAVING sum(CASE direction WHEN 'debit' THEN amount_fils ELSE -amount_fils END) <> 0) x;            -- expect 0
```

## Limits of this measurement

- The API ran unconstrained on a laptop; the box figures are derived from CPU time, not measured on 0.5 vCPU. Re-run the script against the deployed server to confirm the estimate.
- The simulated acquirer's latency (100–400 ms) dominates checkout time; a real acquirer's latency changes the pool ceiling proportionally.
- In-memory limits (login throttle, load shedding) are per process; the stack runs one API replica.
