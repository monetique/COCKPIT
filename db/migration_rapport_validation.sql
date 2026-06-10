-- Ajout colonne rapport_envoye_at sur validations
ALTER TABLE validations
  ADD COLUMN IF NOT EXISTS rapport_envoye_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN validations.rapport_envoye_at IS
  'Date d envoi du rapport de validation au marchand et à la banque';

SELECT 'Migration rapport_validation OK' AS status;
