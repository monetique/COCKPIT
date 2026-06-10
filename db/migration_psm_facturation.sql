-- ── Migration Facturation Paysmart ──────────────────────

CREATE TABLE IF NOT EXISTS psm_factures (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero        VARCHAR(30) UNIQUE NOT NULL,
  type_dest     VARCHAR(20) NOT NULL,  -- 'facturier'|'fsp'|'smt'|'wesettle'|'acquereur'
  destinataire  VARCHAR(100),          -- nom du facturier, FSP, ou entité globale
  mois          INTEGER NOT NULL,
  annee         INTEGER NOT NULL,
  montant_ht    NUMERIC(12,3) DEFAULT 0,
  tva           NUMERIC(12,3) DEFAULT 0,
  montant_ttc   NUMERIC(12,3) DEFAULT 0,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS psm_facture_lignes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facture_id        UUID REFERENCES psm_factures(id) ON DELETE CASCADE,
  facturier         VARCHAR(100),
  canal             VARCHAR(20),
  mode_paiement     VARCHAR(30),
  nb_transactions   INTEGER DEFAULT 0,
  prix_unitaire_ht  NUMERIC(6,3),
  montant_ht        NUMERIC(12,3),
  tva_rate          NUMERIC(5,2) DEFAULT 0,
  montant_tva       NUMERIC(12,3) DEFAULT 0,
  montant_ttc       NUMERIC(12,3)
);

CREATE INDEX IF NOT EXISTS idx_psm_factures_type  ON psm_factures(type_dest, mois, annee);
CREATE INDEX IF NOT EXISTS idx_psm_factures_dest  ON psm_factures(destinataire);
CREATE SEQUENCE IF NOT EXISTS psm_facture_seq START 1;

SELECT 'Migration PSM Facturation OK' AS status;
