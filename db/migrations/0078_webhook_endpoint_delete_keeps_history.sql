-- Deleting a webhook endpoint that had any delivery history failed with a
-- foreign-key violation (500): webhook_deliveries.endpoint_id (0022) and
-- webhook_delivery_archives.endpoint_id (0068) were NOT NULL references with
-- no ON DELETE action. Deliveries are never deleted (0068's header), so keep
-- the history and detach it: the endpoint row goes, endpoint_id becomes NULL.
-- No rows are deleted or rewritten by this migration.

ALTER TABLE webhook_deliveries ALTER COLUMN endpoint_id DROP NOT NULL;
ALTER TABLE webhook_deliveries DROP CONSTRAINT IF EXISTS webhook_deliveries_endpoint_id_fkey;
ALTER TABLE webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_endpoint_id_fkey
    FOREIGN KEY (endpoint_id) REFERENCES webhook_endpoints (id) ON DELETE SET NULL;

ALTER TABLE webhook_delivery_archives ALTER COLUMN endpoint_id DROP NOT NULL;
ALTER TABLE webhook_delivery_archives DROP CONSTRAINT IF EXISTS webhook_delivery_archives_endpoint_id_fkey;
ALTER TABLE webhook_delivery_archives
    ADD CONSTRAINT webhook_delivery_archives_endpoint_id_fkey
    FOREIGN KEY (endpoint_id) REFERENCES webhook_endpoints (id) ON DELETE SET NULL;
