-- ============================================================
--  Migration SLA — Alertes de stagnation dossiers marchands
--  psql -U postgres -d clictopay_db -f migration_sla.sql
-- ============================================================

-- ── 1. Paramètres SLA par étape ────────────────────────────
-- Délais en jours au-delà desquels une alerte est déclenchée
CREATE TABLE IF NOT EXISTS sla_config (
  id             UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  statut         VARCHAR(30) NOT NULL UNIQUE,
  delai_warning  INT     NOT NULL DEFAULT 7,   -- jours → alerte warning
  delai_danger   INT     NOT NULL DEFAULT 14,  -- jours → alerte danger
  actif          BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Valeurs par défaut (ajustables depuis l'UI)
INSERT INTO sla_config (statut, delai_warning, delai_danger) VALUES
  ('en_attente',         3,  7),
  ('prise_en_charge',    7, 14),
  ('recettes_envoyees',  7, 21),
  ('recettes_recues',    3,  7),
  ('valide',             3,  7),
  ('banque_notifiee',    5, 10)
ON CONFLICT (statut) DO NOTHING;

-- ── 2. Historique alertes SLA ──────────────────────────────
CREATE TABLE IF NOT EXISTS sla_alerts (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  processing_id  VARCHAR(20) NOT NULL REFERENCES merchants_tracking(processing_id) ON DELETE CASCADE,
  raison_sociale VARCHAR(255),
  statut         VARCHAR(30),
  jours_en_attente INT       NOT NULL,
  niveau         VARCHAR(10) NOT NULL CHECK (niveau IN ('warning','danger')),
  email_envoye   BOOLEAN     NOT NULL DEFAULT false,
  email_destinataires TEXT,
  triggered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sla_alerts_pid      ON sla_alerts(processing_id);
CREATE INDEX IF NOT EXISTS idx_sla_alerts_date     ON sla_alerts(triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_sla_alerts_statut   ON sla_alerts(statut);

-- ── 3. Colonne cooldown sur merchants_tracking ─────────────
-- Dernière alerte SLA envoyée pour ce dossier (cooldown 24h)
ALTER TABLE merchants_tracking
  ADD COLUMN IF NOT EXISTS sla_derniere_alerte TIMESTAMPTZ;

COMMENT ON TABLE  sla_config  IS 'Délais SLA par statut workflow marchand';
COMMENT ON TABLE  sla_alerts  IS 'Historique des alertes de stagnation dossiers';
