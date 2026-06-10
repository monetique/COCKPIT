-- ============================================================
--  Migration : Rôle banquier + permissions granulaires
--  psql -U postgres -d clictopay_db -f migration_banquier.sql
-- ============================================================

-- 1. Ajouter le rôle banquier dans users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS bank_code      VARCHAR(2)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS permissions    JSONB       DEFAULT '{}';

COMMENT ON COLUMN users.bank_code IS
  '2 premiers chiffres du processing_id — null pour admin/supervisor/operator';
COMMENT ON COLUMN users.permissions IS
  'Permissions granulaires : {"can_upload_cahier":true,"can_validate":true,"can_action":false}';

-- 2. Contrainte : banquier doit avoir un bank_code
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_banquier_bank_code;
ALTER TABLE users ADD CONSTRAINT chk_banquier_bank_code
  CHECK (role != 'banquier' OR bank_code IS NOT NULL);

-- 3. Index pour filtrage rapide par banque
CREATE INDEX IF NOT EXISTS idx_merchants_bank_code
  ON merchants_tracking (SUBSTRING(processing_id, 1, 2));

CREATE INDEX IF NOT EXISTS idx_users_bank_code
  ON users (bank_code) WHERE bank_code IS NOT NULL;

SELECT 'Migration banquier OK' AS status;
