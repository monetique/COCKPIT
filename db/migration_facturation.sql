-- Table factures
CREATE TABLE IF NOT EXISTS factures (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero        VARCHAR(20) UNIQUE NOT NULL,
  mois          INTEGER NOT NULL,  -- 1-12
  annee         INTEGER NOT NULL,
  statut        VARCHAR(20) DEFAULT 'brouillon',
  montant_total NUMERIC(12,3) DEFAULT 0,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  sent_at       TIMESTAMPTZ,
  UNIQUE(mois, annee)
);

-- Table lignes de facture
CREATE TABLE IF NOT EXISTS facture_lignes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facture_id    UUID REFERENCES factures(id) ON DELETE CASCADE,
  canal         VARCHAR(20) NOT NULL,  -- 'wallet'|'ussd'|'ctp'
  fsp           VARCHAR(100),          -- partenaire FSP ou 'CLICTOPAY/CARTE'
  nb_transactions INTEGER DEFAULT 0,
  commission    NUMERIC(6,3),
  emetteur      NUMERIC(6,3),
  acquereur     NUMERIC(6,3),
  smt           NUMERIC(6,3),
  operateur     NUMERIC(6,3) DEFAULT 0,
  montant_commission NUMERIC(12,3),
  montant_emetteur   NUMERIC(12,3),
  montant_acquereur  NUMERIC(12,3),
  montant_smt        NUMERIC(12,3),
  montant_operateur  NUMERIC(12,3) DEFAULT 0,
  montant_total      NUMERIC(12,3)
);

-- Séquence numéro facture
CREATE SEQUENCE IF NOT EXISTS facture_seq START 1;

SELECT 'Migration facturation OK' AS status;
