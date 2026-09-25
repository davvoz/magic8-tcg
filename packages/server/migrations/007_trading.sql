-- M7.5 card-for-card trades with escrow (docs/tcg/13-scambi.md).

-- An offer: the proposer's copies are locked (card_instances.status = 'locked') until it is accepted,
-- declined, cancelled or expires. `wants` names what the proposer asks for: definition ids and counts.
CREATE TABLE trades (
  id               UUID PRIMARY KEY,
  proposer_id      UUID NOT NULL REFERENCES users (id),
  counterparty_id  UUID NOT NULL REFERENCES users (id),
  status           TEXT NOT NULL CHECK (status IN ('OPEN', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED')),
  wants            JSONB NOT NULL,
  idempotency_key  TEXT NOT NULL,
  request_hash     TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL,
  expires_at       TIMESTAMPTZ NOT NULL,
  closed_at        TIMESTAMPTZ,
  UNIQUE (proposer_id, idempotency_key),
  CHECK (proposer_id <> counterparty_id),
  CHECK ((status = 'OPEN') = (closed_at IS NULL))
);
CREATE INDEX trades_open_proposer ON trades (proposer_id) WHERE status = 'OPEN';
CREATE INDEX trades_open_counterparty ON trades (counterparty_id) WHERE status = 'OPEN';
CREATE INDEX trades_expiry ON trades (expires_at) WHERE status = 'OPEN';
CREATE INDEX trades_party_recent ON trades (proposer_id, created_at DESC);
CREATE INDEX trades_counterparty_recent ON trades (counterparty_id, created_at DESC);

-- The copies of a trade: 'give' offered by the proposer (from the offer on), 'take' given by the counterparty (on acceptance).
CREATE TABLE trade_items (
  trade_id          UUID NOT NULL REFERENCES trades (id),
  card_instance_id  UUID NOT NULL REFERENCES card_instances (id),
  side              TEXT NOT NULL CHECK (side IN ('give', 'take')),
  PRIMARY KEY (trade_id, card_instance_id)
);
CREATE TRIGGER trade_items_append_only BEFORE UPDATE OR DELETE ON trade_items
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Completed trades are published by the broadcaster pool (m8tcg_trade).
ALTER TABLE blockchain_events DROP CONSTRAINT blockchain_events_kind_check;
ALTER TABLE blockchain_events ADD CONSTRAINT blockchain_events_kind_check CHECK (kind IN ('GAME_RECORD', 'RECEIPT', 'EPOCH', 'TRADE'));
ALTER TABLE blockchain_transactions DROP CONSTRAINT blockchain_transactions_purpose_check;
ALTER TABLE blockchain_transactions ADD CONSTRAINT blockchain_transactions_purpose_check CHECK (purpose IN ('GAME_RECORDS', 'RECEIPT', 'EPOCH', 'MANIFEST', 'TRADE'));
