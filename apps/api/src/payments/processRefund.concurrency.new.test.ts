/**
 * FP-240: two refund requests for the same transaction, in flight at the
 * same time, must not both move money. Real Postgres, real authorize/capture
 * routes; only the acquirer's refund call is stubbed (slowed down so the two
 * requests genuinely overlap).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";
import type { AcquirerRefundResult, AcquirerSimulator } from "../acquirer/types.js";
import { processRefund } from "./processRefund.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("processRefund.concurrency.new.test.ts requires DATABASE_URL");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  INTERNAL_API_TOKEN: "test-internal-token",
  ACQUIRER_FAILURE_RATE: "0",
  ACQUIRER_LATENCY_MIN_MS: "0",
  ACQUIRER_LATENCY_MAX_MS: "1",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});

const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

const VALID_CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

function slowCountingAcquirer(): { acquirer: AcquirerSimulator; refundCalls: () => number } {
  let calls = 0;
  const acquirer: AcquirerSimulator = {
    authorize() {
      throw new Error("not used");
    },
    capture() {
      throw new Error("not used");
    },
    async refund(req): Promise<AcquirerRefundResult> {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 150));
      return { outcome: "approved", acquirerReference: req.acquirerReference, latencyMs: 150 };
    },
  };
  return { acquirer, refundCalls: () => calls };
}

test("FP-240: two concurrent full refunds — only one reaches the acquirer, refunded never exceeds captured", async () => {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Concurrent Refund ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  const user = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash)
     VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const { rawKey } = await issueApiKey(pool, config, { merchantId, createdBy: user.rows[0]!.id, label: "t" });

  const auth = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: { authorization: `Bearer ${rawKey}`, "idempotency-key": randomUUID() },
    payload: { amountFils: 10_000, card: VALID_CARD, reference: "fp-240" },
  });
  assert.equal(auth.statusCode, 201, auth.body);
  const txnId = (auth.json() as { id: string }).id;
  const cap = await app.inject({
    method: "POST",
    url: `/v1/transactions/${txnId}/capture`,
    headers: { authorization: `Bearer ${rawKey}`, "idempotency-key": randomUUID() },
    payload: {},
  });
  assert.equal(cap.statusCode, 200, cap.body);

  const { acquirer, refundCalls } = slowCountingAcquirer();
  const actor = { type: "merchant_api_key" as const, id: randomUUID() };
  const results = await Promise.all([
    processRefund(pool, acquirer, { transactionId: txnId, merchantId, idempotencyKey: randomUUID(), actor }),
    processRefund(pool, acquirer, { transactionId: txnId, merchantId, idempotencyKey: randomUUID(), actor }),
  ]);

  const succeeded = results.filter((r) => r.statusCode === 200);
  assert.equal(succeeded.length, 1, JSON.stringify(results));
  assert.equal(refundCalls(), 1, "money moved out exactly once");

  const row = await pool.query<{ refunded_fils: string; captured_fils: string }>(
    `SELECT refunded_fils, captured_fils FROM transactions WHERE id = $1`,
    [txnId],
  );
  assert.equal(Number(row.rows[0]!.refunded_fils), 10_000);
  const refunds = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM refunds WHERE transaction_id = $1 AND status = 'succeeded'`,
    [txnId],
  );
  assert.equal(refunds.rows[0]!.n, "1");
});
