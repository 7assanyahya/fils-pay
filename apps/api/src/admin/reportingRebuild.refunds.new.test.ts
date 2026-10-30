/**
 * UC9 (QA pass): the admin "Rebuild analytics" action truncates
 * merchant_daily_volume and repopulated only the capture/void columns, so
 * every refund_count / refund_gross_fils rollup (0073, FP-300) was reset to
 * zero. The rebuild must restore refund rollups from `refunds`, on the same
 * Asia/Bahrain day key the reporting consumer uses. Requires a real,
 * migrated Postgres via DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { withTransaction } from "../db/withTransaction.js";
import { refreshAnalyticsRollups } from "./reportingRebuild.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("reportingRebuild.refunds.new.test.ts requires DATABASE_URL (run `npm run migrate` first)");
}

const pool = new Pool({ connectionString: databaseUrl, max: 2 });

test.after(async () => {
  await pool.end();
});

test("rebuilding analytics keeps refund rollups, bucketed by Bahrain day", async () => {
  const merchantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
      [`Rebuild refunds ${randomUUID()}`],
    )
  ).rows[0]!.id;
  const txnId = (
    await pool.query<{ id: string }>(
      `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, refunded_fils, acquirer_reference, occurred_at)
       VALUES ($1, 'partially_refunded', 10000, 10000, 3500, $2, '2026-03-01T10:00:00Z') RETURNING id`,
      [merchantId, `acq_${randomUUID()}`],
    )
  ).rows[0]!.id;
  // 2026-03-01T22:30Z is 01:30 on 2 March in Bahrain; 2026-03-01T10:00Z is 1 March.
  for (const [amount, at] of [
    [2_000, "2026-03-01T22:30:00Z"],
    [1_500, "2026-03-01T10:00:00Z"],
  ] as const) {
    await pool.query(
      `INSERT INTO refunds (transaction_id, merchant_id, amount_fils, fee_reversed_fils, status,
                            acquirer_reference, reason, created_by_type, created_by_id, occurred_at)
       VALUES ($1, $2, $3, 0, 'succeeded', 'acq_ref', 'test', 'merchant_api_key', $4, $5)`,
      [txnId, merchantId, amount, randomUUID(), at],
    );
  }

  await withTransaction(pool, (client) => refreshAnalyticsRollups(client));

  const rows = await pool.query<{ d: string; refund_count: number; refund_gross_fils: string }>(
    `SELECT volume_date::text AS d, refund_count, refund_gross_fils
       FROM merchant_daily_volume WHERE merchant_id = $1 ORDER BY volume_date`,
    [merchantId],
  );
  assert.deepEqual(
    rows.rows.map((r) => [r.d, r.refund_count, Number(r.refund_gross_fils)]),
    [
      ["2026-03-01", 1, 1_500],
      ["2026-03-02", 1, 2_000],
    ],
  );
});
