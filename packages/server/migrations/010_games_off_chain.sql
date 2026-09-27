-- Games are no longer published on chain: their history stays in the database (game_events, hash-chained).
-- Game records still waiting in the outbox are dropped, the transactions that carried them are closed,
-- and the alerts they raised are resolved. Records already on chain (INCLUDED, IRREVERSIBLE) are kept as history.
ALTER TABLE blockchain_events DISABLE TRIGGER blockchain_events_no_delete;
DELETE FROM blockchain_events WHERE kind = 'GAME_RECORD' AND status IN ('BUILT', 'BROADCAST');
ALTER TABLE blockchain_events ENABLE TRIGGER blockchain_events_no_delete;

UPDATE blockchain_transactions SET status = 'EXPIRED', updated_at = now() WHERE purpose = 'GAME_RECORDS' AND status = 'BROADCAST';

UPDATE chain_alerts SET resolved_at = now() WHERE resolved_at IS NULL AND details->>'gameId' IS NOT NULL;
