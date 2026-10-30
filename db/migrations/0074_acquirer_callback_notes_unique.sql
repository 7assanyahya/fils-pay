-- FP-238, never actually shipped (see the AM note in 0051): one note per
-- acquirer callback_id. The application-level "does it already exist?"
-- check can't stop two concurrent deliveries of the same callback from both
-- inserting; this index can, and applyAcquirerCallback now inserts with
-- ON CONFLICT (callback_id) DO NOTHING.
--
-- Duplicates already written by the bug are removed first, keeping the
-- earliest-received note for each callback_id (they are identical copies of
-- the same acquirer message).

DELETE FROM acquirer_callback_notes n
 USING acquirer_callback_notes keep
 WHERE n.callback_id = keep.callback_id
   AND (keep.created_at, keep.id) < (n.created_at, n.id);

CREATE UNIQUE INDEX acquirer_callback_notes_callback_id_key
    ON acquirer_callback_notes (callback_id);
