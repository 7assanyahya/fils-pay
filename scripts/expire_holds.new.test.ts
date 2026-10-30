import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "pg";
import { expireHolds } from "./expire_holds.js";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://filspay:filspay_dev_password@localhost:5432/filspay?sslmode=disable";

test("expireHolds flips expired active holds to 'expired' in place without deleting them", async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    // Create an active merchant
    const merchantRes = await client.query<{ id: string }>(
      `INSERT INTO merchants (display_name, mdr_bps, status, test_mode)
       VALUES ('expire-holds-test-' || gen_random_uuid(), 250, 'active', false)
       RETURNING id`,
    );
    const merchantId = merchantRes.rows[0]!.id;

    // 1. Expired active hold (should become 'expired')
    const expiredRes = await client.query<{ id: string }>(
      `INSERT INTO holds (merchant_id, amount_fils, status, expires_at)
       VALUES ($1, 5000, 'active', now() - interval '1 hour')
       RETURNING id`,
      [merchantId],
    );
    const expiredHoldId = expiredRes.rows[0]!.id;

    // 2. Unexpired active hold (should remain 'active')
    const unexpiredRes = await client.query<{ id: string }>(
      `INSERT INTO holds (merchant_id, amount_fils, status, expires_at)
       VALUES ($1, 7000, 'active', now() + interval '1 hour')
       RETURNING id`,
      [merchantId],
    );
    const unexpiredHoldId = unexpiredRes.rows[0]!.id;

    // 3. Already released hold (should remain 'released')
    const releasedRes = await client.query<{ id: string }>(
      `INSERT INTO holds (merchant_id, amount_fils, status, expires_at)
       VALUES ($1, 3000, 'released', now() - interval '1 hour')
       RETURNING id`,
      [merchantId],
    );
    const releasedHoldId = releasedRes.rows[0]!.id;

    // Run expiration
    const affected = await expireHolds(client);
    assert.ok(affected >= 1, "at least our expired hold was affected");

    // Check expired hold: still exists and has status = 'expired'
    const checkExpired = await client.query<{ status: string }>(
      `SELECT status FROM holds WHERE id = $1`,
      [expiredHoldId],
    );
    assert.equal(checkExpired.rows.length, 1, "expired hold must not be deleted from table");
    assert.equal(checkExpired.rows[0]!.status, "expired");

    // Check unexpired hold: still active
    const checkUnexpired = await client.query<{ status: string }>(
      `SELECT status FROM holds WHERE id = $1`,
      [unexpiredHoldId],
    );
    assert.equal(checkUnexpired.rows.length, 1);
    assert.equal(checkUnexpired.rows[0]!.status, "active");

    // Check released hold: still released
    const checkReleased = await client.query<{ status: string }>(
      `SELECT status FROM holds WHERE id = $1`,
      [releasedHoldId],
    );
    assert.equal(checkReleased.rows.length, 1);
    assert.equal(checkReleased.rows[0]!.status, "released");
  } finally {
    await client.end();
  }
});
