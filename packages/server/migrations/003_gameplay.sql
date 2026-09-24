-- M4 matchmaking and games. Design notes: docs/tcg/04-modello-dati.md

-- The account shown to the opponent is copied into the ticket, like the frozen deck.
ALTER TABLE matchmaking ADD COLUMN account TEXT NOT NULL;
-- Pairing takes the oldest waiting tickets of a mode.
CREATE INDEX matchmaking_oldest ON matchmaking (mode, created_at) WHERE status = 'WAITING';
