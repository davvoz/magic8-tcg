-- A finished game publishes one small result (m8tcg_result) committing to its whole history (docs/tcg/03 §9).
ALTER TABLE blockchain_events DROP CONSTRAINT blockchain_events_kind_check;
ALTER TABLE blockchain_events ADD CONSTRAINT blockchain_events_kind_check CHECK (kind IN ('GAME_RECORD', 'RECEIPT', 'EPOCH', 'TRADE', 'SALE', 'RESULT'));
ALTER TABLE blockchain_transactions DROP CONSTRAINT blockchain_transactions_purpose_check;
ALTER TABLE blockchain_transactions ADD CONSTRAINT blockchain_transactions_purpose_check CHECK (purpose IN ('GAME_RECORDS', 'RECEIPT', 'EPOCH', 'MANIFEST', 'TRADE', 'SALE', 'RESULT'));
-- One result per game, whatever retries the server makes.
CREATE UNIQUE INDEX blockchain_events_one_result ON blockchain_events (game_id) WHERE kind = 'RESULT';
