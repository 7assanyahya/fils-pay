/**
 * A settlement.batch_closed for a day that has real captures but no
 * merchant_daily_volume row yet must not crash the consumer pass — the
 * parity check only warns. Before the fix it threw "Cannot read properties
 * of undefined (reading 'captured_count')", rolling back the whole pass and
 * stalling reporting for every merchant.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { enqueueEvent } from "@filspay/events";
import { runConsumerPass } from "./runConsumerPass.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("batchClosedNoRollup.new.test.ts requires DATABASE_URL");
}

const pool = new Pool({ connectionString: databaseUrl, max: 5 });

test.after(async () => {
  await pool.end();
});

test("batch_closed with captures but no rollup row: pass completes and the payout trend is written", async () => {
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`No Rollup ${randomUUID()}`],
  );
  const merchantId = m.rows[0]!.id;

  // A real capture on 2026-02-03 (Bahrain), written straight to
  // transaction_events — no transaction.captured outbox event, so no rollup.
  const txn = await pool.query<{ id: string }>(
    `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference)
     VALUES ($1, 'captured', 5000, 5000, $2) RETURNING id`,
    [merchantId, `acq_${randomUUID()}`],
  );
  await pool.query(
    `INSERT INTO transaction_events (transaction_id, event_type, amount_fils, actor_type, occurred_at)
     VALUES ($1, 'captured', 5000, 'system', '2026-02-03T09:00:00Z')`,
    [txn.rows[0]!.id],
  );

  const batch = await pool.query<{ id: string }>(
    `INSERT INTO settlement_batches (merchant_id, batch_date, status, gross_fils, fee_fils, net_payout_fils, closed_at)
     VALUES ($1, '2026-02-03', 'closed', 5000, 125, 4875, now()) RETURNING id`,
    [merchantId],
  );
  await enqueueEvent(pool, {
    eventType: "settlement.batch_closed",
    aggregateType: "settlement_batch",
    aggregateId: batch.rows[0]!.id,
    payload: { merchantId, batchId: batch.rows[0]!.id, batchDate: "2026-02-03", grossFils: 5000, feeFils: 125, netPayoutFils: 4875 },
  });

  await runConsumerPass(pool, { consumerBatchLimit: 500 });

  const trend = await pool.query(`SELECT 1 FROM merchant_payout_trends WHERE merchant_id = $1`, [merchantId]);
  assert.equal(trend.rowCount, 1);
});
