-- Player notifications (docs/tcg/15-notifiche.md): what happened to a player's orders, trades and sales
-- while they were looking elsewhere (or away). A row is written in the same unit of work as the change it
-- reports, so a notification exists exactly when the change committed; pg_notify in that transaction wakes
-- every server process after the commit, and the one holding the player's connection pushes it.
CREATE TABLE notifications (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users (id),
  kind        TEXT NOT NULL CHECK (kind ~ '^[a-z]+\.[a-z_]+$'),
  data        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL,
  read_at     TIMESTAMPTZ
);
-- A player's feed, newest first, a page at a time.
CREATE INDEX notifications_user_recent ON notifications (user_id, id DESC);
-- The unread badge.
CREATE INDEX notifications_user_unread ON notifications (user_id) WHERE read_at IS NULL;
-- Retention.
CREATE INDEX notifications_created ON notifications (created_at);
