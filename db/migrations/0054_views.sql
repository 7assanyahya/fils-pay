-- Convenience views used by the API and admin dashboard.

CREATE OR REPLACE VIEW merchant_payable_position AS
SELECT le.merchant_id,
       COALESCE(SUM(CASE WHEN le.direction = 'credit' THEN le.amount_fils ELSE -le.amount_fils END), 0)::BIGINT AS payable_fils
  FROM ledger_entries le
 WHERE le.account_id = 'merchant_payable'
 GROUP BY le.merchant_id;

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

CREATE OR REPLACE VIEW v_active_api_keys AS
SELECT ak.id,
       ak.merchant_id,
       ak.key_prefix,
       ak.created_at,
       ak.label
  FROM api_keys ak
 WHERE ak.revoked_at IS NULL;
