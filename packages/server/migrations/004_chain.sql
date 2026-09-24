-- M5 on-chain history: sealing, broadcasting, tracking. Design notes: docs/tcg/03-game-blockchain-protocol.md §9 and §16

-- Pack epoch commitments and reveals are published by the broadcaster pool (m8tcg_epoch).
ALTER TABLE blockchain_events DROP CONSTRAINT blockchain_events_kind_check;
ALTER TABLE blockchain_events ADD CONSTRAINT blockchain_events_kind_check CHECK (kind IN ('GAME_RECORD', 'RECEIPT', 'EPOCH'));
ALTER TABLE blockchain_transactions DROP CONSTRAINT blockchain_transactions_purpose_check;
ALTER TABLE blockchain_transactions ADD CONSTRAINT blockchain_transactions_purpose_check CHECK (purpose IN ('GAME_RECORDS', 'RECEIPT', 'EPOCH', 'MANIFEST'));

-- Which transaction carries a record, and the records of a transaction.
CREATE INDEX blockchain_events_transaction ON blockchain_events (transaction_id);
-- Open transactions of one signer, checked by the tracker.
CREATE INDEX blockchain_transactions_signer_open ON blockchain_transactions (network, signer, status) WHERE status IN ('BROADCAST', 'INCLUDED');
-- One alert per anomaly: the tracker may see the same operation again after a restart.
ALTER TABLE chain_alerts ADD COLUMN fingerprint TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX chain_alerts_once ON chain_alerts (network, kind, fingerprint) WHERE fingerprint <> '';

-- A pack epoch's commitment and reveal each go to the outbox once.
ALTER TABLE rng_epochs ADD COLUMN commitment_published BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE rng_epochs ADD COLUMN reveal_published BOOLEAN NOT NULL DEFAULT false;
