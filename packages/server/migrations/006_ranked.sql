-- M7 ranked play. Design notes: docs/tcg/09-classificata.md

-- One rating per player and season (Glicko-2: rating, deviation, volatility).
CREATE TABLE ratings (
  season      TEXT NOT NULL,
  user_id     UUID NOT NULL REFERENCES users (id),
  account     TEXT NOT NULL,
  rating      DOUBLE PRECISION NOT NULL,
  rd          DOUBLE PRECISION NOT NULL CHECK (rd > 0),
  volatility  DOUBLE PRECISION NOT NULL CHECK (volatility > 0),
  games       INTEGER NOT NULL DEFAULT 0,
  wins        INTEGER NOT NULL DEFAULT 0,
  losses      INTEGER NOT NULL DEFAULT 0,
  draws       INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (season, user_id)
);
CREATE INDEX ratings_leaderboard ON ratings (season, rating DESC);

-- What each ranked game did to each player's rating; once per game and player, never changed.
CREATE TABLE rating_changes (
  game_id        TEXT NOT NULL REFERENCES games (id),
  user_id        UUID NOT NULL REFERENCES users (id),
  season         TEXT NOT NULL,
  opponent_id    UUID NOT NULL REFERENCES users (id),
  score          DOUBLE PRECISION NOT NULL CHECK (score IN (0, 0.5, 1)),
  counted        BOOLEAN NOT NULL,
  reason         TEXT,
  rating_before  DOUBLE PRECISION NOT NULL,
  rating_after   DOUBLE PRECISION NOT NULL,
  rd_before      DOUBLE PRECISION NOT NULL,
  rd_after       DOUBLE PRECISION NOT NULL,
  end_reason     TEXT NOT NULL,
  end_turn       INTEGER NOT NULL,
  finished_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (game_id, user_id)
);
CREATE INDEX rating_changes_pair ON rating_changes (user_id, opponent_id, finished_at);
CREATE TRIGGER rating_changes_append_only BEFORE UPDATE OR DELETE ON rating_changes
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Fair-play signals for operators (repeated pairings, quick concessions between the same players).
CREATE TABLE ranking_flags (
  id           BIGSERIAL PRIMARY KEY,
  season       TEXT NOT NULL,
  kind         TEXT NOT NULL,
  user_a       UUID NOT NULL REFERENCES users (id),
  user_b       UUID NOT NULL REFERENCES users (id),
  details      JSONB NOT NULL,
  fingerprint  TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL,
  resolved_at  TIMESTAMPTZ
);
