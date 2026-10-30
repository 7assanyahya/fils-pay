/**
 * UX (admin console): the API key list must say when a key was rotated and
 * until when it keeps working, so the console can show "rotated, works
 * until …" instead of a live-looking row with a Rotate button that the API
 * now refuses. Requires a real, migrated Postgres via DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { loadConfig } from "../config.js";
import { rotateApiKeyAsAdmin } from "../admin/apiKeys.js";
import { issueApiKey, listApiKeys } from "./issue.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("listRevokeAfter.new.test.ts requires DATABASE_URL (run `npm run migrate` first)");
}
const config = loadConfig({ DATABASE_URL: databaseUrl, NODE_ENV: "test" });
const pool = new Pool({ connectionString: databaseUrl, max: 2 });

test.after(async () => {
  await pool.end();
});

test("listApiKeys reports revokeAfter for a rotated key and null for the current one", async () => {
  const merchantId = (
    await pool.query<{ id: string }>(`INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`, [
      `Key list ${randomUUID()}`,
    ])
  ).rows[0]!.id;
  const ownerId = (
    await pool.query<{ id: string }>(
      `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
      [merchantId, `owner-${randomUUID()}@example.test`],
    )
  ).rows[0]!.id;
  const adminUserId = (
    await pool.query<{ id: string }>(
      `INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, 'unused', 'Keys', 'finance') RETURNING id`,
      [`keys-${randomUUID()}@admin.test`],
    )
  ).rows[0]!.id;
  const original = await issueApiKey(pool, config, { merchantId, createdBy: ownerId, label: "list" });
  const rotated = await rotateApiKeyAsAdmin(pool, config, { merchantId, apiKeyId: original.id, adminUserId });

  const keys = await listApiKeys(pool, merchantId);
  const oldKey = keys.find((k) => k.id === original.id)!;
  const newKey = keys.find((k) => k.id === rotated.id)!;
  assert.ok(oldKey.revokeAfter instanceof Date && oldKey.revokeAfter.getTime() > Date.now());
  assert.equal(newKey.revokeAfter, null);
  assert.equal("keyHash" in oldKey, false);
});
