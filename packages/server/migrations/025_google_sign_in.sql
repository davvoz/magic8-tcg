-- Signing in with Google, the wallet kept by the server (docs/tcg/29-google.md).

-- How a session was opened: a signature of the account's posting key (02 §2), or a Google sign-in of an account whose
-- keys the server keeps. Sessions opened before this column existed were all signatures.
ALTER TABLE sessions ADD COLUMN method TEXT NOT NULL DEFAULT 'signature' CHECK (method IN ('signature', 'google'));

-- A Google identity (its `sub`, stable for the Google account) and the account it signs in to: one each way.
CREATE TABLE google_identities (
  sub            TEXT PRIMARY KEY CHECK (length(sub) BETWEEN 1 AND 255),
  user_id        UUID NOT NULL UNIQUE REFERENCES users (id),
  email          TEXT,
  created_at     TIMESTAMPTZ NOT NULL,
  last_login_at  TIMESTAMPTZ
);

-- The keys of the accounts the server keeps (Google sign-ins): sealed with the data key (SecretBox, context
-- "custody_keys:<user_id>"), so a database dump alone opens none. The posting public key is in clear: sessions name it.
CREATE TABLE custody_keys (
  user_id         UUID PRIMARY KEY REFERENCES users (id),
  network         TEXT NOT NULL,
  account         TEXT NOT NULL,
  posting_public  TEXT NOT NULL,
  keys_encrypted  BYTEA NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL,
  exported_at     TIMESTAMPTZ,
  UNIQUE (network, account)
);
