-- DEF-02: Widen platform-wide volume counter from INTEGER (int32) to BIGINT (int64)
-- to prevent silent negative wrap above 2,147,483,647 fils (~2.15M BD).
ALTER TABLE platform_stats ALTER COLUMN total_processed_fils TYPE BIGINT;
