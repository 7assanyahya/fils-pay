/**
 * Inbound acquirer callback hardening: production-like config requires a
 * signature, rejects stale timestamps, verifies the raw bytes the acquirer
 * signed (not a re-serialization), and stores one note per callback_id even
 * when the same callback arrives twice at once.
 */
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("acquirerCallbacks.hardening.new.test.ts requires DATABASE_URL");
}

const SECRET = "acqsec_hardening_test_secret";

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
  ACQUIRER_CALLBACK_SIGNING_SECRET: SECRET,
  ACQUIRER_CALLBACK_REQUIRE_SIGNATURE: "true",
  ACQUIRER_CALLBACK_MAX_AGE_SECONDS: "300",
});

const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

async function createTransaction(): Promise<string> {
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Callback Hardening ${randomUUID()}`],
  );
  const t = await pool.query<{ id: string }>(
    `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference)
     VALUES ($1, 'captured', 50000, 50000, $2) RETURNING id`,
    [m.rows[0]!.id, `acqref_${randomUUID()}`],
  );
  return t.rows[0]!.id;
}

/** The acquirer's own serialization: different key order and spacing from
 *  JSON.stringify of the parsed object. */
function acquirerRawBody(transactionId: string, callbackId: string): string {
  return (
    `{ "type": "fraud_review.completed", "callbackId": "${callbackId}", ` +
    `"transactionId": "${transactionId}", "occurredAt": "2026-09-16T10:00:00.000Z", ` +
    `"outcome": "confirmed_fraud", "note": "card testing pattern" }`
  );
}

function sign(raw: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac("sha256", SECRET).update(`${timestamp}.${raw}`).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

function post(raw: string, signature?: string) {
  return app.inject({
    method: "POST",
    url: "/v1/acquirer/callbacks",
    headers: {
      "content-type": "application/json",
      ...(signature ? { "acquirer-callback-signature": signature } : {}),
    },
    payload: raw,
  });
}

test("unsigned callback is rejected when signatures are required", async () => {
  const res = await post(acquirerRawBody(await createTransaction(), `acqcb_${randomUUID()}`));
  assert.equal(res.statusCode, 401, res.body);
});

test("signature over the acquirer's exact bytes verifies even though key order differs from ours", async () => {
  const raw = acquirerRawBody(await createTransaction(), `acqcb_${randomUUID()}`);
  const res = await post(raw, sign(raw));
  assert.ok(res.statusCode < 300, res.body);
});

test("a correctly signed but stale callback (replay) is rejected", async () => {
  const raw = acquirerRawBody(await createTransaction(), `acqcb_${randomUUID()}`);
  const res = await post(raw, sign(raw, Math.floor(Date.now() / 1000) - 3600));
  assert.equal(res.statusCode, 401, res.body);
  assert.equal(res.json().message, "timestamp_out_of_range");
});

test("the same callback delivered twice at once stores exactly one note", async () => {
  const callbackId = `acqcb_${randomUUID()}`;
  const raw = acquirerRawBody(await createTransaction(), callbackId);
  const results = await Promise.all([post(raw, sign(raw)), post(raw, sign(raw)), post(raw, sign(raw))]);
  for (const r of results) assert.ok(r.statusCode < 300, r.body);

  const notes = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM acquirer_callback_notes WHERE callback_id = $1`,
    [callbackId],
  );
  assert.equal(notes.rows[0]!.n, "1");
});
