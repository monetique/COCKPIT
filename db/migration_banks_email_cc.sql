-- ============================================================
--  Migration Banks — Ajout colonne email_cc
--  psql -U postgres -d clictopay_db -f migration_banks_email_cc.sql
-- ============================================================
ALTER TABLE banks
  ADD COLUMN IF NOT EXISTS email_cc TEXT DEFAULT NULL;

COMMENT ON COLUMN banks.email_cc IS
  'Destinataires CC supplémentaires séparés par ; (ex: email1@banque.tn;email2@banque.tn)';

SELECT 'Migration banks email_cc OK' AS status;
