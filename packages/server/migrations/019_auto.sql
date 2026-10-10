-- Auto ranked games (modules/auto): a player joins the auto list with a deck and an AI style, paying the entry at
-- once; when a second player joins, the server plays the game with the AI for both and records it finished.
-- Design notes: docs/tcg/23-automatica.md

ALTER TABLE games DROP CONSTRAINT games_mode_check;
ALTER TABLE games ADD CONSTRAINT games_mode_check CHECK (mode IN ('casual', 'ranked', 'practice', 'auto'));

-- One row per ticket. PREPARED: the server made the ticket's secret and told the player only its commitment;
-- WAITING: the player joined with a deck, a style and their entropy, and paid; MATCHED: its game was played;
-- REFUNDED: the season ended before an opponent came, the entry went back; FAILED: its game could not be played
-- (a bug), the entry went back.
CREATE TABLE auto_tickets (
  id                UUID PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES users (id),
  account           TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('PREPARED', 'WAITING', 'MATCHED', 'REFUNDED', 'FAILED')),
  secret_encrypted  BYTEA NOT NULL,
  secret_commit     CHAR(64) NOT NULL,
  season            TEXT,
  style             TEXT CHECK (style IN ('aggressive', 'balanced', 'defensive')),
  deck_id           UUID,
  deck_snapshot     JSONB,
  entropy           CHAR(32),
  entries           INTEGER NOT NULL DEFAULT 0 CHECK (entries >= 0),
  game_id           TEXT REFERENCES games (id),
  seat              TEXT CHECK (seat IN ('s0', 's1')),
  ai_version        INTEGER,
  prepared_at       TIMESTAMPTZ NOT NULL,
  joined_at         TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,
  CHECK (status = 'PREPARED' OR (season IS NOT NULL AND style IS NOT NULL AND deck_snapshot IS NOT NULL AND entropy IS NOT NULL AND joined_at IS NOT NULL)),
  CHECK (status <> 'MATCHED' OR (game_id IS NOT NULL AND seat IS NOT NULL AND ai_version IS NOT NULL))
);
-- A player waits in the auto list with at most one ticket.
CREATE UNIQUE INDEX auto_tickets_one_waiting ON auto_tickets (user_id) WHERE status = 'WAITING';
CREATE INDEX auto_tickets_oldest ON auto_tickets (joined_at, id) WHERE status = 'WAITING';
CREATE INDEX auto_tickets_prepared ON auto_tickets (prepared_at) WHERE status = 'PREPARED';
CREATE INDEX auto_tickets_game ON auto_tickets (game_id) WHERE game_id IS NOT NULL;

-- Ratings: which mode a change came from (the daily limit per pair counts each mode apart) and the share of the
-- Glicko-2 change applied (1 for games played by hand, ranked.json auto.ratingWeightPercent for auto games).
ALTER TABLE rating_changes ADD COLUMN mode TEXT NOT NULL DEFAULT 'ranked' CHECK (mode IN ('ranked', 'auto'));
ALTER TABLE rating_changes ADD COLUMN weight DOUBLE PRECISION NOT NULL DEFAULT 1 CHECK (weight > 0 AND weight <= 1);

-- Entries: an auto ticket takes its entry when the player joins (ref: the ticket) and gives it back if no game came of it.
ALTER TABLE entry_ledger DROP CONSTRAINT entry_ledger_reason_check;
ALTER TABLE entry_ledger ADD CONSTRAINT entry_ledger_reason_check CHECK (reason IN ('purchase', 'game', 'refund', 'auto_ticket', 'auto_refund'));
