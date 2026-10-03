-- Entries: prepaid credits for paid game modes (ranked: one entry per game, bought in the shop).
-- Design notes: docs/tcg/22-ingressi-ranked.md

-- What each player holds now, per kind of entry. Never negative: a game is charged only when the entries are there.
CREATE TABLE entry_balances (
  user_id     UUID NOT NULL REFERENCES users (id),
  kind        TEXT NOT NULL,
  balance     INTEGER NOT NULL CHECK (balance >= 0),
  updated_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, kind)
);

-- Every change to a balance, append-only: a purchase credits (ref: the order), a game charges (ref: the game),
-- a game called off before it started gives the entries back (ref: the game). The unique key makes each one happen once.
CREATE TABLE entry_ledger (
  user_id     UUID NOT NULL REFERENCES users (id),
  kind        TEXT NOT NULL,
  reason      TEXT NOT NULL CHECK (reason IN ('purchase', 'game', 'refund')),
  ref         TEXT NOT NULL,
  delta       INTEGER NOT NULL CHECK (delta <> 0),
  season      TEXT,
  created_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, kind, reason, ref)
);
CREATE INDEX entry_ledger_ref ON entry_ledger (reason, ref);

-- A product may give entries: item_type 'entry', ref the kind (ranked).
ALTER TABLE product_items DROP CONSTRAINT product_items_item_type_check;
ALTER TABLE product_items ADD CONSTRAINT product_items_item_type_check CHECK (item_type IN ('card', 'pack', 'deck', 'product', 'entry'));
