-- Adds refund aggregate columns to merchant_daily_volume for the reporting worker.

ALTER TABLE merchant_daily_volume
    ADD COLUMN IF NOT EXISTS refund_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS refund_gross_fils BIGINT NOT NULL DEFAULT 0;
