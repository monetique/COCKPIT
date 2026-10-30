-- ── Migration Facturation ────────────────────────────────

-- Table factures (par FSP)
CREATE TABLE IF NOT EXISTS factures (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero        VARCHAR(20) UNIQUE NOT NULL,
  mois          INTEGER NOT NULL,
  annee         INTEGER NOT NULL,
  statut        VARCHAR(20) DEFAULT 'brouillon',
  montant_total NUMERIC(12,3) DEFAULT 0,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(mois, annee)
);

-- Table lignes de facture (par FSP)
CREATE TABLE IF NOT EXISTS facture_lignes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facture_id         UUID REFERENCES factures(id) ON DELETE CASCADE,
  canal              VARCHAR(20) NOT NULL,
  fsp                VARCHAR(100),
  nb_transactions    INTEGER DEFAULT 0,
  commission         NUMERIC(6,3),
  emetteur           NUMERIC(6,3),
  acquereur          NUMERIC(6,3),
  smt                NUMERIC(6,3),
  operateur          NUMERIC(6,3) DEFAULT 0,
  montant_commission NUMERIC(12,3),
  montant_emetteur   NUMERIC(12,3),
  montant_acquereur  NUMERIC(12,3),
  montant_smt        NUMERIC(12,3),
  montant_operateur  NUMERIC(12,3) DEFAULT 0,
  montant_total      NUMERIC(12,3)
);

-- Table factures globales (sans détail FSP)
CREATE TABLE IF NOT EXISTS factures_globales (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero        VARCHAR(20) UNIQUE NOT NULL,
  mois          INTEGER NOT NULL,
  annee         INTEGER NOT NULL,
  montant_total NUMERIC(12,3) DEFAULT 0,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(mois, annee)
);

-- Table lignes facture globale (canal × moyen)
CREATE TABLE IF NOT EXISTS facture_globale_lignes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facture_id         UUID REFERENCES factures_globales(id) ON DELETE CASCADE,
  rubrique           VARCHAR(10) NOT NULL,
  canal              VARCHAR(20),
  moyen              VARCHAR(20),
  label              VARCHAR(100),
  tarif_canal        VARCHAR(20),
  nb_transactions    INTEGER DEFAULT 0,
  commission         NUMERIC(6,3),
  emetteur           NUMERIC(6,3),
  acquereur          NUMERIC(6,3),
  smt                NUMERIC(6,3),
  operateur          NUMERIC(6,3) DEFAULT 0,
  montant_commission NUMERIC(12,3),
  montant_emetteur   NUMERIC(12,3),
  montant_acquereur  NUMERIC(12,3),
  montant_smt        NUMERIC(12,3),
  montant_operateur  NUMERIC(12,3) DEFAULT 0,
  montant_total      NUMERIC(12,3)
);

-- Séquences numéros de facture
CREATE SEQUENCE IF NOT EXISTS facture_seq START 1;
CREATE SEQUENCE IF NOT EXISTS facture_globale_seq START 1;

SELECT 'Migration facturation OK' AS status;
