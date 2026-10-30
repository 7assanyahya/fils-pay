/**
 * QA follow-up (UC6): deleting a webhook endpoint that has delivery history
 * answered 500 — webhook_deliveries.endpoint_id (0022) and
 * webhook_delivery_archives.endpoint_id (0068) were NOT NULL foreign keys
 * with no ON DELETE action. Deliveries are never deleted (0068's header), so
 * the endpoint row goes and the history stays with endpoint_id = NULL, as
 * webhooks/cancel.ts documents. Requires a real, migrated Postgres.
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
  throw new Error("webhooks.deleteWithDeliveries.new.test.ts requires DATABASE_URL (run `npm run migrate` first)");
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

test("an endpoint with deliveries and an archive can be deleted; its history is kept", async () => {
  const merchantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
      [`Delete endpoint ${randomUUID()}`],
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
  const { rawKey } = await issueApiKey(pool, config, { merchantId, createdBy: ownerId, label: "delete-ep" });
  const headers = { authorization: `Bearer ${rawKey}` };

  const created = await app.inject({
    method: "POST",
    url: `/v1/merchants/${merchantId}/webhook-endpoints`,
    headers,
    payload: { url: "http://localhost:9/webhook" },
  });
  assert.equal(created.statusCode, 201, created.body);
  const endpointId = (created.json() as { id: string }).id;

  const outboxId = (
    await pool.query<{ id: string }>(
      `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
       VALUES ('admin.test.delete_fixture', 'transaction', $1, '{}'::jsonb) RETURNING id`,
      [randomUUID()],
    )
  ).rows[0]!.id;
  const deliveryId = (
    await pool.query<{ id: string }>(
      `INSERT INTO webhook_deliveries (endpoint_id, outbox_event_id, event_type, delivery_event_id, payload, status)
       VALUES ($1, $2, 'admin.test.delete_fixture', $3, '{}'::jsonb, 'succeeded') RETURNING id`,
      [endpointId, outboxId, randomUUID()],
    )
  ).rows[0]!.id;
  const adminId = (
    await pool.query<{ id: string }>(
      `INSERT INTO admin_users (email, password_hash, display_name, role)
       VALUES ($1, 'unused', 'Delete Test', 'support') RETURNING id`,
      [`del-${randomUUID()}@admin.test`],
    )
  ).rows[0]!.id;
  const archiveId = (
    await pool.query<{ id: string }>(
      `INSERT INTO webhook_delivery_archives
         (endpoint_id, merchant_id, created_by_admin_user_id, from_created_at, to_created_at, delivery_count, archive_payload)
       VALUES ($1, $2, $3, now() - interval '1 day', now(), 1, '[]') RETURNING id`,
      [endpointId, merchantId, adminId],
    )
  ).rows[0]!.id;

  const deleted = await app.inject({
    method: "DELETE",
    url: `/v1/merchants/${merchantId}/webhook-endpoints/${endpointId}`,
    headers,
  });
  assert.equal(deleted.statusCode, 204, deleted.body);

  const delivery = await pool.query<{ endpoint_id: string | null }>(
    `SELECT endpoint_id FROM webhook_deliveries WHERE id = $1`,
    [deliveryId],
  );
  assert.equal(delivery.rowCount, 1, "the delivery row is kept");
  assert.equal(delivery.rows[0]!.endpoint_id, null);
  const archive = await pool.query<{ endpoint_id: string | null }>(
    `SELECT endpoint_id FROM webhook_delivery_archives WHERE id = $1`,
    [archiveId],
  );
  assert.equal(archive.rowCount, 1, "the archive row is kept");
  assert.equal(archive.rows[0]!.endpoint_id, null);
});
