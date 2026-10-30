/**
 * UC4 (QA pass): fee reversals summed over all partial refunds of one
 * capture must equal the fee that capture charged, to the fil. Each partial
 * used to reverse round(fee × part / captured) on its own, so three
 * refunds of 1/3 each reversed 3 × round(fee/3), which can exceed the fee.
 * Requires a real, migrated Postgres via DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { toFils } from "@filspay/money";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";
import type { AcquirerRefundResult, AcquirerSimulator } from "../acquirer/types.js";
import { processRefund } from "./processRefund.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("processRefund.feeSum.new.test.ts requires DATABASE_URL (run `npm run migrate` first)");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
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

const approvingAcquirer: AcquirerSimulator = {
  authorize() {
    throw new Error("not used");
  },
  capture() {
    throw new Error("not used");
  },
  refund(req): Promise<AcquirerRefundResult> {
    return Promise.resolve({ outcome: "approved", acquirerReference: req.acquirerReference, latencyMs: 0 });
  },
};

async function capturedTransaction(capturedFils: number) {
  const merchantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
      [`Refund fee sum ${randomUUID()}`],
    )
  ).rows[0]!.id;
  const ownerId = (
    await pool.query<{ id: string }>(
      `INSERT INTO merchant_users (merchant_id, email, role, password_hash)
       VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
      [merchantId, `owner-${randomUUID()}@example.test`],
    )
  ).rows[0]!.id;
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const issued = await issueApiKey(pool, config, { merchantId, createdBy: ownerId, label: "fee-sum" });
  const headers = { authorization: `Bearer ${issued.rawKey}` };

  const auth = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: { ...headers, "idempotency-key": randomUUID() },
    payload: { amountFils: capturedFils, card: VALID_CARD, reference: "fee-sum" },
  });
  assert.equal(auth.statusCode, 201, auth.body);
  const transactionId = (auth.json() as { id: string }).id;
  const cap = await app.inject({
    method: "POST",
    url: `/v1/transactions/${transactionId}/capture`,
    headers: { ...headers, "idempotency-key": randomUUID() },
    payload: {},
  });
  assert.equal(cap.statusCode, 200, cap.body);

  const fee = await pool.query<{ fee: string }>(
    `SELECT COALESCE(SUM(amount_fils), 0)::text AS fee FROM ledger_entries
      WHERE transaction_id = $1 AND account_id = 'platform_fee_revenue' AND direction = 'credit'`,
    [transactionId],
  );
  return { merchantId, transactionId, apiKeyId: issued.id, feeFils: Number(fee.rows[0]!.fee) };
}

async function refundInParts(parts: number[]) {
  const total = parts.reduce((a, b) => a + b, 0);
  const txn = await capturedTransaction(total);
  for (const part of parts) {
    const res = await processRefund(pool, approvingAcquirer, {
      transactionId: txn.transactionId,
      merchantId: txn.merchantId,
      amountFils: toFils(part),
      idempotencyKey: randomUUID(),
      actor: { type: "merchant_api_key", id: txn.apiKeyId },
    });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  }
  const reversed = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(fee_reversed_fils), 0)::text AS total FROM refunds WHERE transaction_id = $1`,
    [txn.transactionId],
  );
  const net = await pool.query<{ account_id: string; net: string }>(
    `SELECT account_id, SUM(CASE direction WHEN 'credit' THEN amount_fils ELSE -amount_fils END)::text AS net
       FROM ledger_entries WHERE transaction_id = $1 GROUP BY account_id`,
    [txn.transactionId],
  );
  return { feeFils: txn.feeFils, reversedFils: Number(reversed.rows[0]!.total), net };
}

test("three equal partial refunds reverse exactly the fee charged (rounding up each time)", async () => {
  // 4,755 fils at 250 bps → fee 119; each third (1,585) is 39.67 → 40 alone.
  const { feeFils, reversedFils, net } = await refundInParts([1_585, 1_585, 1_585]);
  assert.ok(feeFils > 0);
  assert.equal(reversedFils, feeFils);
  for (const row of net.rows) {
    assert.equal(Number(row.net), 0, `${row.account_id} should net to 0 after a full refund`);
  }
});

test("partial refunds that each round down still reverse the whole fee", async () => {
  // 10,001 fils at 250 bps → fee 250; the two halves each round down alone.
  const { feeFils, reversedFils } = await refundInParts([3_333, 3_334, 3_334]);
  assert.equal(reversedFils, feeFils);
});
