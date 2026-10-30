-- lifetime_net_payout_monitoring_estimate was REAL (float4): 24-bit
-- mantissa, so once a merchant's running total passed ~16.7M fils
-- (16,777 BD) every further payout was rounded — "lifetime payout estimate
-- drifts for high-volume merchants". DOUBLE PRECISION holds every integer
-- fils amount exactly up to 2^53. The drifted values are recomputed from
-- the paid batches they were meant to sum.

ALTER TABLE merchants
    ALTER COLUMN lifetime_net_payout_monitoring_estimate TYPE DOUBLE PRECISION;

UPDATE merchants m
   SET lifetime_net_payout_monitoring_estimate = COALESCE((
         SELECT SUM(sb.net_payout_fils)
           FROM settlement_batches sb
          WHERE sb.merchant_id = m.id AND sb.status = 'paid'
       ), 0);
