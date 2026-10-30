/**
 * Capacity: under overload the API turns excess requests away quickly with
 * 503 + Retry-After instead of queueing them into timeouts and 500s, and
 * serves normally again once the burst is over. A saturated DB pool is also
 * a 503, not a 500. Requires a real, migrated Postgres via DATABASE_URL.
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
  throw new Error("overload.new.test.ts requires DATABASE_URL (run `npm run migrate` first)");
}

function configWith(extra: Record<string, string>) {
  return loadConfig({
    DATABASE_URL: databaseUrl,
    NODE_ENV: "test",
    ACQUIRER_FAILURE_RATE: "0",
    ACQUIRER_LATENCY_MIN_MS: "300",
    ACQUIRER_LATENCY_MAX_MS: "400",
    WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
    ...extra,
  });
}

async function merchantKey(pool: Pool, config: ReturnType<typeof configWith>): Promise<string> {
  const merchantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
      [`Overload ${randomUUID()}`],
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
  return (await issueApiKey(pool, config, { merchantId, createdBy: ownerId, label: "overload" })).rawKey;
}

test("past the in-flight cap the API sheds load with 503 + Retry-After, then recovers", async () => {
  const config = configWith({ API_MAX_INFLIGHT: "2" });
  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  const app = buildApp(config, pool);
  try {
    const rawKey = await merchantKey(pool, config);
    const authorize = () =>
      app.inject({
        method: "POST",
        url: "/v1/transactions",
        headers: { authorization: `Bearer ${rawKey}`, "idempotency-key": randomUUID() },
        payload: { amountFils: 1_000, card: { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" } },
      });
    const burst = await Promise.all(Array.from({ length: 6 }, authorize));
    const codes = burst.map((r) => r.statusCode).sort();
    assert.equal(codes.filter((c) => c === 201).length, 2, codes.join(","));
    const shed = burst.filter((r) => r.statusCode === 503);
    assert.equal(shed.length, 4, codes.join(","));
    for (const r of shed) {
      assert.equal(r.headers["retry-after"], "1");
      assert.equal(r.json().error, "overloaded");
    }
    // Health probes are never shed.
    assert.equal((await app.inject({ method: "GET", url: "/healthz" })).statusCode, 200);
    // After the burst, normal service.
    assert.equal((await authorize()).statusCode, 201);
  } finally {
    await app.close();
    await pool.end();
  }
});

test("a saturated DB pool answers 503 service_busy, not 500", async () => {
  const config = configWith({});
  const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 200 });
  const app = buildApp(config, pool);
  const held = await pool.connect();
  try {
    const res = await app.inject({ method: "GET", url: "/v1/payment-links/plink_does_not_matter" });
    assert.equal(res.statusCode, 503, res.body);
    assert.equal(res.json().error, "service_busy");
    assert.equal(res.headers["retry-after"], "1");
  } finally {
    held.release();
    await app.close();
    await pool.end();
  }
});
