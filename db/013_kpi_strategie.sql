-- ============================================================
--  Migration 013 — Module KPI Stratégie 2027-2030
--  Base : clictopay_db (PostgreSQL)
--  Idempotente : IF NOT EXISTS partout
-- ============================================================

-- ── 1. Table KPI_DEF — Référentiel des indicateurs ──────────
CREATE TABLE IF NOT EXISTS kpi_def (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  code            VARCHAR(30) NOT NULL UNIQUE,    -- ex: AXE1_DISPO_SWITCH
  axe             SMALLINT    NOT NULL,            -- 1-6, 7=programmes, 8=transverse
  programme       VARCHAR(50) DEFAULT NULL,        -- ex: 'schéma_national'
  label           VARCHAR(150) NOT NULL,
  description     TEXT        DEFAULT NULL,
  unite           VARCHAR(20) NOT NULL,            -- %, ms, TND, nb, ratio
  source          VARCHAR(20) NOT NULL             -- 'auto' | 'manuel'
                  CHECK (source IN ('auto','manuel')),
  adapter         VARCHAR(50) DEFAULT NULL,        -- nom de l'adaptateur auto
  frequence       VARCHAR(10) NOT NULL DEFAULT 'mensuel'
                  CHECK (frequence IN ('journalier','mensuel','trimestriel','annuel')),
  sens_amelioration VARCHAR(4) NOT NULL DEFAULT 'haut'
                  CHECK (sens_amelioration IN ('haut','bas')),  -- haut=plus c'est haut mieux c'est
  baseline        NUMERIC(14,3) DEFAULT NULL,      -- valeur de référence 2026
  cible_2027      NUMERIC(14,3) DEFAULT NULL,
  cible_2028      NUMERIC(14,3) DEFAULT NULL,
  cible_2029      NUMERIC(14,3) DEFAULT NULL,
  cible_2030      NUMERIC(14,3) DEFAULT NULL,
  seuil_orange    NUMERIC(14,3) DEFAULT NULL,      -- alerte orange si franchit ce seuil
  seuil_rouge     NUMERIC(14,3) DEFAULT NULL,      -- alerte rouge si franchit ce seuil
  actif           BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kpi_def_axe     ON kpi_def(axe);
CREATE INDEX IF NOT EXISTS idx_kpi_def_source  ON kpi_def(source);
CREATE INDEX IF NOT EXISTS idx_kpi_def_actif   ON kpi_def(actif);

COMMENT ON TABLE  kpi_def                   IS 'Référentiel des indicateurs KPI stratégiques 2027-2030';
COMMENT ON COLUMN kpi_def.code              IS 'Identifiant unique lisible ex: AXE1_DISPO_SWITCH';
COMMENT ON COLUMN kpi_def.axe               IS '1=Switch 2=TUNPAY 3=CTP 4=Data&Fraude 5=OpenBanking 6=Paysmart 7=Programmes 8=Transverse';
COMMENT ON COLUMN kpi_def.seuil_orange      IS 'Pour sens=haut: valeur en dessous de laquelle on alerte orange';
COMMENT ON COLUMN kpi_def.seuil_rouge       IS 'Pour sens=haut: valeur en dessous de laquelle on alerte rouge';

-- ── 2. Table KPI_VALUE — Valeurs calculées/collectées ────────
CREATE TABLE IF NOT EXISTS kpi_value (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  kpi_id          UUID        NOT NULL REFERENCES kpi_def(id) ON DELETE CASCADE,
  periode         DATE        NOT NULL,            -- 1er du mois concerné
  valeur          NUMERIC(14,3) NOT NULL,
  statut          VARCHAR(10) NOT NULL DEFAULT 'vert'
                  CHECK (statut IN ('vert','orange','rouge','na')),
  source_calcul   VARCHAR(20) NOT NULL DEFAULT 'auto'
                  CHECK (source_calcul IN ('auto','manuel','corrige')),
  note            TEXT        DEFAULT NULL,
  alerte_envoyee  BOOLEAN     NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(kpi_id, periode)
);

CREATE INDEX IF NOT EXISTS idx_kpi_value_kpi     ON kpi_value(kpi_id);
CREATE INDEX IF NOT EXISTS idx_kpi_value_periode ON kpi_value(periode DESC);
CREATE INDEX IF NOT EXISTS idx_kpi_value_statut  ON kpi_value(statut);

COMMENT ON TABLE  kpi_value              IS 'Valeurs mensuelles des KPI calculées ou saisies';
COMMENT ON COLUMN kpi_value.periode      IS 'Premier jour du mois concerné ex: 2027-01-01';
COMMENT ON COLUMN kpi_value.source_calcul IS 'auto=collecté par adapter | manuel=saisi | corrige=corrigé post-collecte';

-- ── 3. Table KPI_MANUAL_ENTRY — File d'attente saisie manuelle
CREATE TABLE IF NOT EXISTS kpi_manual_entry (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  kpi_id          UUID        NOT NULL REFERENCES kpi_def(id) ON DELETE CASCADE,
  periode         DATE        NOT NULL,
  valeur_proposee NUMERIC(14,3) NOT NULL,
  note            TEXT        DEFAULT NULL,
  statut_validation VARCHAR(15) NOT NULL DEFAULT 'en_attente'
                  CHECK (statut_validation IN ('en_attente','valide','rejete')),
  soumis_par      UUID        REFERENCES users(id),
  valide_par      UUID        REFERENCES users(id) DEFAULT NULL,
  soumis_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valide_at       TIMESTAMPTZ DEFAULT NULL,
  raison_rejet    TEXT        DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_kpi_manual_kpi      ON kpi_manual_entry(kpi_id);
CREATE INDEX IF NOT EXISTS idx_kpi_manual_statut   ON kpi_manual_entry(statut_validation);
CREATE INDEX IF NOT EXISTS idx_kpi_manual_periode  ON kpi_manual_entry(periode DESC);

COMMENT ON TABLE kpi_manual_entry IS 'Saisies manuelles de KPI soumises à validation (workflow double validation)';

-- ── 4. Table KPI_ALERTE — Historique des alertes déclenchées ─
CREATE TABLE IF NOT EXISTS kpi_alerte (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  kpi_id          UUID        NOT NULL REFERENCES kpi_def(id) ON DELETE CASCADE,
  periode         DATE        NOT NULL,
  niveau          VARCHAR(10) NOT NULL CHECK (niveau IN ('orange','rouge')),
  valeur          NUMERIC(14,3),
  seuil           NUMERIC(14,3),
  mois_consecutifs SMALLINT  DEFAULT 1,
  email_envoye    BOOLEAN     NOT NULL DEFAULT false,
  acquittee       BOOLEAN     NOT NULL DEFAULT false,
  acquittee_par   UUID        REFERENCES users(id) DEFAULT NULL,
  acquittee_at    TIMESTAMPTZ DEFAULT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kpi_alerte_kpi      ON kpi_alerte(kpi_id);
CREATE INDEX IF NOT EXISTS idx_kpi_alerte_acquittee ON kpi_alerte(acquittee);

-- ── 5. Triggers updated_at ────────────────────────────────────
DO $$ BEGIN
  CREATE TRIGGER trg_kpi_def_updated_at
    BEFORE UPDATE ON kpi_def
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_kpi_value_updated_at
    BEFORE UPDATE ON kpi_value
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 6. Pré-alimentation des 20 KPI ───────────────────────────
INSERT INTO kpi_def
  (code, axe, label, description, unite, source, adapter, frequence, sens_amelioration,
   baseline, cible_2027, cible_2028, cible_2029, cible_2030, seuil_orange, seuil_rouge)
VALUES

-- AXE 1 — Switch national
('AXE1_DISPO_SWITCH',     1,
 'Disponibilité du switch national',
 'Taux de disponibilité (uptime) du switch SmartVista mesuré sur le mois',
 '%', 'auto', 'switch', 'mensuel', 'haut',
 99.50, 99.70, 99.80, 99.90, 99.95, 99.70, 99.50),

('AXE1_TPS_REPONSE',      1,
 'Temps de réponse moyen switch (ms)',
 'Temps de réponse moyen des transactions autorisées par le switch',
 'ms', 'auto', 'switch', 'mensuel', 'bas',
 850, 800, 750, 700, 650, 900, 1100),

('AXE1_TX_SUCCES_INTER',  1,
 'Taux de succès transactions interbancaires',
 'Ratio transactions interbancaires approuvées / initiées',
 '%', 'auto', 'switch', 'mensuel', 'haut',
 97.50, 97.80, 98.00, 98.20, 98.50, 97.00, 96.00),

-- AXE 2 — TUNPAY
('AXE2_NB_WALLETS',       2,
 'Nombre de wallets TUNPAY actifs',
 'Nombre de wallets ayant effectué au moins 1 transaction dans le mois',
 'nb', 'manuel', NULL, 'mensuel', 'haut',
 NULL, 50000, 120000, 250000, 500000, NULL, NULL),

('AXE2_VOL_TUNPAY',       2,
 'Volume de transactions TUNPAY (TND)',
 'Montant total des transactions traitées via TUNPAY sur le mois',
 'TND', 'manuel', NULL, 'mensuel', 'haut',
 NULL, 5000000, 15000000, 40000000, 100000000, NULL, NULL),

('AXE2_TX_SUCCES_TUNPAY', 2,
 'Taux de succès TUNPAY',
 'Ratio transactions TUNPAY approuvées / initiées',
 '%', 'manuel', NULL, 'mensuel', 'haut',
 NULL, 95.00, 96.50, 97.50, 98.00, 94.00, 92.00),

-- AXE 3 — ClicToPay
('AXE3_TX_SUCCES_CTP',    3,
 'Taux de succès ClicToPay (taux ajusté)',
 'Taux ajusté hors sessions expirées — mesuré depuis Oracle BPC',
 '%', 'auto', 'ctp', 'mensuel', 'haut',
 75.00, 77.00, 79.00, 81.00, 83.00, 74.00, 72.00),

('AXE3_NB_MARCHANDS_ACTIFS', 3,
 'Nombre de marchands ClicToPay actifs',
 'Marchands ayant traité au moins 1 transaction dans le mois',
 'nb', 'auto', 'ctp', 'mensuel', 'haut',
 NULL, 800, 1000, 1300, 1700, NULL, NULL),

('AXE3_VOL_CTP',          3,
 'Volume e-commerce ClicToPay (TND/mois)',
 'Montant total des transactions ClicToPay approuvées sur le mois',
 'TND', 'auto', 'ctp', 'mensuel', 'haut',
 NULL, 80000000, 120000000, 180000000, 260000000, NULL, NULL),

-- AXE 4 — Data & Fraude
('AXE4_TX_FRAUDE',        4,
 'Taux de fraude (basis points)',
 'Montant transactions frauduleuses / montant total en basis points',
 'bps', 'manuel', NULL, 'mensuel', 'bas',
 NULL, 3.50, 3.00, 2.50, 2.00, 4.00, 5.00),

('AXE4_DELAI_DETECTION',  4,
 'Délai moyen de détection des incidents de fraude (heures)',
 'Temps moyen entre occurrence et détection d une fraude',
 'h', 'manuel', NULL, 'mensuel', 'bas',
 NULL, 4.00, 3.00, 2.00, 1.00, 6.00, 12.00),

-- AXE 5 — Open Banking
('AXE5_NB_API_ACTIVES',   5,
 'Nombre d APIs Open Banking actives',
 'APIs publiées et actives sur le portail Open Banking SMT',
 'nb', 'manuel', NULL, 'trimestriel', 'haut',
 0, 5, 10, 18, 25, NULL, NULL),

('AXE5_NB_PARTENAIRES',   5,
 'Nombre de partenaires connectés via API',
 'Entités tierces disposant d au moins un token API actif',
 'nb', 'auto', 'api', 'mensuel', 'haut',
 0, 10, 25, 50, 100, NULL, NULL),

-- AXE 6 — Paysmart
('AXE6_TX_SUCCES_PSM',    6,
 'Taux de succès Paysmart (PAID/initié)',
 'Ratio transactions Paysmart PAID / total initiées sur le mois',
 '%', 'auto', 'paysmart', 'mensuel', 'haut',
 NULL, 92.00, 93.50, 95.00, 96.00, 90.00, 88.00),

('AXE6_NB_FACTURIERS',    6,
 'Nombre de facturiers connectés à Paysmart',
 'Facturiers actifs ayant traité au moins 1 transaction dans le mois',
 'nb', 'auto', 'paysmart', 'mensuel', 'haut',
 NULL, 20, 35, 55, 80, NULL, NULL),

('AXE6_VOL_PSM',          6,
 'Volume de transactions Paysmart (TND/mois)',
 'Montant total des transactions Paysmart PAID sur le mois',
 'TND', 'auto', 'paysmart', 'mensuel', 'haut',
 NULL, 10000000, 25000000, 60000000, 150000000, NULL, NULL),

-- AXE 7 — Programmes de place
('AXE7_SCHEMA_NATIONAL',  7,
 'Avancement schéma de paiement national (%)',
 'Pourcentage d avancement du projet schéma national (jalons validés / total)',
 '%', 'manuel', NULL, 'trimestriel', 'haut',
 0, 20, 50, 80, 100, NULL, NULL),

('AXE7_TOKENISATION',     7,
 'Avancement tokenisation (%)',
 'Pourcentage d avancement du projet tokenisation BCT',
 '%', 'manuel', NULL, 'trimestriel', 'haut',
 0, 15, 40, 75, 100, NULL, NULL),

-- AXE 8 — Transverse
('AXE8_MTTR',             8,
 'MTTR moyen (Mean Time To Repair) en heures',
 'Temps moyen de résolution des incidents de production',
 'h', 'manuel', NULL, 'mensuel', 'bas',
 NULL, 4.00, 3.00, 2.50, 2.00, 5.00, 8.00),

('AXE8_SLA_BPC',          8,
 'Taux de respect SLA fournisseur BPC',
 'Pourcentage de tickets BPC résolus dans les délais contractuels',
 '%', 'auto', 'sla', 'mensuel', 'haut',
 NULL, 85.00, 88.00, 90.00, 93.00, 80.00, 75.00)

ON CONFLICT (code) DO NOTHING;

SELECT COUNT(*) AS kpi_inseres FROM kpi_def;
SELECT 'Migration 013 KPI Stratégie OK' AS status;
