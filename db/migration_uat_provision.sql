-- ============================================================
--  Migration UAT Provisioning — Colonnes merchants_tracking
--  psql -U postgres -d clictopay_db -f migration_uat_provision.sql
-- ============================================================

ALTER TABLE merchants_tracking
  ADD COLUMN IF NOT EXISTS uat_merchant_id      INTEGER,
  ADD COLUMN IF NOT EXISTS uat_status           VARCHAR(20)
    DEFAULT 'non_provisionne'
    CHECK (uat_status IN ('non_provisionne','api_ok','provisionne','api_erreur','sql_erreur')),
  ADD COLUMN IF NOT EXISTS uat_provisioned_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS uat_error_message    TEXT,
  ADD COLUMN IF NOT EXISTS uat_last_attempt_at  TIMESTAMPTZ;

COMMENT ON COLUMN merchants_tracking.uat_merchant_id
  IS 'merchantId retourné par l API EPG UAT après création';
COMMENT ON COLUMN merchants_tracking.uat_status
  IS 'non_provisionne | api_ok (étape1 OK, SQL en attente) | provisionne | api_erreur | sql_erreur';
COMMENT ON COLUMN merchants_tracking.uat_provisioned_at
  IS 'Date de provisionnement complet (étapes 1+2 réussies)';

SELECT 'Migration UAT OK — colonnes ajoutées' AS status;

-- Ajout statut deja_existant
ALTER TABLE merchants_tracking
  DROP CONSTRAINT IF EXISTS merchants_tracking_uat_status_check;

ALTER TABLE merchants_tracking
  ADD CONSTRAINT merchants_tracking_uat_status_check
  CHECK (uat_status IN ('non_provisionne','api_ok','provisionne','api_erreur','sql_erreur','deja_existant'));

SELECT 'Contrainte uat_status mise à jour' AS status;
