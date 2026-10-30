/**
 * Capacity: each pay attempt holds a pooled connection for its per-link
 * advisory lock and then needs a second one for the claim and the
 * authorize/capture transactions. With as many concurrent pays (on
 * different links) as the pool has connections, every connection was a
 * lock holder waiting for another: the pool deadlocked until
 * connectionTimeoutMillis and every attempt failed with 500. Requires a
 * real, migrated Postgres via DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("payPoolDeadlock.new.test.ts requires DATABASE_URL (run `npm run migrate` first)");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  ACQUIRER_FAILURE_RATE: "0",
  ACQUIRER_LATENCY_MIN_MS: "50",
  ACQUIRER_LATENCY_MAX_MS: "80",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});

// A small pool with a short acquire timeout, so a deadlock fails fast.
const pool = new Pool({ connectionString: databaseUrl, max: 3, connectionTimeoutMillis: 1_500 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

test("concurrent pays on different links don't deadlock the pool", async () => {
  const merchantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
      [`Pool deadlock ${randomUUID()}`],
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
  const { rawKey } = await issueApiKey(pool, config, { merchantId, createdBy: ownerId, label: "deadlock" });

  const tokens: string[] = [];
  for (let i = 0; i < 8; i++) {
    const res = await app.inject({
      method: "POST",
      url: `/v1/merchants/${merchantId}/payment-links`,
      headers: { authorization: `Bearer ${rawKey}` },
      payload: { amountFils: 1_000, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
    });
    assert.equal(res.statusCode, 201, res.body);
    tokens.push((res.json() as { token: string }).token);
  }

  const results = await Promise.all(
    tokens.map((token) =>
      app.inject({
        method: "POST",
        url: `/v1/payment-links/${token}/pay`,
        headers: { "idempotency-key": randomUUID() },
        payload: { card: { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" } },
      }),
    ),
  );
  assert.deepEqual(
    results.map((r) => r.statusCode),
    tokens.map(() => 200),
    results.map((r) => r.body).join("\n"),
  );
  const paid = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM payment_links WHERE token = ANY($1) AND status = 'paid'`,
    [tokens],
  );
  assert.equal(paid.rows[0]!.c, tokens.length);
});
