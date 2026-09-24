-- magic8-tcg initial schema (PostgreSQL 16+).
-- Design notes: docs/tcg/04-modello-dati.md
-- Applied by src/platform/db/migrate.js inside one transaction: no BEGIN/COMMIT here.
--
-- Conventions
--   * Money is BIGINT in the asset's smallest unit (STEEM: 3 decimals). Never NUMERIC-as-float, never REAL.
--   * Every state machine column has a CHECK listing its states; transitions are compare-and-set UPDATEs.
--   * Append-only tables are protected by a trigger (and, in production, by table grants).
--   * Hashes are lowercase hex CHAR(64).

-- gen_random_uuid() is core since PostgreSQL 13: no extension needed.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  network        TEXT NOT NULL,
  account        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  roles          TEXT[] NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at  TIMESTAMPTZ,
  UNIQUE (network, account)
);

CREATE TABLE auth_challenges (
  id           UUID PRIMARY KEY,
  network      TEXT NOT NULL,
  account      TEXT NOT NULL,
  message      TEXT NOT NULL,
  origin       TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ
);
CREATE INDEX auth_challenges_expiry ON auth_challenges (expires_at) WHERE consumed_at IS NULL;

CREATE TABLE sessions (
  id                UUID PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES users (id),
  token_hash        CHAR(64) NOT NULL UNIQUE,          -- sha256 of the cookie value; the value itself is never stored
  login_public_key  TEXT NOT NULL,                     -- key that signed the challenge; sessions die if it leaves the account's authority
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL,
  revoked_at        TIMESTAMPTZ,
  revoke_reason     TEXT
);
CREATE INDEX sessions_user ON sessions (user_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------

CREATE TABLE content_versions (
  hash            CHAR(64) PRIMARY KEY,                -- sha256(payload); games reference it
  engine_version  TEXT NOT NULL,
  payload         TEXT NOT NULL,                       -- the exact canonical JSON the hash covers, served verbatim to verifiers
  published_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_current      BOOLEAN NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX content_versions_single_current ON content_versions (is_current) WHERE is_current;
CREATE TRIGGER content_versions_immutable BEFORE UPDATE OF hash, payload, engine_version OR DELETE ON content_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE card_definitions (
  id                  TEXT PRIMARY KEY,
  first_content_hash  CHAR(64) NOT NULL REFERENCES content_versions (hash),
  data                JSONB NOT NULL                   -- as in the latest content version that has the card
);

-- ---------------------------------------------------------------------------
-- Collection / inventory
-- ---------------------------------------------------------------------------

CREATE TABLE card_serial_counters (
  definition_id  TEXT NOT NULL REFERENCES card_definitions (id),
  edition        TEXT NOT NULL,
  next_serial    INTEGER NOT NULL DEFAULT 1 CHECK (next_serial > 0),
  PRIMARY KEY (definition_id, edition)
);

CREATE TABLE card_instances (
  id             UUID PRIMARY KEY,
  definition_id  TEXT NOT NULL REFERENCES card_definitions (id),
  edition        TEXT NOT NULL,
  serial         INTEGER NOT NULL CHECK (serial > 0),
  finish         TEXT NOT NULL,
  owner_id       UUID NOT NULL REFERENCES users (id),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'locked', 'burned')),
  origin_kind    TEXT NOT NULL CHECK (origin_kind IN ('purchase', 'pack', 'grant', 'reward')),
  origin_ref     TEXT NOT NULL,
  minted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  external_ref   TEXT,                                 -- future: token id on a chain
  version        INTEGER NOT NULL DEFAULT 1,
  UNIQUE (definition_id, edition, serial)
);
CREATE INDEX card_instances_owner ON card_instances (owner_id, definition_id) WHERE status <> 'burned';

CREATE TABLE card_instance_events (
  id                BIGSERIAL PRIMARY KEY,
  card_instance_id  UUID NOT NULL REFERENCES card_instances (id),
  kind              TEXT NOT NULL CHECK (kind IN ('MINTED', 'TRANSFERRED', 'LOCKED', 'UNLOCKED', 'BURNED')),
  from_user_id      UUID REFERENCES users (id),
  to_user_id        UUID REFERENCES users (id),
  ref               TEXT NOT NULL,
  at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX card_instance_events_card ON card_instance_events (card_instance_id, id);
CREATE TRIGGER card_instance_events_append_only BEFORE UPDATE OR DELETE ON card_instance_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Read model: what a user owns, grouped for the collection screen and deck validation.
CREATE VIEW collections AS
  SELECT owner_id, definition_id, finish, count(*)::INTEGER AS copies
  FROM card_instances
  WHERE status = 'active'
  GROUP BY owner_id, definition_id, finish;

-- One-time, idempotent free grants (starter deck, promotions): the key makes a second grant impossible.
CREATE TABLE grants (
  key         TEXT PRIMARY KEY,                        -- e.g. 'starter:<userId>'
  user_id     UUID NOT NULL REFERENCES users (id),
  kind        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Decks
-- ---------------------------------------------------------------------------

CREATE TABLE decks (
  id          UUID PRIMARY KEY,
  owner_id    UUID NOT NULL REFERENCES users (id),
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 30),
  faction     TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX decks_owner ON decks (owner_id) WHERE deleted_at IS NULL;

CREATE TABLE deck_cards (
  deck_id        UUID NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  definition_id  TEXT NOT NULL REFERENCES card_definitions (id),
  count          INTEGER NOT NULL CHECK (count BETWEEN 1 AND 99),
  PRIMARY KEY (deck_id, definition_id)
);

-- ---------------------------------------------------------------------------
-- Marketplace
-- ---------------------------------------------------------------------------

CREATE TABLE products (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,                          -- presentation label only; behaviour comes from product_items
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  active       BOOLEAN NOT NULL DEFAULT false,
  limits       JSONB NOT NULL DEFAULT '{}',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE product_prices (
  product_id  TEXT NOT NULL REFERENCES products (id),
  asset       TEXT NOT NULL,
  amount      BIGINT NOT NULL CHECK (amount > 0),
  PRIMARY KEY (product_id, asset)
);

CREATE TABLE product_items (
  product_id  TEXT NOT NULL REFERENCES products (id),
  position    INTEGER NOT NULL CHECK (position >= 0),
  item_type   TEXT NOT NULL CHECK (item_type IN ('card', 'pack', 'deck', 'product')),
  ref         TEXT NOT NULL,                           -- definition id | drop table id | deck id | product id
  count       INTEGER NOT NULL CHECK (count BETWEEN 1 AND 1000),
  finish      TEXT,
  PRIMARY KEY (product_id, position)
);

CREATE TABLE rng_epochs (
  id                INTEGER PRIMARY KEY,
  secret_encrypted  BYTEA NOT NULL,
  commit            CHAR(64) NOT NULL,
  commit_tx_id      TEXT,
  opened_at         TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,
  reveal_tx_id      TEXT
);
CREATE UNIQUE INDEX rng_epochs_single_open ON rng_epochs ((true)) WHERE opened_at IS NOT NULL AND closed_at IS NULL;

CREATE TABLE orders (
  id               UUID PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES users (id),
  status           TEXT NOT NULL CHECK (status IN ('CREATED', 'PAYMENT_PENDING', 'PAYMENT_DETECTED', 'PAYMENT_VERIFIED',
                                                   'FULFILLED', 'FAILED', 'EXPIRED', 'CANCELLED')),
  network          TEXT NOT NULL,
  asset            TEXT NOT NULL,
  total_amount     BIGINT NOT NULL CHECK (total_amount > 0),
  receiver         TEXT NOT NULL,
  memo             TEXT NOT NULL UNIQUE,               -- opaque, unguessable reference carried by the transfer
  expires_at       TIMESTAMPTZ NOT NULL,
  idempotency_key  TEXT NOT NULL,
  request_hash     CHAR(64) NOT NULL,                  -- same key + different body → 409
  payment_id       UUID,
  rng_epoch_id     INTEGER REFERENCES rng_epochs (id),
  failure_reason   TEXT,
  version          INTEGER NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX orders_user ON orders (user_id, created_at DESC);
CREATE INDEX orders_pending_expiry ON orders (expires_at) WHERE status IN ('CREATED', 'PAYMENT_PENDING');

CREATE TABLE order_items (
  order_id     UUID NOT NULL REFERENCES orders (id),
  position     INTEGER NOT NULL CHECK (position >= 0),
  product_id   TEXT NOT NULL REFERENCES products (id),
  quantity     INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  unit_amount  BIGINT NOT NULL CHECK (unit_amount > 0),  -- price frozen at order creation
  PRIMARY KEY (order_id, position)
);

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------

CREATE TABLE payments (
  id               UUID PRIMARY KEY,
  network          TEXT NOT NULL,
  tx_id            TEXT NOT NULL,
  op_index         INTEGER NOT NULL CHECK (op_index >= 0),
  block_num        BIGINT NOT NULL,
  from_account     TEXT NOT NULL,
  to_account       TEXT NOT NULL,
  asset            TEXT NOT NULL,
  amount           BIGINT NOT NULL CHECK (amount > 0),
  memo             TEXT NOT NULL,
  order_id         UUID REFERENCES orders (id),
  status           TEXT NOT NULL CHECK (status IN ('DETECTED', 'VERIFIED', 'APPLIED', 'REFUND_REQUIRED', 'REFUNDED', 'IGNORED')),
  problem          TEXT,
  observed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  irreversible_at  TIMESTAMPTZ,
  UNIQUE (network, tx_id, op_index)                    -- a transfer can be counted once, ever
);
-- An order can be paid by at most one applied payment.
CREATE UNIQUE INDEX payments_one_applied_per_order ON payments (order_id) WHERE status = 'APPLIED';
ALTER TABLE orders ADD CONSTRAINT orders_payment_fk FOREIGN KEY (payment_id) REFERENCES payments (id);

CREATE TABLE refunds (
  id                UUID PRIMARY KEY,
  payment_id        UUID NOT NULL UNIQUE REFERENCES payments (id),
  to_account        TEXT NOT NULL,
  asset             TEXT NOT NULL,
  amount            BIGINT NOT NULL CHECK (amount > 0),
  status            TEXT NOT NULL CHECK (status IN ('PENDING', 'SENT', 'CONFIRMED')),
  refund_tx_id      TEXT UNIQUE,
  operator_user_id  UUID REFERENCES users (id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Chain (outbox, broadcast, reconciliation)
-- ---------------------------------------------------------------------------

CREATE TABLE blockchain_transactions (
  id           UUID PRIMARY KEY,
  network      TEXT NOT NULL,
  tx_id        TEXT NOT NULL,
  purpose      TEXT NOT NULL CHECK (purpose IN ('GAME_RECORDS', 'RECEIPT', 'MANIFEST')),
  signer       TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('BROADCAST', 'INCLUDED', 'IRREVERSIBLE', 'EXPIRED', 'REJECTED')),
  expiration   TIMESTAMPTZ NOT NULL,
  block_num    BIGINT,
  signed_tx    JSONB NOT NULL,
  last_error   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (network, tx_id)
);
CREATE INDEX blockchain_transactions_open ON blockchain_transactions (status) WHERE status IN ('BROADCAST', 'INCLUDED');

-- Outbox of immutable protocol records (game records and receipts). payload is the exact canonical JSON.
CREATE TABLE blockchain_events (
  id              BIGSERIAL PRIMARY KEY,
  network         TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('GAME_RECORD', 'RECEIPT')),
  game_id         TEXT,
  record_seq      INTEGER,
  order_id        UUID REFERENCES orders (id),
  payload         TEXT NOT NULL,
  payload_hash    CHAR(64) NOT NULL,
  priority        SMALLINT NOT NULL DEFAULT 1,
  status          TEXT NOT NULL CHECK (status IN ('BUILT', 'BROADCAST', 'INCLUDED', 'IRREVERSIBLE')),
  transaction_id  UUID REFERENCES blockchain_transactions (id),
  attempts        INTEGER NOT NULL DEFAULT 0,
  reconciliation  TEXT CHECK (reconciliation IN ('MATCH', 'MISSING_ON_CHAIN', 'CONFLICT')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind = 'GAME_RECORD') = (game_id IS NOT NULL AND record_seq IS NOT NULL)),
  UNIQUE (game_id, record_seq)
);
CREATE INDEX blockchain_events_pending ON blockchain_events (priority, id) WHERE status = 'BUILT';
CREATE FUNCTION blockchain_events_payload_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payload IS DISTINCT FROM OLD.payload OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
     OR NEW.game_id IS DISTINCT FROM OLD.game_id OR NEW.record_seq IS DISTINCT FROM OLD.record_seq THEN
    RAISE EXCEPTION 'blockchain_events payload is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER blockchain_events_immutable BEFORE UPDATE ON blockchain_events
  FOR EACH ROW EXECUTE FUNCTION blockchain_events_payload_immutable();
CREATE TRIGGER blockchain_events_no_delete BEFORE DELETE ON blockchain_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Persistent read positions of chain watchers (payments, reconciliation): restart without gaps or doubles.
CREATE TABLE chain_cursors (
  name        TEXT PRIMARY KEY,
  network     TEXT NOT NULL,
  position    JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chain anomalies that need a human (unknown ops from our broadcaster, conflicts, repeated rebroadcasts).
CREATE TABLE chain_alerts (
  id          BIGSERIAL PRIMARY KEY,
  network     TEXT NOT NULL,
  kind        TEXT NOT NULL,
  details     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- Matchmaking and games
-- ---------------------------------------------------------------------------

CREATE TABLE games (
  id                TEXT PRIMARY KEY CHECK (id ~ '^[0-9a-hjkmnp-tv-z]{26}$'),
  mode              TEXT NOT NULL CHECK (mode IN ('casual', 'ranked', 'practice')),
  status            TEXT NOT NULL CHECK (status IN ('CREATED', 'ACTIVE', 'FINISHED', 'ABORTED')),
  network           TEXT NOT NULL,
  protocol_version  INTEGER NOT NULL,
  engine_version    TEXT NOT NULL,
  content_hash      CHAR(64) NOT NULL REFERENCES content_versions (hash),
  secret_encrypted  BYTEA NOT NULL,
  seed_commit       CHAR(64) NOT NULL,
  first_seat        TEXT,
  winner_seat       TEXT,
  end_reason        TEXT,
  engine_version_counter INTEGER NOT NULL DEFAULT 0,  -- GameEngine.version; optimistic concurrency for commands
  last_event_seq    INTEGER NOT NULL DEFAULT -1,
  chain_head        CHAR(64) NOT NULL,
  owner_node        TEXT,
  lease_until       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ
);
CREATE INDEX games_active ON games (status) WHERE status IN ('CREATED', 'ACTIVE');

CREATE TABLE game_players (
  game_id         TEXT NOT NULL REFERENCES games (id),
  seat            TEXT NOT NULL CHECK (seat IN ('s0', 's1')),
  user_id         UUID NOT NULL REFERENCES users (id),
  account         TEXT NOT NULL,
  deck_id         UUID REFERENCES decks (id),
  deck_snapshot   JSONB NOT NULL,                      -- frozen at matchmaking; later deck edits do not affect the game
  deck_commit     CHAR(64) NOT NULL,
  entropy         CHAR(32),
  entropy_source  TEXT CHECK (entropy_source IN ('client', 'server')),
  result          TEXT CHECK (result IN ('win', 'loss', 'draw', 'aborted')),
  PRIMARY KEY (game_id, seat),
  UNIQUE (game_id, user_id)
);
CREATE INDEX game_players_user ON game_players (user_id);

CREATE TABLE game_commands (
  game_id           TEXT NOT NULL REFERENCES games (id),
  command_id        UUID NOT NULL,                     -- client idempotency key
  seat              TEXT NOT NULL,
  expected_version  INTEGER NOT NULL,
  payload           JSONB NOT NULL,
  accepted          BOOLEAN NOT NULL,
  ack               JSONB NOT NULL,                    -- replayed verbatim on a duplicate
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, command_id)
);
CREATE TRIGGER game_commands_append_only BEFORE UPDATE OR DELETE ON game_commands
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE game_events (
  game_id     TEXT NOT NULL REFERENCES games (id),
  seq         INTEGER NOT NULL CHECK (seq >= 0),
  kind        TEXT NOT NULL,
  actor       TEXT,
  turn        INTEGER NOT NULL CHECK (turn >= 0),
  ms          BIGINT NOT NULL CHECK (ms >= 0),
  payload     JSONB NOT NULL,
  head        CHAR(64) NOT NULL,                       -- event hash, chained (docs/tcg/03 §6.4)
  record_seq  INTEGER,                                 -- set once, when the event is sealed into a record
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, seq)
);
CREATE INDEX game_events_unsealed ON game_events (game_id, seq) WHERE record_seq IS NULL;
CREATE FUNCTION game_events_seal_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.record_seq IS NOT NULL
     OR (to_jsonb(NEW) - 'record_seq') IS DISTINCT FROM (to_jsonb(OLD) - 'record_seq') THEN
    RAISE EXCEPTION 'game_events is append-only (only record_seq may be set, once)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER game_events_append_only BEFORE UPDATE ON game_events
  FOR EACH ROW EXECUTE FUNCTION game_events_seal_only();
CREATE TRIGGER game_events_no_delete BEFORE DELETE ON game_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE game_snapshots (
  game_id           TEXT NOT NULL REFERENCES games (id),
  engine_version    INTEGER NOT NULL,
  state_commitment  CHAR(64) NOT NULL,                 -- salted digest, as published in STATE_CHECKPOINT
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, engine_version)
);

CREATE TABLE matchmaking (
  id             UUID PRIMARY KEY,
  user_id        UUID NOT NULL REFERENCES users (id),
  mode           TEXT NOT NULL CHECK (mode IN ('casual', 'ranked')),
  deck_id        UUID NOT NULL REFERENCES decks (id),
  deck_snapshot  JSONB NOT NULL,
  rating         INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('WAITING', 'MATCHED', 'CANCELLED', 'EXPIRED')),
  game_id        TEXT REFERENCES games (id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- A user can wait in at most one queue.
CREATE UNIQUE INDEX matchmaking_one_waiting_ticket ON matchmaking (user_id) WHERE status = 'WAITING';
CREATE INDEX matchmaking_waiting ON matchmaking (mode, rating) WHERE status = 'WAITING';

-- ---------------------------------------------------------------------------
-- Idempotency and audit
-- ---------------------------------------------------------------------------

CREATE TABLE idempotency_keys (
  user_id       UUID NOT NULL REFERENCES users (id),
  scope         TEXT NOT NULL,
  key           TEXT NOT NULL,
  request_hash  CHAR(64) NOT NULL,
  response      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope, key)
);

-- Tamper-evident audit trail: each row carries the hash of the previous one.
CREATE TABLE audit_logs (
  seq            BIGINT PRIMARY KEY CHECK (seq > 0),  -- position in the hash chain, assigned under an advisory lock
  at             TIMESTAMPTZ NOT NULL,
  actor_kind     TEXT NOT NULL CHECK (actor_kind IN ('user', 'admin', 'system')),
  actor_user_id  UUID REFERENCES users (id),
  action         TEXT NOT NULL,
  target_kind    TEXT,
  target_id      TEXT,
  ip             TEXT CHECK (char_length(ip) <= 64),  -- TEXT, not INET: the hash covers the exact string the server saw
  details        JSONB NOT NULL DEFAULT '{}',
  prev_hash      CHAR(64) NOT NULL,
  hash           CHAR(64) NOT NULL UNIQUE
);
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
