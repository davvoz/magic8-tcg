-- Daily challenges (modules/daily, docs/tcg/24-sfide.md): every day three games against characters the server's AI
-- plays, two characters and a boss; winning all three gives a pack.

-- A daily challenge is a game of its own mode.
ALTER TABLE games DROP CONSTRAINT games_mode_check;
ALTER TABLE games ADD CONSTRAINT games_mode_check CHECK (mode IN ('casual', 'ranked', 'practice', 'auto', 'daily'));

-- A game may have match conditions (a boss fight's), recorded in its GAME_CREATED and kept here to rebuild it.
ALTER TABLE games ADD COLUMN conditions JSONB NOT NULL DEFAULT '[]';

-- A seat the server's AI plays has no user: its profile (character, level, style) says what plays it.
ALTER TABLE game_players ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE game_players ADD COLUMN ai_profile JSONB;
ALTER TABLE game_players ADD CONSTRAINT game_players_player CHECK ((user_id IS NULL) <> (ai_profile IS NULL));

-- A player's day: the track they chose (normal: a Core Mini Booster, hard: a Core Booster), how many of the three
-- challenges they have won, the game they are playing now, and the pack once they won it.
CREATE TABLE daily_runs (
  user_id      UUID NOT NULL REFERENCES users (id),
  day          DATE NOT NULL,
  track        TEXT NOT NULL CHECK (track IN ('normal', 'hard')),
  stage        INTEGER NOT NULL DEFAULT 0 CHECK (stage BETWEEN 0 AND 3),
  game_id      TEXT REFERENCES games (id),
  attempts     INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  reward_seed  CHAR(64),
  reward_cards JSONB,
  rewarded_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, day),
  CHECK ((reward_seed IS NULL) = (rewarded_at IS NULL) AND (reward_cards IS NULL) = (rewarded_at IS NULL)),
  CHECK (rewarded_at IS NULL OR stage = 3)
);

-- Every challenge game, and how it went: one row per game, settled once.
CREATE TABLE daily_games (
  game_id      TEXT PRIMARY KEY REFERENCES games (id),
  user_id      UUID NOT NULL REFERENCES users (id),
  day          DATE NOT NULL,
  stage        INTEGER NOT NULL CHECK (stage BETWEEN 0 AND 2),
  opponent     TEXT NOT NULL,
  result       TEXT CHECK (result IN ('win', 'loss', 'draw', 'aborted')),
  created_at   TIMESTAMPTZ NOT NULL,
  settled_at   TIMESTAMPTZ,
  FOREIGN KEY (user_id, day) REFERENCES daily_runs (user_id, day)
);
CREATE INDEX daily_games_run ON daily_games (user_id, day);
