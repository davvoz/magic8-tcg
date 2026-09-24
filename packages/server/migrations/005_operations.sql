-- M6 operations: refunds confirmed on chain. Design notes: docs/tcg/07-runbook.md

-- The transfer that paid a refund, as seen in the shop's history (the operator sends it with Keychain;
-- the server never takes the operator's word for it) and confirmed like an incoming payment.
ALTER TABLE refunds ADD COLUMN refund_op_index INTEGER;
ALTER TABLE refunds ADD COLUMN refund_block_num BIGINT;
ALTER TABLE refunds ADD COLUMN refund_time TIMESTAMPTZ;
ALTER TABLE refunds ADD COLUMN confirmed_at TIMESTAMPTZ;
ALTER TABLE refunds ADD CONSTRAINT refunds_sent_has_transfer
  CHECK (status = 'PENDING' OR (refund_tx_id IS NOT NULL AND refund_op_index IS NOT NULL AND refund_block_num IS NOT NULL AND refund_time IS NOT NULL));
CREATE INDEX refunds_open ON refunds (status, created_at) WHERE status IN ('PENDING', 'SENT');

-- Is a payload (a pack epoch's commitment) on chain yet: looked up by its hash before selling packs.
CREATE INDEX blockchain_events_payload_hash ON blockchain_events (payload_hash);
