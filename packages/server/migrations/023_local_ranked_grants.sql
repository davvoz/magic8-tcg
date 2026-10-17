-- Explicitly recorded test grants; they do not masquerade as purchases or completed games.
ALTER TABLE entry_ledger DROP CONSTRAINT entry_ledger_reason_check;
ALTER TABLE entry_ledger ADD CONSTRAINT entry_ledger_reason_check CHECK (reason IN ('purchase', 'game', 'refund', 'auto_ticket', 'auto_refund', 'grant'));

CREATE TABLE ranked_eligibility_grants (
  user_id     UUID PRIMARY KEY REFERENCES users (id),
  source      TEXT NOT NULL CHECK (source = 'local_test'),
  note        TEXT NOT NULL CHECK (length(trim(note)) > 0),
  granted_at  TIMESTAMPTZ NOT NULL
);

CREATE TRIGGER ranked_eligibility_grants_immutable
  BEFORE UPDATE OR DELETE ON ranked_eligibility_grants
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
