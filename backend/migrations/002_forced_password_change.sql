BEGIN;
-- Troca de senha obrigatória no primeiro acesso (senha temporária) e
-- revogação de sessões antigas ao trocar a senha (auth_version vai no JWT).
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_version integer NOT NULL DEFAULT 1;
COMMIT;
