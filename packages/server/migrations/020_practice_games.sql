-- Practice games against the AI (modules/practice): played in the browser, then sent by the signed-in player with
-- their seed and moves, and counted only once the server has played them again to the same end. They open ranked
-- play like casual games do (docs/tcg/09-classificata.md). Nothing of them goes on chain or into the game history.

-- One row per game. The seed is the game: keyed by its hash, the same game counts once, for one player only.
CREATE TABLE practice_games (
  seed_hash    CHAR(64) PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users (id),
  result       TEXT NOT NULL CHECK (result IN ('win', 'loss', 'draw')),
  end_reason   TEXT NOT NULL,
  turns        INTEGER NOT NULL CHECK (turns >= 0),
  moves        INTEGER NOT NULL CHECK (moves >= 0),
  recorded_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX practice_games_user ON practice_games (user_id);
