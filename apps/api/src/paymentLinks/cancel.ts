import type { Pool } from "pg";

export type CancelPaymentLinkResult =
  | { outcome: "canceled" }
  | { outcome: "not_found" }
  | { outcome: "not_cancelable"; status: string };

/** Cancels an active payment link by id, scoped to the owning merchant. */
export async function cancelPaymentLink(
  pool: Pool,
  input: { id: string; merchantId?: string },
): Promise<CancelPaymentLinkResult> {
  const updateQuery = input.merchantId
    ? `UPDATE payment_links
          SET status = 'canceled', canceled_at = now()
        WHERE id = $1 AND merchant_id = $2 AND status = 'active'
        RETURNING id`
    : `UPDATE payment_links
          SET status = 'canceled', canceled_at = now()
        WHERE id = $1 AND status = 'active'
        RETURNING id`;
  const updateParams = input.merchantId ? [input.id, input.merchantId] : [input.id];

  const updateResult = await pool.query<{ id: string }>(updateQuery, updateParams);
  if (updateResult.rows[0]) {
    return { outcome: "canceled" };
  }

  // Second read is just for the error shape
  const lookupQuery = input.merchantId
    ? `SELECT status FROM payment_links WHERE id = $1 AND merchant_id = $2`
    : `SELECT status FROM payment_links WHERE id = $1`;
  const lookupParams = input.merchantId ? [input.id, input.merchantId] : [input.id];

  const lookupResult = await pool.query<{ status: string }>(lookupQuery, lookupParams);
  const row = lookupResult.rows[0];
  if (!row) {
    return { outcome: "not_found" };
  }
  return { outcome: "not_cancelable", status: row.status };
}
