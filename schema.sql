-- ============================================================
--  ClicToPay Monitoring Dashboard — PostgreSQL Schema v2.0
--  Exécuter : psql -U postgres -d clictopay_db -f schema.sql
-- ============================================================

-- Créer la base si nécessaire (exécuter en tant que superuser)
-- CREATE DATABASE clictopay_db ENCODING 'UTF8' LC_COLLATE 'fr_FR.UTF-8';

-- Extension pour UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
--  TABLE : users
--  Opérateurs et administrateurs de la plateforme
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nom           VARCHAR(100)  NOT NULL,
  prenom        VARCHAR(100)  NOT NULL,
  email         VARCHAR(255)  NOT NULL UNIQUE,
  password_hash VARCHAR(255)  NOT NULL,
  role          VARCHAR(20)   NOT NULL DEFAULT 'operateur'
                              CHECK (role IN ('admin','operateur','lecteur')),
  actif         BOOLEAN       NOT NULL DEFAULT true,
  derniere_connexion TIMESTAMPTZ,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role  ON users(role);

COMMENT ON TABLE  users            IS 'Utilisateurs de la plateforme ClicToPay Monitoring';
COMMENT ON COLUMN users.role       IS 'admin = accès total | operateur = prise en charge | lecteur = consultation';
COMMENT ON COLUMN users.password_hash IS 'bcrypt hash, rounds=12';

-- ============================================================
--  TABLE : refresh_tokens
--  Tokens JWT de rafraîchissement
-- ============================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255)  NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ   NOT NULL,
  created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  revoked    BOOLEAN       NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_rt_user_id    ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_rt_token_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_rt_expires    ON refresh_tokens(expires_at);

-- ============================================================
--  TABLE : banks
--  Banques acquéreurs — remplace les variables BANK_XX du .env
-- ============================================================
CREATE TABLE IF NOT EXISTS banks (
  id         SERIAL PRIMARY KEY,
  code       VARCHAR(2)   NOT NULL UNIQUE,  -- 2 premiers chiffres de l'affiliation
  name       VARCHAR(100) NOT NULL,
  email      VARCHAR(255) NOT NULL,
  actif      BOOLEAN      NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_banks_code  ON banks(code);
CREATE INDEX IF NOT EXISTS idx_banks_actif ON banks(actif);

COMMENT ON COLUMN banks.code IS '2 premiers chiffres du numéro d affiliation marchand';

-- ============================================================
--  TABLE : merchants_tracking
--  Suivi du workflow complet par marchand
-- ============================================================
CREATE TABLE IF NOT EXISTS merchants_tracking (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  processing_id         VARCHAR(20)  NOT NULL UNIQUE,
  raison_sociale        VARCHAR(255) NOT NULL,
  terminal_id           VARCHAR(20),
  mcc                   VARCHAR(10),
  site_url              VARCHAR(512),
  email_contact         VARCHAR(255),
  bank_code             VARCHAR(2),
  bank_name             VARCHAR(100),

  -- Workflow statut
  statut                VARCHAR(30)  NOT NULL DEFAULT 'en_attente'
                        CHECK (statut IN (
                          'en_attente',         -- importé, pas encore traité
                          'prise_en_charge',    -- email de bienvenue envoyé
                          'recettes_envoyees',  -- cahier transmis au marchand
                          'recettes_recues',    -- fichier reçu, en attente validation
                          'valide',             -- recettes approuvées
                          'banque_notifiee',    -- banque informée
                          'en_production'       -- email production envoyé
                        )),

  -- Dates étapes
  date_import           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  date_prise_en_charge  TIMESTAMPTZ,
  date_envoi_recettes   TIMESTAMPTZ,
  date_reception_recettes TIMESTAMPTZ,
  date_validation       TIMESTAMPTZ,
  date_notif_banque     TIMESTAMPTZ,
  date_production       TIMESTAMPTZ,

  -- Opérateurs responsables
  operateur_prise_en_charge UUID REFERENCES users(id),
  operateur_validation      UUID REFERENCES users(id),

  -- Références
  tracking_ref_test     VARCHAR(50),   -- CTP-YYYYMMDD-XXXX-RRRR
  tracking_ref_prod     VARCHAR(50),   -- CTP-PROD-YYYYMMDD-XXXX-RRRR

  -- Remarques
  notes                 TEXT,

  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mt_processing_id ON merchants_tracking(processing_id);
CREATE INDEX IF NOT EXISTS idx_mt_statut        ON merchants_tracking(statut);
CREATE INDEX IF NOT EXISTS idx_mt_bank_code     ON merchants_tracking(bank_code);
CREATE INDEX IF NOT EXISTS idx_mt_date_import   ON merchants_tracking(date_import DESC);

COMMENT ON TABLE  merchants_tracking         IS 'Suivi du workflow complet d affiliation marchand';
COMMENT ON COLUMN merchants_tracking.statut  IS 'Progression dans le pipeline de mise en production';

-- ============================================================
--  TABLE : validations
--  Historique des cahiers de recettes soumis et analysés
-- ============================================================
CREATE TABLE IF NOT EXISTS validations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  processing_id   VARCHAR(20)  NOT NULL,
  raison_sociale  VARCHAR(255),
  terminal_id     VARCHAR(20),
  email_marchand  VARCHAR(255),
  filename        VARCHAR(255) NOT NULL,

  -- Résultats
  verdict         VARCHAR(20)  NOT NULL DEFAULT 'pending'
                  CHECK (verdict IN ('approved','refused','pending','blank')),
  total_cas       INT          NOT NULL DEFAULT 0,
  cas_reussis     INT          NOT NULL DEFAULT 0,
  cas_echoues     INT          NOT NULL DEFAULT 0,
  cas_en_attente  INT          NOT NULL DEFAULT 0,
  critiques_reussis INT        NOT NULL DEFAULT 0,
  taux_reussite   NUMERIC(5,2) DEFAULT 0,

  -- Détail JSON des cas
  cases_json      JSONB,           -- tableau des cas avec résultats JSON
  anomalies_json  JSONB,           -- liste des anomalies détectées

  -- Actions effectuées
  marchand_notifie_at   TIMESTAMPTZ,
  banque_notifiee_at    TIMESTAMPTZ,
  banque_notifiee_nom   VARCHAR(100),
  banque_notifiee_email VARCHAR(255),
  prod_email_envoye_at  TIMESTAMPTZ,

  -- Opérateur
  valide_par      UUID REFERENCES users(id),

  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_val_processing_id ON validations(processing_id);
CREATE INDEX IF NOT EXISTS idx_val_verdict       ON validations(verdict);
CREATE INDEX IF NOT EXISTS idx_val_created       ON validations(created_at DESC);

COMMENT ON TABLE  validations            IS 'Historique des cahiers de recettes validés par le gestionnaire';
COMMENT ON COLUMN validations.cases_json IS 'JSONB : [{tcId, name, resultat, jsonResp, jsonErrors, normalizedResult}]';

-- ============================================================
--  TABLE : emails_log
--  Journal de tous les emails envoyés
-- ============================================================
CREATE TABLE IF NOT EXISTS emails_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type        VARCHAR(50)  NOT NULL
              CHECK (type IN (
                'bienvenue',
                'notification_marchand',
                'notification_banque',
                'passage_production'
              )),
  processing_id VARCHAR(20),
  to_email    VARCHAR(255) NOT NULL,
  cc_emails   TEXT,
  subject     VARCHAR(500),
  status      VARCHAR(20)  NOT NULL DEFAULT 'sent'
              CHECK (status IN ('sent','failed','pending')),
  error_msg   TEXT,
  sent_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  envoye_par  UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_elog_processing_id ON emails_log(processing_id);
CREATE INDEX IF NOT EXISTS idx_elog_type          ON emails_log(type);
CREATE INDEX IF NOT EXISTS idx_elog_sent_at       ON emails_log(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_elog_status        ON emails_log(status);

COMMENT ON TABLE emails_log IS 'Journal complet de tous les emails envoyés depuis la plateforme';

-- ============================================================
--  TABLE : audit_log
--  Traçabilité des actions importantes
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id),
  user_email  VARCHAR(255),
  action      VARCHAR(100) NOT NULL,  -- ex: 'PRISE_EN_CHARGE', 'VALIDATION_APPROUVEE'
  resource    VARCHAR(100),           -- ex: 'merchant:0520801267'
  details     JSONB,
  ip_address  INET,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user_id  ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action   ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_created  ON audit_log(created_at DESC);

COMMENT ON TABLE audit_log IS 'Traçabilité des actions effectuées par les opérateurs';

-- ============================================================
--  TRIGGER : updated_at automatique
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_banks_updated_at
    BEFORE UPDATE ON banks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_mt_updated_at
    BEFORE UPDATE ON merchants_tracking
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_val_updated_at
    BEFORE UPDATE ON validations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
--  SEED : Données initiales
-- ============================================================

-- Utilisateur admin par défaut (mot de passe : Admin@CTP2026)
-- Hash bcrypt généré avec rounds=12
INSERT INTO users (nom, prenom, email, password_hash, role)
VALUES (
  'Admin',
  'ClicToPay',
  'admin@clictopay.com',
  -- bcrypt hash de 'Admin@CTP2026' avec rounds=12
  -- À RÉGÉNÉRER avec : node -e "const b=require('bcrypt');b.hash('Admin@CTP2026',12).then(console.log)"
  '$2b$12$PLACEHOLDER_REGENERATE_THIS_HASH_BEFORE_PRODUCTION',
  'admin'
) ON CONFLICT (email) DO NOTHING;

-- Banques (migration depuis .env)
INSERT INTO banks (code, name, email) VALUES
  ('01', 'ATB',              'Mohamed.Bouhafa@atb.com.tn'),
  ('03', 'BNA',              'souissi.MohamedMansour@bna.tn'),
  ('04', 'Attijari Bank',    'NAJJARI.INES@attijaribank.com.tn'),
  ('05', 'Banque de Tunisie','ZOUBAIER.KANZARI@BT.COM.TN'),
  ('07', 'AMEN Bank',        'malek.bensalah@amenbank.com.tn'),
  ('08', 'BIAT',             'sonia.frini@biat.com.tn'),
  ('10', 'STB',              's.bensalem@stb.com.tn'),
  ('11', 'UBCI',             'Amal.Labidi@ubci.com.tn'),
  ('12', 'UIB',              'Service.AffiliationTPE@uib.com.tn'),
  ('14', 'BH Bank',          'nadia.nehdi@bhbank.tn'),
  ('17', 'ONP (La Poste)',   'mariem.benmansour@tnpost.tn'),
  ('23', 'QNB',              'SEIF.BENSOLTANA@qnb.com.tn'),
  ('24', 'BTE',              'Amine.Bouraoui@bte.com.tn'),
  ('25', 'Banque Zitouna',   'mna.Sassi@banquezitouna.com'),
  ('28', 'ABC Bank',         'nejib.benmahmoud@bank-abc.com'),
  ('47', 'WIFAK Bank',       'Rahma.Mathlouthi@wifakbank.com')
ON CONFLICT (code) DO UPDATE SET
  name  = EXCLUDED.name,
  email = EXCLUDED.email;

-- ============================================================
--  VUES utiles
-- ============================================================

-- Vue : tableau de bord des dossiers avec statut lisible
CREATE OR REPLACE VIEW v_merchant_dashboard AS
SELECT
  mt.processing_id,
  mt.raison_sociale,
  mt.terminal_id,
  mt.bank_name,
  mt.statut,
  mt.date_import,
  mt.date_prise_en_charge,
  mt.date_validation,
  mt.date_production,
  EXTRACT(DAY FROM (NOW() - mt.date_import))::INT AS jours_depuis_import,
  u1.email AS operateur_pec,
  u2.email AS operateur_validation,
  CASE mt.statut
    WHEN 'en_attente'          THEN 1
    WHEN 'prise_en_charge'     THEN 2
    WHEN 'recettes_envoyees'   THEN 3
    WHEN 'recettes_recues'     THEN 4
    WHEN 'valide'              THEN 5
    WHEN 'banque_notifiee'     THEN 6
    WHEN 'en_production'       THEN 7
    ELSE 0
  END AS etape_num
FROM merchants_tracking mt
LEFT JOIN users u1 ON mt.operateur_prise_en_charge = u1.id
LEFT JOIN users u2 ON mt.operateur_validation      = u2.id
ORDER BY mt.date_import DESC;

-- Vue : statistiques validations par mois
CREATE OR REPLACE VIEW v_validations_stats AS
SELECT
  DATE_TRUNC('month', created_at) AS mois,
  COUNT(*)                         AS total,
  COUNT(*) FILTER (WHERE verdict = 'approved') AS approuves,
  COUNT(*) FILTER (WHERE verdict = 'refused')  AS refuses,
  COUNT(*) FILTER (WHERE verdict = 'pending')  AS incomplets,
  ROUND(AVG(taux_reussite), 1)     AS taux_moyen
FROM validations
GROUP BY DATE_TRUNC('month', created_at)
ORDER BY mois DESC;

-- Vue : activité emails par type (30 derniers jours)
CREATE OR REPLACE VIEW v_emails_activity AS
SELECT
  type,
  COUNT(*)  AS total,
  COUNT(*) FILTER (WHERE status = 'sent')   AS envoyes,
  COUNT(*) FILTER (WHERE status = 'failed') AS echoues
FROM emails_log
WHERE sent_at >= NOW() - INTERVAL '30 days'
GROUP BY type;

-- ============================================================
--  FIN DU SCHÉMA
-- ============================================================
SELECT 'Schema ClicToPay v2.0 installé avec succès ✅' AS message;
CREATE TABLE IF NOT EXISTS alert_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255) NOT NULL,
  metric      VARCHAR(100) NOT NULL,
  operator    VARCHAR(10)  NOT NULL,
  threshold   NUMERIC      NOT NULL,
  level       VARCHAR(20)  NOT NULL DEFAULT 'warning',
  active      BOOLEAN      NOT NULL DEFAULT true,
  email_notify BOOLEAN     NOT NULL DEFAULT false,
  email_dest  VARCHAR(500),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS alert_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id      UUID REFERENCES alert_rules(id) ON DELETE CASCADE,
  rule_name    VARCHAR(255),
  metric       VARCHAR(100),
  value        NUMERIC,
  threshold    NUMERIC,
  level        VARCHAR(20),
  message      TEXT,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_alert_rules_active    ON alert_rules(active);
CREATE INDEX IF NOT EXISTS idx_alert_history_rule_id ON alert_history(rule_id);
CREATE INDEX IF NOT EXISTS idx_alert_history_date    ON alert_history(triggered_at DESC);
