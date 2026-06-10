#!/usr/bin/env bash
# =============================================================================
#  setup-cockpit-lab.sh — Création de l'environnement Cockpit LAB
#  Usage : bash setup-cockpit-lab.sh [--auto] [--skip-db] [--dry-run]
#
#  Flags :
#    --auto      Pas de confirmation interactive (CI/CD ou usage avancé)
#    --skip-db   Sauter la duplication de la base (si déjà faite)
#    --dry-run   Afficher les commandes sans les exécuter
#
#  Prérequis :
#    - Docker et Docker Compose installés sur l'hôte
#    - Accès au répertoire /data/applications/COCKPIT/ (lecture seule)
#    - Fichier .env.lab présent dans /data/applications/COCKPIT-LAB/
#      (à créer manuellement AVANT de lancer ce script — voir section 3.3 du plan)
#
#  Ce script ne modifie AUCUN fichier de production.
#  Il n'écrit que dans /data/applications/COCKPIT-LAB/ et dans les volumes lab-*.
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# CONFIGURATION — adapter si les chemins diffèrent sur votre serveur
# ---------------------------------------------------------------------------
PROD_DIR="/data/applications/COCKPIT"
LAB_DIR="/data/applications/COCKPIT-LAB"
COMPOSE_FILE="$LAB_DIR/docker-compose.lab.yml"
ENV_FILE="$LAB_DIR/.env.lab"
BACKUP_DIR="/data/backups/cockpit-lab"
LOG_FILE="/tmp/cockpit-lab-setup-$(date +%Y%m%d-%H%M%S).log"

PROD_CONTAINER="smt-cockpit-db"   # container PostgreSQL de production
LAB_APP_CONTAINER="cockpit-lab-app"
LAB_DB_CONTAINER="cockpit-lab-db"
LAB_MAIL_CONTAINER="cockpit-lab-mail"

LAB_APP_PORT=3001
LAB_DB_PORT=5433
LAB_MAIL_PORT=8025

# Couleurs
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

# Flags
AUTO=false; SKIP_DB=false; DRY_RUN=false
for arg in "$@"; do
  case $arg in
    --auto)    AUTO=true ;;
    --skip-db) SKIP_DB=true ;;
    --dry-run) DRY_RUN=true ;;
  esac
done

# ---------------------------------------------------------------------------
# Fonctions utilitaires
# ---------------------------------------------------------------------------
log()  { echo -e "$(date '+%H:%M:%S') $*" | tee -a "$LOG_FILE"; }
info() { log "${CYAN}[INFO]${RESET}  $*"; }
ok()   { log "${GREEN}[OK]${RESET}    $*"; }
warn() { log "${YELLOW}[WARN]${RESET}  $*"; }
fail() { log "${RED}[FAIL]${RESET}  $*"; exit 1; }
step() { echo -e "\n${BOLD}${CYAN}══════════════════════════════════════════${RESET}"; \
         log "${BOLD}▶ $*${RESET}"; \
         echo -e "${BOLD}${CYAN}══════════════════════════════════════════${RESET}"; }

run() {
  # Exécute une commande, la logge, respecte --dry-run
  local cmd="$*"
  info "CMD: $cmd"
  if [ "$DRY_RUN" = true ]; then
    echo -e "  ${YELLOW}[DRY-RUN] $cmd${RESET}"
  else
    eval "$cmd" 2>&1 | tee -a "$LOG_FILE"
  fi
}

confirm() {
  # Demande une confirmation interactive sauf si --auto
  local msg="$1"
  if [ "$AUTO" = true ]; then
    info "Auto-confirmation : $msg"
    return 0
  fi
  echo -e "\n${YELLOW}⚠  $msg${RESET}"
  read -rp "   Continuer ? (oui/non) : " ans
  [[ "$ans" == "oui" ]] || fail "Opération annulée par l'utilisateur."
}

section_header() {
  echo -e "\n${BOLD}${GREEN}"
  echo "┌─────────────────────────────────────────────────────┐"
  printf "│  %-51s│\n" "$1"
  echo "└─────────────────────────────────────────────────────┘"
  echo -e "${RESET}"
}

# ---------------------------------------------------------------------------
# Bannière de démarrage
# ---------------------------------------------------------------------------
clear
echo -e "${BOLD}${CYAN}"
cat << 'BANNER'
  ╔══════════════════════════════════════════════════════╗
  ║         COCKPIT LAB — Script de déploiement          ║
  ║         Environnement isolé — SMT                    ║
  ╚══════════════════════════════════════════════════════╝
BANNER
echo -e "${RESET}"
log "Journal : $LOG_FILE"
[ "$DRY_RUN" = true ] && warn "Mode DRY-RUN activé — aucune commande ne sera exécutée."
[ "$AUTO"    = true ] && warn "Mode AUTO activé — confirmations automatiques."

# =============================================================================
# ÉTAPE A — VÉRIFICATIONS PRÉALABLES (sans impact sur la prod)
# =============================================================================
section_header "ÉTAPE A — Vérifications préalables"

step "A1 — Vérification des prérequis système"

# Docker présent ?
command -v docker &>/dev/null || fail "Docker n'est pas installé ou non accessible."
ok "Docker : $(docker --version)"

command -v docker &>/dev/null && docker compose version &>/dev/null \
  || fail "Docker Compose (plugin) n'est pas disponible."
ok "Docker Compose : $(docker compose version)"

# Répertoire source lisible ?
[ -d "$PROD_DIR" ] || fail "Répertoire de production introuvable : $PROD_DIR"
[ -r "$PROD_DIR" ] || fail "Répertoire de production non lisible : $PROD_DIR"
ok "Répertoire source : $PROD_DIR (accessible)"

step "A2 — Vérification des ports LAB"

for port in $LAB_APP_PORT $LAB_DB_PORT $LAB_MAIL_PORT; do
  if ss -tlnp 2>/dev/null | grep -q ":$port "; then
    fail "Port $port déjà utilisé sur l'hôte. Modifiez LAB_APP_PORT/LAB_DB_PORT/LAB_MAIL_PORT dans ce script."
  fi
  ok "Port $port : libre"
done

step "A3 — Vérification de l'absence de volumes LAB existants"

EXISTING_VOLS=$(docker volume ls --format '{{.Name}}' 2>/dev/null | grep '^lab-' || true)
if [ -n "$EXISTING_VOLS" ]; then
  warn "Volumes LAB déjà présents : $EXISTING_VOLS"
  confirm "Des volumes LAB existent déjà. Les supprimer et recommencer ?"
  for vol in $EXISTING_VOLS; do
    run "docker volume rm $vol"
  done
  ok "Volumes LAB supprimés."
fi

step "A4 — Vérification du fichier .env.lab"

[ -f "$ENV_FILE" ] || fail \
  ".env.lab introuvable : $ENV_FILE\nCréez-le manuellement à partir du modèle (section 3.3 du plan) avant de relancer."

# Sécurité : pas de credentials PROD dans .env.lab
PROD_CREDS=$(grep -iE 'ORACLE_PROD|PROD_HOST|PROD_PASSWORD|PROD_USER' "$ENV_FILE" | grep -v '^s*#' || true)
if [ -n "$PROD_CREDS" ]; then
  fail "DANGER : des credentials de production ont été détectés dans .env.lab :\n$PROD_CREDS\nRetirez-les avant de continuer."
fi
ok ".env.lab : aucun credential PROD détecté"

# CORS ne pointe pas vers la prod
CORS_VAL=$(grep '^CORS_ORIGIN' "$ENV_FILE" | cut -d= -f2- || true)
if echo "$CORS_VAL" | grep -qiE 'prod|0\.0\.0\.0|\*'; then
  warn "CORS_ORIGIN potentiellement trop ouvert : $CORS_VAL"
  confirm "Confirmer que CORS_ORIGIN=$CORS_VAL est acceptable pour le LAB."
fi
ok "CORS_ORIGIN : $CORS_VAL"

# SMTP pointe vers lab-mail ?
SMTP_HOST_VAL=$(grep '^SMTP_HOST' "$ENV_FILE" | cut -d= -f2- || true)
if [ "$SMTP_HOST_VAL" != "lab-mail" ]; then
  warn "SMTP_HOST=$SMTP_HOST_VAL — attendu : lab-mail"
  confirm "Le SMTP n'est pas Mailhog. Les emails pourraient partir vers de vrais destinataires. Continuer quand même ?"
fi
ok "SMTP_HOST : $SMTP_HOST_VAL"

step "A5 — Vérification du docker-compose.lab.yml"

[ -f "$COMPOSE_FILE" ] || fail \
  "docker-compose.lab.yml introuvable : $COMPOSE_FILE\nCréez-le à partir du modèle (section 3.2 du plan) avant de relancer."

# Aucune référence aux volumes de production
PROD_VOLS=$(grep 'smt-' "$COMPOSE_FILE" || true)
if [ -n "$PROD_VOLS" ]; then
  fail "DANGER : des volumes/services de production (smt-*) sont référencés dans docker-compose.lab.yml :\n$PROD_VOLS"
fi
ok "docker-compose.lab.yml : aucun volume de production référencé"

ok "✔ Toutes les vérifications préalables sont passées."
confirm "Passer à l'étape B (copie des sources et construction de l'image) ?"

# =============================================================================
# ÉTAPE B — BASE DE DONNÉES (dump, anonymisation, restauration)
# =============================================================================
if [ "$SKIP_DB" = false ]; then
  section_header "ÉTAPE B — Duplication de la base de données"

  # Lire les variables DB depuis .env.lab
  LAB_DB_NAME=$(grep '^DB_NAME'     "$ENV_FILE" | cut -d= -f2-)
  LAB_DB_USER=$(grep '^DB_USER'     "$ENV_FILE" | cut -d= -f2-)
  LAB_DB_PASS=$(grep '^DB_PASSWORD' "$ENV_FILE" | cut -d= -f2-)

  step "B1 — Sauvegarde du schéma de production"

  # Vérifier que le container de production est actif
  docker inspect "$PROD_CONTAINER" &>/dev/null \
    || fail "Container de production '$PROD_CONTAINER' introuvable. Vérifiez qu'il est démarré."

  PROD_DB_USER=$(docker exec "$PROD_CONTAINER" bash -c 'echo $POSTGRES_USER' 2>/dev/null \
    || docker exec "$PROD_CONTAINER" bash -c 'echo $DB_USER' 2>/dev/null || echo "postgres")
  PROD_DB_NAME=$(docker exec "$PROD_CONTAINER" bash -c 'echo $POSTGRES_DB' 2>/dev/null \
    || docker exec "$PROD_CONTAINER" bash -c 'echo $DB_NAME' 2>/dev/null || echo "cockpit")

  info "Base source : $PROD_DB_NAME@$PROD_CONTAINER (user: $PROD_DB_USER)"
  confirm "Lancer un pg_dump (lecture seule) sur le container de production $PROD_CONTAINER ?"

  mkdir -p "$BACKUP_DIR"

  run "docker exec $PROD_CONTAINER pg_dump \
    -U $PROD_DB_USER -d $PROD_DB_NAME \
    --schema-only --no-owner --no-acl \
    -f /tmp/lab_schema_only.sql"

  run "docker exec $PROD_CONTAINER pg_dump \
    -U $PROD_DB_USER -d $PROD_DB_NAME \
    --no-owner --no-acl \
    --exclude-table-data=refresh_tokens \
    --exclude-table-data=emails_log \
    --exclude-table-data=audit_log \
    --exclude-table-data=users \
    -f /tmp/lab_data_partial.sql"

  run "docker cp $PROD_CONTAINER:/tmp/lab_schema_only.sql $BACKUP_DIR/"
  run "docker cp $PROD_CONTAINER:/tmp/lab_data_partial.sql $BACKUP_DIR/"
  ok "Dumps sauvegardés dans $BACKUP_DIR/"

  step "B2 — Anonymisation des données sensibles"

  # Script SQL d'anonymisation appliqué après restauration
  cat > /tmp/lab_anonymize.sql << 'ANON_SQL'
-- ============================================================
-- Anonymisation Cockpit LAB — à exécuter après restauration
-- ============================================================

-- Anonymiser les marchands
UPDATE merchants_tracking SET
  email        = 'marchand_' || id || '@lab.local',
  telephone    = '00000000',
  rib          = repeat('0', COALESCE(length(rib), 20)),
  iban         = 'TN' || repeat('0', 22),
  nom_commercial = 'Marchand_' || id,
  adresse      = 'Adresse LAB ' || id,
  rne          = LEFT(COALESCE(rne,''), 2) || repeat('*', GREATEST(0, length(COALESCE(rne,'')) - 2)),
  cdp          = LEFT(COALESCE(cdp,''), 2) || repeat('*', GREATEST(0, length(COALESCE(cdp,'')) - 2));

-- Vider les tables non anonymisables
TRUNCATE TABLE refresh_tokens;
TRUNCATE TABLE emails_log;
TRUNCATE TABLE audit_log;
TRUNCATE TABLE users;

-- Créer les comptes de test LAB
-- NOTE : remplacer les hash bcrypt par les valeurs générées via Node.js
-- node -e "const b=require('bcrypt'); b.hash('LabAdmin2024!',12).then(h=>console.log('admin:',h))"
INSERT INTO users (nom, prenom, email, password_hash, role, actif) VALUES
  ('LAB', 'Admin',     'admin@lab.local',     '$2b$12$PLACEHOLDER_ADMIN_HASH',     'admin',     true),
  ('LAB', 'Operateur', 'operateur@lab.local',  '$2b$12$PLACEHOLDER_OPERATEUR_HASH', 'operateur', true),
  ('LAB', 'Lecteur',   'lecteur@lab.local',    '$2b$12$PLACEHOLDER_LECTEUR_HASH',   'lecteur',   true);

-- Vérification finale
SELECT 'merchants_tracking' AS tbl, COUNT(*) FROM merchants_tracking
UNION ALL SELECT 'users', COUNT(*) FROM users
UNION ALL SELECT 'refresh_tokens', COUNT(*) FROM refresh_tokens
UNION ALL SELECT 'emails_log', COUNT(*) FROM emails_log
UNION ALL SELECT 'audit_log', COUNT(*) FROM audit_log;
ANON_SQL

  ok "Script d'anonymisation généré : /tmp/lab_anonymize.sql"
  warn "⚠ IMPORTANT : avant de lancer la restauration, éditez /tmp/lab_anonymize.sql"
  warn "  et remplacez les PLACEHOLDER_*_HASH par de vrais hash bcrypt."
  warn "  Commande : node -e \"const b=require('bcrypt'); b.hash('VotreMotDePasse',12).then(h=>console.log(h))\""

  confirm "Les hash bcrypt sont-ils replacés dans /tmp/lab_anonymize.sql ? Continuer la restauration ?"

else
  info "--skip-db activé : étape B ignorée."
fi

# =============================================================================
# ÉTAPE C — CONSTRUCTION ET DÉMARRAGE DU STACK LAB
# =============================================================================
section_header "ÉTAPE C — Construction et démarrage de Cockpit LAB"

step "C1 — Construction de l'image Docker LAB"

confirm "Construire l'image Docker LAB (peut prendre 2-5 minutes) ?"

run "docker compose -f $COMPOSE_FILE --env-file $ENV_FILE build --no-cache"
ok "Image construite."

step "C2 — Démarrage du stack LAB"

confirm "Démarrer les containers LAB (app + db + mail) ?"

run "docker compose -f $COMPOSE_FILE --env-file $ENV_FILE up -d"

# Attendre que les containers soient prêts
info "Attente du démarrage des containers..."
sleep 5

# Vérifier que les containers tournent
for container in "$LAB_APP_CONTAINER" "$LAB_DB_CONTAINER" "$LAB_MAIL_CONTAINER"; do
  STATUS=$(docker inspect --format='{{.State.Status}}' "$container" 2>/dev/null || echo "absent")
  if [ "$STATUS" != "running" ]; then
    warn "Container $container : $STATUS"
    docker logs "$container" --tail=20 2>&1 | tee -a "$LOG_FILE" || true
    fail "Le container $container n'est pas en cours d'exécution."
  fi
  ok "Container $container : running"
done

# ---------------------------------------------------------------------------
# Restauration de la base (si pas --skip-db)
# ---------------------------------------------------------------------------
if [ "$SKIP_DB" = false ]; then
  step "C2b — Restauration de la base dans le LAB"

  info "Attente que PostgreSQL LAB soit prêt..."
  for i in $(seq 1 20); do
    if docker exec "$LAB_DB_CONTAINER" pg_isready -U "$LAB_DB_USER" &>/dev/null; then
      ok "PostgreSQL LAB prêt (tentative $i)"
      break
    fi
    sleep 2
    [ "$i" -eq 20 ] && fail "PostgreSQL LAB n'a pas démarré dans les délais."
  done

  run "docker exec $LAB_DB_CONTAINER psql -U postgres \
    -c \"CREATE USER $LAB_DB_USER WITH PASSWORD '$LAB_DB_PASS';\" || true"
  run "docker exec $LAB_DB_CONTAINER psql -U postgres \
    -c \"CREATE DATABASE $LAB_DB_NAME OWNER $LAB_DB_USER;\" || true"

  # Copier les dumps
  run "docker cp $BACKUP_DIR/lab_schema_only.sql $LAB_DB_CONTAINER:/tmp/"
  run "docker cp $BACKUP_DIR/lab_data_partial.sql $LAB_DB_CONTAINER:/tmp/"
  run "docker cp /tmp/lab_anonymize.sql $LAB_DB_CONTAINER:/tmp/"

  # Copier et appliquer les migrations
  run "docker cp $LAB_DIR/migration_merchants.sql $LAB_DB_CONTAINER:/tmp/"
  run "docker cp $LAB_DIR/migration_merchants_extra.sql $LAB_DB_CONTAINER:/tmp/"

  run "docker exec $LAB_DB_CONTAINER psql -U $LAB_DB_USER -d $LAB_DB_NAME -f /tmp/lab_schema_only.sql"
  run "docker exec $LAB_DB_CONTAINER psql -U $LAB_DB_USER -d $LAB_DB_NAME -f /tmp/migration_merchants.sql"
  run "docker exec $LAB_DB_CONTAINER psql -U $LAB_DB_USER -d $LAB_DB_NAME -f /tmp/migration_merchants_extra.sql"
  run "docker exec $LAB_DB_CONTAINER psql -U $LAB_DB_USER -d $LAB_DB_NAME -f /tmp/lab_data_partial.sql"
  run "docker exec $LAB_DB_CONTAINER psql -U $LAB_DB_USER -d $LAB_DB_NAME -f /tmp/lab_anonymize.sql"

  ok "Base LAB restaurée et anonymisée."
fi

# =============================================================================
# ÉTAPE D — CONTRÔLES D'ISOLATION POST-DÉMARRAGE
# =============================================================================
section_header "ÉTAPE D — Contrôles d'isolation"

step "D1 — Vérification des réseaux"

LAB_NETWORKS=$(docker inspect "$LAB_APP_CONTAINER" --format='{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' 2>/dev/null || echo "")
info "Réseaux du container LAB : $LAB_NETWORKS"

if echo "$LAB_NETWORKS" | grep -q 'smt-network'; then
  fail "DANGER : le container LAB est connecté au réseau de production (smt-network)."
fi
ok "Isolation réseau : OK — aucune connexion au réseau smt-network"

step "D2 — Vérification que la production est intacte"

PROD_STATUS=$(docker inspect --format='{{.State.Status}}' smt-cockpit-app 2>/dev/null || echo "absent")
info "Container de production smt-cockpit-app : $PROD_STATUS"
if [ "$PROD_STATUS" != "running" ]; then
  warn "Le container de production ne semble pas actif. Vérifiez manuellement."
else
  ok "Production : container smt-cockpit-app toujours en cours d'exécution"
fi

step "D3 — Vérification des logs LAB"

info "Derniers logs du container LAB :"
docker logs "$LAB_APP_CONTAINER" --tail=20 2>&1 | tee -a "$LOG_FILE" || true

# Chercher des tentatives de connexion vers la prod dans les logs
PROD_LEAK=$(docker logs "$LAB_APP_CONTAINER" 2>&1 | grep -iE 'oracle.*prod|prod.*oracle' || true)
if [ -n "$PROD_LEAK" ]; then
  warn "Des traces de connexion vers Oracle PROD ont été détectées dans les logs LAB :"
  echo "$PROD_LEAK"
  warn "Vérifiez que les variables ORACLE_PROD_* sont absentes du .env.lab"
fi

step "D4 — Test HTTP du frontend LAB"

sleep 3
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$LAB_APP_PORT" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "302" ]; then
  ok "Frontend LAB : HTTP $HTTP_CODE — accessible sur http://$(hostname):$LAB_APP_PORT"
else
  warn "Frontend LAB : HTTP $HTTP_CODE — vérifiez les logs du container"
fi

ok "Interface Mailhog : http://$(hostname):$LAB_MAIL_PORT"

# =============================================================================
# RÉSUMÉ FINAL
# =============================================================================
section_header "RÉSUMÉ"

echo -e "${BOLD}${GREEN}"
cat << EOF
  ✔  Cockpit LAB démarré avec succès

  Application  : http://$(hostname):$LAB_APP_PORT
  Mailhog (UI) : http://$(hostname):$LAB_MAIL_PORT
  PostgreSQL   : localhost:$LAB_DB_PORT (debug uniquement)

  Comptes de test (si restauration effectuée) :
    admin@lab.local     — rôle admin
    operateur@lab.local — rôle opérateur
    lecteur@lab.local   — rôle lecteur

  Pour arrêter le LAB :
    docker compose -f $COMPOSE_FILE down

  Pour supprimer complètement le LAB (rollback) :
    docker compose -f $COMPOSE_FILE down -v
    rm -rf $LAB_DIR

  Journal complet : $LOG_FILE
EOF
echo -e "${RESET}"
