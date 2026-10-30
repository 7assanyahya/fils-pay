/**
 * UC6 (QA pass): a malformed UUID in a merchant-facing path must be a 404,
 * like the admin routes already answer (admin.test.ts "404s for an unknown
 * or malformed id"), not a 500 leaked from Postgres' invalid-uuid error
 * (SQLSTATE 22P02). Requires a real, migrated Postgres via DATABASE_URL.
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
  throw new Error("errorHandler.malformedId.new.test.ts requires DATABASE_URL (run `npm run migrate` first)");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});

const pool = new Pool({ connectionString: databaseUrl, max: 3 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

test("malformed ids in merchant routes answer 404, not 500", async () => {
  const merchantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
      [`Malformed id ${randomUUID()}`],
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
  const { rawKey } = await issueApiKey(pool, config, { merchantId, createdBy: ownerId, label: "malformed" });
  const headers = { authorization: `Bearer ${rawKey}` };

  const requests = [
    { method: "GET" as const, url: "/v1/transactions/not-a-uuid" },
    { method: "GET" as const, url: "/v1/transactions/not-a-uuid/events" },
    { method: "DELETE" as const, url: `/v1/merchants/${merchantId}/payment-links/not-a-uuid` },
    { method: "GET" as const, url: `/v1/merchants/${merchantId}/webhook-endpoints/not-a-uuid/deliveries` },
  ];
  for (const req of requests) {
    const res = await app.inject({ ...req, headers });
    assert.equal(res.statusCode, 404, `${req.method} ${req.url} -> ${res.statusCode} ${res.body}`);
  }
});
