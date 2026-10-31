-- The transfers the server signs for the accounts it keeps (docs/tcg/29-google.md): one per payment reference. The row
-- is written before the transfer is broadcast, so two requests for the same payment cannot both send it; it goes away
-- only when the chain refused the transfer, and stays when nobody can tell whether it went through.
CREATE TABLE custody_transfers (
  memo        TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users (id),
  tx_id       TEXT,
  created_at  TIMESTAMPTZ NOT NULL
);
