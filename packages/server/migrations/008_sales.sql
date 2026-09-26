-- M7.6 selling copies between players for STEEM, paid directly to the seller (docs/tcg/14-vendite.md).

-- A copy on the public board. The copy is locked (card_instances.status = 'locked') while the listing is ACTIVE.
CREATE TABLE listings (
  id                UUID PRIMARY KEY,
  seller_id         UUID NOT NULL REFERENCES users (id),
  card_instance_id  UUID NOT NULL REFERENCES card_instances (id),
  definition_id     TEXT NOT NULL,                       -- the copy's card, for the board's filter
  network           TEXT NOT NULL,
  asset             TEXT NOT NULL,
  price             BIGINT NOT NULL CHECK (price > 0),   -- in the asset's smallest unit
  status            TEXT NOT NULL CHECK (status IN ('ACTIVE', 'SOLD', 'CANCELLED', 'EXPIRED')),
  idempotency_key   TEXT NOT NULL,
  request_hash      TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  closed_at         TIMESTAMPTZ,
  UNIQUE (seller_id, idempotency_key),
  CHECK ((status = 'ACTIVE') = (closed_at IS NULL))
);
-- A copy is on the board at most once at a time.
CREATE UNIQUE INDEX listings_one_active_per_copy ON listings (card_instance_id) WHERE status = 'ACTIVE';
CREATE INDEX listings_board_recent ON listings (created_at DESC) WHERE status = 'ACTIVE';
CREATE INDEX listings_board_card ON listings (definition_id, price) WHERE status = 'ACTIVE';
CREATE INDEX listings_expiry ON listings (expires_at) WHERE status = 'ACTIVE';
CREATE INDEX listings_seller_recent ON listings (seller_id, created_at DESC);

-- A buyer's reservation of a listing: they pay the seller directly, with `memo`, before `expires_at`.
-- `cursor` is how far the seller's account history has been read for this payment (from `start_cursor`).
CREATE TABLE listing_purchases (
  id              UUID PRIMARY KEY,
  listing_id      UUID NOT NULL REFERENCES listings (id),
  buyer_id        UUID NOT NULL REFERENCES users (id),
  payer           TEXT NOT NULL,
  receiver        TEXT NOT NULL,
  network         TEXT NOT NULL,
  asset           TEXT NOT NULL,
  amount          BIGINT NOT NULL CHECK (amount > 0),
  memo            TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL CHECK (status IN ('PENDING', 'DETECTED', 'COMPLETED', 'EXPIRED', 'CANCELLED')),
  start_cursor    BIGINT NOT NULL,
  cursor          BIGINT NOT NULL,
  tx_id           TEXT,
  op_index        INTEGER,
  block_num       BIGINT,
  block_time      TIMESTAMPTZ,
  problem         TEXT,
  -- The last transfer that left the chain after it was detected: a lagging history must not bring it back.
  vanished_tx_id     TEXT,
  vanished_block_num BIGINT,
  created_at      TIMESTAMPTZ NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  closed_at       TIMESTAMPTZ,
  CHECK (payer <> receiver),
  CHECK ((status IN ('PENDING', 'DETECTED')) = (closed_at IS NULL)),
  CHECK ((status IN ('DETECTED', 'COMPLETED')) = (tx_id IS NOT NULL))
);
-- One buyer at a time per listing, one completed sale per listing, and a transfer pays one purchase, ever.
CREATE UNIQUE INDEX listing_purchases_one_live ON listing_purchases (listing_id) WHERE status IN ('PENDING', 'DETECTED');
CREATE UNIQUE INDEX listing_purchases_one_completed ON listing_purchases (listing_id) WHERE status = 'COMPLETED';
CREATE UNIQUE INDEX listing_purchases_transfer ON listing_purchases (network, tx_id, op_index) WHERE tx_id IS NOT NULL;
CREATE INDEX listing_purchases_live ON listing_purchases (created_at) WHERE status IN ('PENDING', 'DETECTED');
CREATE INDEX listing_purchases_buyer_recent ON listing_purchases (buyer_id, created_at DESC);

-- Completed sales are published by the broadcaster pool (m8tcg_sale).
ALTER TABLE blockchain_events DROP CONSTRAINT blockchain_events_kind_check;
ALTER TABLE blockchain_events ADD CONSTRAINT blockchain_events_kind_check CHECK (kind IN ('GAME_RECORD', 'RECEIPT', 'EPOCH', 'TRADE', 'SALE'));
ALTER TABLE blockchain_transactions DROP CONSTRAINT blockchain_transactions_purpose_check;
ALTER TABLE blockchain_transactions ADD CONSTRAINT blockchain_transactions_purpose_check CHECK (purpose IN ('GAME_RECORDS', 'RECEIPT', 'EPOCH', 'MANIFEST', 'TRADE', 'SALE'));
