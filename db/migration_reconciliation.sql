-- Table fichiers Ministère uploadés
CREATE TABLE IF NOT EXISTS recon_fichiers (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nom_fichier   VARCHAR(255) NOT NULL,
  date_fichier  DATE NOT NULL,
  nb_lignes     INTEGER DEFAULT 0,
  statut        VARCHAR(20) DEFAULT 'en_attente',
  uploaded_by   UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Table lignes du fichier Ministère
CREATE TABLE IF NOT EXISTS recon_ministere (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fichier_id    UUID REFERENCES recon_fichiers(id) ON DELETE CASCADE,
  autorisation  VARCHAR(50),
  date_paiement TIMESTAMPTZ,
  id_eleve      VARCHAR(50),
  montant       NUMERIC(12,2),
  session_cnte  VARCHAR(100),
  type_paiement VARCHAR(50),
  -- Résultat réconciliation
  statut_recon  VARCHAR(30) DEFAULT 'non_reconcilie',
  source_trouvee VARCHAR(20),  -- 'ctp' | 'paysmart' | null
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recon_ministere_fichier ON recon_ministere(fichier_id);
CREATE INDEX IF NOT EXISTS idx_recon_ministere_autorisation ON recon_ministere(autorisation);
CREATE INDEX IF NOT EXISTS idx_recon_ministere_date ON recon_ministere(date_paiement);
CREATE INDEX IF NOT EXISTS idx_recon_ministere_statut ON recon_ministere(statut_recon);

SELECT 'Migration réconciliation OK' AS status;
