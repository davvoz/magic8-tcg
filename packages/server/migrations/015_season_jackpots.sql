-- Season jackpots: a share of the bank's wallet split among the first places of a season.
-- Design notes: docs/tcg/21-stagioni-e-jackpot.md

-- One row per season with a prize pool: the bank's balance when the season was first seen running,
-- and, once the season is over, the balance it was settled on and the jackpot it paid.
CREATE TABLE season_jackpots (
  season           TEXT PRIMARY KEY,
  network          TEXT NOT NULL,
  bank_account     TEXT NOT NULL,
  asset            TEXT NOT NULL,
  opening_balance  BIGINT NOT NULL CHECK (opening_balance >= 0),
  opened_at        TIMESTAMPTZ NOT NULL,
  closing_balance  BIGINT CHECK (closing_balance >= 0),
  jackpot          BIGINT CHECK (jackpot >= 0),
  settled_at       TIMESTAMPTZ,
  CHECK ((settled_at IS NULL) = (jackpot IS NULL) AND (jackpot IS NULL) = (closing_balance IS NULL))
);

-- What each winner is owed. An operator pays it from the bank with Keychain (memo `m8tcg prize <season> <place>`);
-- the payout watcher marks it SENT when the transfer appears, CONFIRMED once it is irreversible.
CREATE TABLE season_prizes (
  season        TEXT NOT NULL REFERENCES season_jackpots (season),
  place         INTEGER NOT NULL CHECK (place >= 1),
  user_id       UUID NOT NULL REFERENCES users (id),
  account       TEXT NOT NULL,
  network       TEXT NOT NULL,
  asset         TEXT NOT NULL,
  amount        BIGINT NOT NULL CHECK (amount > 0),
  percent       INTEGER NOT NULL CHECK (percent BETWEEN 1 AND 100),
  rating        INTEGER NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('PENDING', 'SENT', 'CONFIRMED')),
  tx_id         TEXT UNIQUE,
  op_index      INTEGER,
  block_num     BIGINT,
  sent_at       TIMESTAMPTZ,
  confirmed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (season, place)
);
CREATE INDEX season_prizes_status ON season_prizes (status);
