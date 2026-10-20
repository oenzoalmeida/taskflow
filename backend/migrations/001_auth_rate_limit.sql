BEGIN;
CREATE TABLE IF NOT EXISTS auth_rate_limit (
  key text PRIMARY KEY,
  hits integer NOT NULL CHECK (hits > 0),
  reset_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_rate_limit_reset_at_idx ON auth_rate_limit (reset_at);
COMMIT;
