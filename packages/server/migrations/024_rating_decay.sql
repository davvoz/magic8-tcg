-- Rating decay (docs/tcg/09-classificata.md): each UTC day, the season's first settled ratings lose points unless they
-- played a ranked game by hand that day.

-- The days already decayed, once per season and day (the job runs in every process: the first one takes the day).
CREATE TABLE rating_decay_days (
  season        TEXT NOT NULL,
  day           DATE NOT NULL,
  processed_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (season, day)
);

-- What each day's decay took from each player; never changed.
CREATE TABLE rating_decays (
  season         TEXT NOT NULL,
  day            DATE NOT NULL,
  user_id        UUID NOT NULL REFERENCES users (id),
  place          INTEGER NOT NULL CHECK (place > 0),
  points         INTEGER NOT NULL CHECK (points > 0),
  rating_before  DOUBLE PRECISION NOT NULL,
  rating_after   DOUBLE PRECISION NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (season, day, user_id),
  FOREIGN KEY (season, day) REFERENCES rating_decay_days (season, day)
);
CREATE TRIGGER rating_decays_append_only BEFORE UPDATE OR DELETE ON rating_decays
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
