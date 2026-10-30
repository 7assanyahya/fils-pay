/**
 * QA follow-up (UC4): the reconciliation report estimated the fee on
 * unbatched captures from merchants.mdr_bps, but capture charges the
 * effective fee_schedules row. For a merchant on a schedule, one unbatched
 * capture showed up as an "unexplained" gap (25 fils on 10.000 BD at 225 vs
 * 250 bps). Requires a real, migrated Postgres via DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";
import { getReconciliationReport } from "./query.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("reconciliationSchedule.new.test.ts requires DATABASE_URL (run `npm run migrate` first)");
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

function bahrainToday(): string {
  return new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
}

test("an unbatched capture on a scheduled rate is fully explained as pending", async () => {
  const merchantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
      [`Recon schedule ${randomUUID()}`],
    )
  ).rows[0]!.id;
  await pool.query(`INSERT INTO fee_schedules (merchant_id, mdr_bps, effective_from) VALUES ($1, 225, $2)`, [
    merchantId,
    new Date(Date.now() - 30 * 86_400_000),
  ]);
  const ownerId = (
    await pool.query<{ id: string }>(
      `INSERT INTO merchant_users (merchant_id, email, role, password_hash)
       VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
      [merchantId, `owner-${randomUUID()}@example.test`],
    )
  ).rows[0]!.id;
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const { rawKey } = await issueApiKey(pool, config, { merchantId, createdBy: ownerId, label: "recon" });
  const headers = { authorization: `Bearer ${rawKey}` };

  const auth = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: { ...headers, "idempotency-key": randomUUID() },
    payload: { amountFils: 10_000, card: { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" } },
  });
  assert.equal(auth.statusCode, 201, auth.body);
  const capture = await app.inject({
    method: "POST",
    url: `/v1/transactions/${(auth.json() as { id: string }).id}/capture`,
    headers: { ...headers, "idempotency-key": randomUUID() },
    payload: {},
  });
  assert.equal(capture.statusCode, 200, capture.body);

  const from = bahrainToday();
  const to = new Date(Date.parse(`${from}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const report = await getReconciliationReport(pool, { merchantId, from, to });
  assert.equal(report.pendingUnbatchedFils, 10_000 - 225);
  assert.equal(report.gapFils, 0, JSON.stringify(report));
  assert.equal(report.explained, true);
});
