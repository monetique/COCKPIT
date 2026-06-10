-- ============================================================
--  Migration 012 — Restructuration + Versioning
--  Base : clictopay_db (PostgreSQL)
--  Idempotente : IF NOT EXISTS partout
-- ============================================================

-- ── 1. Extension users : division + axes autorisés ──────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS division      VARCHAR(50)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS axes_autorises INTEGER[]   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS actif         BOOLEAN      NOT NULL DEFAULT true;

-- Nouveaux rôles autorisés (contrainte élargie)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN (
    'admin',          -- accès total
    'directeur',      -- tous les axes, pas de saisie KPI
    'chef_division',  -- ses axes uniquement (axes_autorises)
    'pilotage',       -- tout + saisie KPI manuelle
    'operateur',      -- supervision opérationnelle
    'lecteur',        -- consultation uniquement
    'dg',             -- synthèse DG uniquement
    'banquier'        -- vue banque filtrée
  ));

COMMENT ON COLUMN users.division       IS 'Division de rattachement (systemes | canaux)';
COMMENT ON COLUMN users.axes_autorises IS 'Axes stratégiques visibles pour chef_division (1-6, 7=PROGRAMMES, 8=TRANSVERSE)';

-- ── 2. Table app_versions ────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_versions (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  version       VARCHAR(20) NOT NULL,
  changelog     TEXT,
  deployed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deployed_by   VARCHAR(100),          -- hostname du container
  git_commit    VARCHAR(40) DEFAULT NULL,
  actif         BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_versions_version    ON app_versions(version);
CREATE INDEX IF NOT EXISTS idx_app_versions_deployed   ON app_versions(deployed_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_versions_actif      ON app_versions(actif);

COMMENT ON TABLE  app_versions             IS 'Historique des versions déployées de SMT Cockpit';
COMMENT ON COLUMN app_versions.version     IS 'Numéro sémantique ex: 2.1.0';
COMMENT ON COLUMN app_versions.changelog   IS 'Description des changements (Markdown)';
COMMENT ON COLUMN app_versions.deployed_by IS 'Hostname ou ID du container Docker';
COMMENT ON COLUMN app_versions.git_commit  IS 'SHA1 du commit Git si disponible';
COMMENT ON COLUMN app_versions.actif       IS 'true = version courante active';

-- ── 3. Audit log — ajouter colonnes manquantes ───────────────
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS version_id UUID REFERENCES app_versions(id) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ip_address INET DEFAULT NULL;

-- ── 4. Insérer la version initiale 2.0.0 ─────────────────────
INSERT INTO app_versions (version, changelog, deployed_by, actif)
VALUES (
  '2.0.0',
  E'## SMT Cockpit v2.0.0\n\n### Fonctionnalités initiales\n- Supervision transactions ClicToPay (Oracle BPC)\n- Supervision Paysmart (SQL Server)\n- Gestion marchands et validation dossiers\n- Vue banques et rôle banquier\n- Module inscriptions scolaires CNTE\n- Rapports PDF horaires par email\n- Réconciliation fichiers Ministère\n- Facturation Paysmart (Facturiers, FSP, SMT, We-Settle, Acquéreur)\n- Facturation inscriptions scolaires',
  'migration-initiale',
  true
)
ON CONFLICT DO NOTHING;

SELECT 'Migration 012 restructuration OK' AS status;
