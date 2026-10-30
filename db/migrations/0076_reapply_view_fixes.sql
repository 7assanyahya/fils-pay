-- Commit 90341b3 fixed these views by editing 0054 and 0072 in place. The
-- migration runner skips any file it has already applied (by name), so no
-- existing database ever received those fixes (and fresh installs got a
-- different schema from everyone else). The edited files stay as
-- they are (the original 0054 referenced a table that no longer exists, so
-- a fresh install needs the edit); this migration brings every database
-- that already ran 0054/0072 to the same definitions.

-- merchant_payable_position is the ADR-0004 "settled data" source that
-- ledger.RefreshBalanceCache reads (and its tests pin). 90341b3 rewrote it
-- to a ledger sum in 0054 — so fresh installs and existing databases
-- disagreed. Pinned back to the ADR-0004 definition here so every database
-- matches. The admin "Recalculate cached balances" button no longer uses
-- this path (it walks the ledger via RebuildAllBalances), which is what
-- actually fixed the 135K -> 7K balance drop.
DROP VIEW IF EXISTS merchant_payable_position;
CREATE VIEW merchant_payable_position AS
SELECT sb.merchant_id,
       COALESCE(SUM(sel.amount_fils), 0) AS payable_fils
  FROM scheme_export_lines sel
  JOIN settlement_batches sb ON sb.id = sel.settlement_batch_id
 GROUP BY sb.merchant_id;

-- Same eligibility rule CloseBatch uses: both capture event types, not yet
-- claimed by a batch.
CREATE OR REPLACE VIEW v_unbatched_capture_events AS
SELECT te.id AS event_id,
       te.transaction_id,
       te.event_type,
       te.amount_fils,
       te.created_at,
       t.merchant_id
  FROM transaction_events te
  JOIN transactions t ON t.id = te.transaction_id
 WHERE te.event_type IN ('captured', 'partially_captured')
   AND te.settlement_batch_id IS NULL;

-- A key past its rotation grace period (revoke_after) is no longer active —
-- same rule verifyApiKey applies.
CREATE OR REPLACE VIEW v_active_api_keys AS
SELECT ak.id,
       ak.merchant_id,
       ak.key_prefix,
       ak.created_at,
       ak.label
  FROM api_keys ak
 WHERE ak.revoked_at IS NULL
   AND (ak.revoke_after IS NULL OR ak.revoke_after > now());

-- 0072 joined refunds to transactions on t.id = r.id (a refund's own id),
-- which matches nothing, so original_captured_fils was always NULL.
DROP MATERIALIZED VIEW IF EXISTS refund_merchant_summary;
CREATE MATERIALIZED VIEW refund_merchant_summary AS
SELECT
    r.merchant_id,
    date_trunc('day', r.occurred_at AT TIME ZONE 'Asia/Bahrain') AS business_date,
    COUNT(*)                     AS refund_count,
    SUM(r.amount_fils)           AS total_refunded_fils,
    SUM(r.fee_reversed_fils)     AS total_fee_reversed_fils,
    SUM(t.captured_fils)         AS original_captured_fils
FROM refunds r
JOIN transactions t ON t.id = r.transaction_id
WHERE r.status = 'succeeded'
GROUP BY r.merchant_id, date_trunc('day', r.occurred_at AT TIME ZONE 'Asia/Bahrain');

CREATE UNIQUE INDEX idx_refund_merchant_summary_pk
    ON refund_merchant_summary (merchant_id, business_date);
