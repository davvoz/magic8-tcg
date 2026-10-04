-- The calendar of ranked seasons (modules/ranking, SeasonCalendar). The server copies the seasons of
-- data/ranked/ranked.json here the first time it starts on an empty table; from then on operators change
-- them from the admin page: an upcoming season freely, a running one only its name and end, an ended one never.
-- Design notes: docs/tcg/09-classificata.md
CREATE TABLE seasons (
  id          TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{1,32}$'),
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  starts_at   TIMESTAMPTZ NOT NULL UNIQUE,
  ends_at     TIMESTAMPTZ CHECK (ends_at IS NULL OR ends_at > starts_at),
  prize_pool  TEXT,
  entry_fee   INTEGER NOT NULL CHECK (entry_fee BETWEEN 0 AND 100),
  updated_at  TIMESTAMPTZ NOT NULL
);
