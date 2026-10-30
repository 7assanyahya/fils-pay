/**
 * - API key rotation schedules the old key's revocation and it takes effect.
 * - FP-203: an expired link can't be paid by sending an earlier submittedAt.
 * - Incident 2026-05-14: two concurrent pays on one link charge one card.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { verifyApiKey } from "../apiKeys/verify.js";
import { rotateApiKeyAsAdmin } from "../admin/apiKeys.js";
import { recordKycReview } from "../onboarding/review.js";
import type { AcquirerSimulator } from "../acquirer/types.js";
import { payPaymentLink } from "./pay.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("linkAndKeyFixes.new.test.ts requires DATABASE_URL");
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

const pool = new Pool({ connectionString: databaseUrl, max: 10 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

const CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

async function merchantWithKey() {
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Link/Key Fixes ${randomUUID()}`],
  );
  const merchantId = m.rows[0]!.id;
  const u = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash)
     VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const issued = await issueApiKey(pool, config, { merchantId, createdBy: u.rows[0]!.id, label: "t" });
  return { merchantId, keyId: issued.id, rawKey: issued.rawKey };
}

async function createLink(merchantId: string, rawKey: string) {
  const res = await app.inject({
    method: "POST",
    url: `/v1/merchants/${merchantId}/payment-links`,
    headers: { authorization: `Bearer ${rawKey}` },
    payload: { amountFils: 4_750, reference: "fixes", expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json() as { id: string; token: string };
}

test("admin API key rotation: old key works through the grace period, then stops", async () => {
  const { merchantId, keyId, rawKey } = await merchantWithKey();
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, password_hash, display_name, role)
     VALUES ($1, 'unused', 'Rotation Test', 'finance') RETURNING id`,
    [`rot-${randomUUID()}@filspay.test`],
  );

  const rotated = await rotateApiKeyAsAdmin(pool, config, { merchantId, apiKeyId: keyId, adminUserId: admin.rows[0]!.id });

  assert.ok(await verifyApiKey(pool, rawKey), "old key still works during the grace period");
  const row = await pool.query<{ hours: number }>(
    `SELECT EXTRACT(EPOCH FROM revoke_after - now()) / 3600 AS hours FROM api_keys WHERE id = $1`,
    [keyId],
  );
  assert.ok(row.rows[0]!.hours > 23 && row.rows[0]!.hours <= 24, "revocation scheduled ~24h out");

  // Grace period over.
  await pool.query(`UPDATE api_keys SET revoke_after = now() - interval '1 second' WHERE id = $1`, [keyId]);
  assert.equal(await verifyApiKey(pool, rawKey), null, "old key must stop authenticating after the grace period");
  assert.ok(await verifyApiKey(pool, rotated.rawKey), "new key authenticates");
});

test("FP-203: an expired link is rejected even when the client claims it pressed pay earlier", async () => {
  const { merchantId, rawKey } = await merchantWithKey();
  const link = await createLink(merchantId, rawKey);
  await pool.query(`UPDATE payment_links SET expires_at = now() - interval '1 hour' WHERE id = $1`, [link.id]);

  const res = await app.inject({
    method: "POST",
    url: `/v1/payment-links/${link.token}/pay`,
    headers: { "idempotency-key": randomUUID() },
    payload: { card: CARD, submittedAt: new Date(Date.now() - 2 * 3_600_000).toISOString() },
  });
  assert.equal(res.statusCode, 410, res.body);
  const row = await pool.query<{ status: string }>(`SELECT status FROM payment_links WHERE id = $1`, [link.id]);
  assert.equal(row.rows[0]!.status, "active", "nothing was charged");
});

test("incident 2026-05-14: a slow pay outliving the reservation can't let a second buyer pay the same link", async () => {
  const { merchantId, rawKey } = await merchantWithKey();
  const link = await createLink(merchantId, rawKey);

  let captures = 0;
  const slowAcquirer: AcquirerSimulator = {
    async authorize() {
      await new Promise((r) => setTimeout(r, 300));
      return { outcome: "approved", acquirerReference: `acq_${randomUUID()}`, latencyMs: 300 };
    },
    async capture(req) {
      captures++;
      return { outcome: "approved", acquirerReference: req.acquirerReference, latencyMs: 0 };
    },
    refund() {
      throw new Error("not used");
    },
  };
  // Reservation timeout of 0s: the first attempt's reservation is "stale"
  // immediately, which is exactly the slow-capture case from the incident.
  const cfg = { paymentLinkReservationTimeoutSeconds: 0 };

  const first = payPaymentLink(pool, slowAcquirer, cfg, { token: link.token, card: CARD, idempotencyKey: randomUUID() });
  await new Promise((r) => setTimeout(r, 50));
  const second = payPaymentLink(pool, slowAcquirer, cfg, { token: link.token, card: CARD, idempotencyKey: randomUUID() });
  const results = await Promise.all([first, second]);

  assert.deepEqual(
    results.map((r) => r.statusCode).sort(),
    [200, 409],
    JSON.stringify(results),
  );
  assert.equal(captures, 1, "exactly one card charged");
});
