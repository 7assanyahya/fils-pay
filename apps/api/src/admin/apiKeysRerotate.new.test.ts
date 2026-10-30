/**
 * UC8 (QA pass): rotating a key that was already rotated must not re-arm
 * its grace period. rotateApiKeyAsAdmin only refused revoked keys, so a
 * second rotate of the old key set revoke_after = now() + 24h again: an
 * old key whose grace had already expired started authenticating again.
 * Requires a real, migrated Postgres via DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { verifyApiKey } from "../apiKeys/verify.js";
import { rotateApiKeyAsAdmin } from "./apiKeys.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("apiKeysRerotate.new.test.ts requires DATABASE_URL (run `npm run migrate` first)");
}

const config = loadConfig({ DATABASE_URL: databaseUrl, NODE_ENV: "test" });
const pool = new Pool({ connectionString: databaseUrl, max: 3 });

test.after(async () => {
  await pool.end();
});

test("an already-rotated key cannot be rotated again, and its expired grace stays expired", async () => {
  const merchantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
      [`Rerotate ${randomUUID()}`],
    )
  ).rows[0]!.id;
  const ownerId = (
    await pool.query<{ id: string }>(
      `INSERT INTO merchant_users (merchant_id, email, role, password_hash)
       VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
      [merchantId, `owner-${randomUUID()}@example.test`],
    )
  ).rows[0]!.id;
  const original = await issueApiKey(pool, config, { merchantId, createdBy: ownerId, label: "rerotate" });
  const adminUserId = (
    await pool.query<{ id: string }>(
      `INSERT INTO admin_users (email, password_hash, display_name, role)
       VALUES ($1, 'unused', 'Rerotate Test', 'finance') RETURNING id`,
      [`rerot-${randomUUID()}@filspay.test`],
    )
  ).rows[0]!.id;

  await rotateApiKeyAsAdmin(pool, config, { merchantId, apiKeyId: original.id, adminUserId });
  await pool.query(`UPDATE api_keys SET revoke_after = now() - interval '1 second' WHERE id = $1`, [original.id]);
  assert.equal(await verifyApiKey(pool, original.rawKey), null, "grace over: old key is dead");

  await assert.rejects(
    rotateApiKeyAsAdmin(pool, config, { merchantId, apiKeyId: original.id, adminUserId }),
    (err: { statusCode?: number }) => err.statusCode === 409,
  );
  assert.equal(await verifyApiKey(pool, original.rawKey), null, "re-rotating must not resurrect the old key");

  const keys = await pool.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM api_keys WHERE merchant_id = $1`, [
    merchantId,
  ]);
  assert.equal(keys.rows[0]!.c, 2, "no third key issued");
});
