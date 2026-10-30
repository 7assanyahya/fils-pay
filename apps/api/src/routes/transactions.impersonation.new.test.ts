/**
 * UC8 (QA pass): impersonation is view-only. An admin "view as merchant"
 * grant resolves to merchant role 'support', and capture/void move money,
 * so both must refuse it with 403 the way refunds and payment links do.
 * They used to chain requireMerchantAuth alone, so a grant could capture
 * and void (recorded as a merchant_session write). API keys keep full
 * merchant authority. Requires a real, migrated Postgres via DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";
import { startImpersonation } from "../admin/impersonation.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("transactions.impersonation.new.test.ts requires DATABASE_URL (run `npm run migrate` first)");
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

const CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

async function setup() {
  const merchantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
      [`Impersonation writes ${randomUUID()}`],
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
  const { rawKey } = await issueApiKey(pool, config, { merchantId, createdBy: ownerId, label: "imp" });

  const adminUserId = (
    await pool.query<{ id: string }>(
      `INSERT INTO admin_users (email, password_hash, display_name, role)
       VALUES ($1, 'unused', 'Test super_admin', 'super_admin') RETURNING id`,
      [`imp-${randomUUID()}@admin.test`],
    )
  ).rows[0]!.id;
  const grant = await startImpersonation(pool, { adminUserId, merchantId, ttlMinutes: 15 });
  const impCookie = `${config.impersonationCookieName}=${grant.rawToken}`;
  return { rawKey, impCookie };
}

async function authorize(rawKey: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: { authorization: `Bearer ${rawKey}`, "idempotency-key": randomUUID() },
    payload: { amountFils: 3_333, card: CARD },
  });
  assert.equal(res.statusCode, 201, res.body);
  return (res.json() as { id: string }).id;
}

test("an impersonation grant can read but cannot capture or void", async () => {
  const { rawKey, impCookie } = await setup();

  const read = await app.inject({ method: "GET", url: "/v1/transactions", headers: { cookie: impCookie } });
  assert.equal(read.statusCode, 200, read.body);

  const toCapture = await authorize(rawKey);
  const capture = await app.inject({
    method: "POST",
    url: `/v1/transactions/${toCapture}/capture`,
    headers: { cookie: impCookie, "idempotency-key": randomUUID() },
    payload: {},
  });
  assert.equal(capture.statusCode, 403, capture.body);

  const toVoid = await authorize(rawKey);
  const voided = await app.inject({
    method: "POST",
    url: `/v1/transactions/${toVoid}/void`,
    headers: { cookie: impCookie },
  });
  assert.equal(voided.statusCode, 403, voided.body);

  const rows = await pool.query<{ status: string }>(
    `SELECT status FROM transactions WHERE id = ANY($1) ORDER BY status`,
    [[toCapture, toVoid]],
  );
  assert.deepEqual(
    rows.rows.map((r) => r.status),
    ["authorized", "authorized"],
  );

  // The API key still captures and voids: keys carry full merchant authority.
  const keyCapture = await app.inject({
    method: "POST",
    url: `/v1/transactions/${toCapture}/capture`,
    headers: { authorization: `Bearer ${rawKey}`, "idempotency-key": randomUUID() },
    payload: {},
  });
  assert.equal(keyCapture.statusCode, 200, keyCapture.body);
  const keyVoid = await app.inject({
    method: "POST",
    url: `/v1/transactions/${toVoid}/void`,
    headers: { authorization: `Bearer ${rawKey}` },
  });
  assert.equal(keyVoid.statusCode, 200, keyVoid.body);
});
