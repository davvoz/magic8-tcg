-- Copies the game gives away go on chain too (m8tcg_grant, docs/tcg/03 §12b): the free starter deck and the daily
-- challenges' packs, so every copy that is traded or sold can be traced back to its mint.
ALTER TABLE blockchain_events DROP CONSTRAINT blockchain_events_kind_check;
ALTER TABLE blockchain_events ADD CONSTRAINT blockchain_events_kind_check CHECK (kind IN ('GAME_RECORD', 'RECEIPT', 'EPOCH', 'TRADE', 'SALE', 'RESULT', 'GRANT'));
ALTER TABLE blockchain_transactions DROP CONSTRAINT blockchain_transactions_purpose_check;
ALTER TABLE blockchain_transactions ADD CONSTRAINT blockchain_transactions_purpose_check CHECK (purpose IN ('GAME_RECORDS', 'RECEIPT', 'EPOCH', 'MANIFEST', 'TRADE', 'SALE', 'RESULT', 'GRANT'));
