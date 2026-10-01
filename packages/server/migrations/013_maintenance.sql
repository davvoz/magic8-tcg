-- An announced maintenance (modules/maintenance): one row or none. While the row exists the server takes no
-- new shop orders, purchases between players or queue entries, so that nothing is half done when it goes
-- down at starts_at; games in progress go on. A deploy that succeeds deletes the row.
CREATE TABLE maintenance (
  singleton    BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  starts_at    TIMESTAMPTZ NOT NULL,
  message      TEXT CHECK (message IS NULL OR char_length(message) BETWEEN 1 AND 200),
  announced_at TIMESTAMPTZ NOT NULL
);
