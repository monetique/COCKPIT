#!/bin/bash
# ============================================================
#  SMT COCKPIT v2 — Gestion Docker
#  Usage : ./deploy.sh [commande]
# ============================================================

set -e

# ── Couleurs ──────────────────────────────────────────────
G='\033[0;32m'; Y='\033[1;33m'; C='\033[0;36m'; R='\033[0;31m'; N='\033[0m'
ok()   { echo -e "${G}[OK]${N} $1"; }
info() { echo -e "${C}[>>]${N} $1"; }
warn() { echo -e "${Y}[!!]${N} $1"; }
err()  { echo -e "${R}[ERR]${N} $1"; exit 1; }

APP="smt-cockpit-app"
DB="smt-cockpit-db"
IMG="smt-cockpit:latest"

header() {
  echo ""
  echo -e "${C}======================================================${N}"
  echo -e "${C}  SMT COCKPIT v2 — $1${N}"
  echo -e "${C}======================================================${N}"
  echo ""
}

# ── Vérifications préalables ──────────────────────────────
check_deps() {
  command -v docker &>/dev/null || err "Docker non installe"
  docker compose version &>/dev/null 2>&1 || command -v docker-compose &>/dev/null || err "docker compose non disponible"
  [ -f ".env" ] || err "Fichier .env manquant — copiez .env.example vers .env et configurez-le"
}

dc() {
  if command -v docker-compose &>/dev/null; then
    docker-compose "$@"
  elif docker compose version &>/dev/null 2>&1; then
    docker compose "$@"
  else
    err "docker compose non disponible"
  fi
}

# ============================================================
#  build-frontend — Builder le frontend React
#  Utilise Node.js local si dispo, sinon un container Docker
# ============================================================
cmd_build_frontend() {
  info "Build du frontend React..."

  if [ ! -d "frontend" ]; then
    warn "Répertoire frontend/ introuvable — ignoré"
    return 0
  fi

  # Si frontend/dist déjà buildé et récent (< 1 heure), skip
  if [ -d "frontend/dist" ] && [ -n "$(find frontend/dist -name '*.js' -newer frontend/src/main.jsx 2>/dev/null | head -1)" ]; then
    ok "Frontend déjà à jour — skip"
    return 0
  fi

  # Méthode 1 : Node.js installé localement
  if command -v node &>/dev/null && command -v npm &>/dev/null; then
    info "  Utilisation de Node.js local ($(node -v))"
    cd frontend
    [ ! -d "node_modules" ] && npm install --legacy-peer-deps
    npm run build
    cd ..
    ok "Frontend buildé → frontend/dist/"
    return 0
  fi

  # Méthode 2 : Via un container Docker temporaire
  info "  Node.js non trouvé localement — build via Docker..."
  docker run --rm \
    -v "$(pwd)/frontend:/app" \
    -w /app \
    node:20-alpine \
    sh -c "npm install --legacy-peer-deps && npm run build" \
    || err "Build frontend échoué"

  ok "Frontend buildé → frontend/dist/"
}

# ============================================================
#  start — Démarrer les containers
# ============================================================
cmd_start() {
  header "Démarrage"
  check_deps

  # Builder le frontend si dist/ absent
  if [ ! -d "frontend/dist" ] || [ -z "$(ls -A frontend/dist 2>/dev/null)" ]; then
    warn "frontend/dist/ absent — build nécessaire"
    cmd_build_frontend
  fi

  info "Démarrage des containers..."
  dc up -d
  echo ""
  ok "Containers démarrés"
  cmd_status
}

# ============================================================
#  stop — Arrêter les containers
# ============================================================
cmd_stop() {
  header "Arrêt"
  info "Arrêt des containers..."
  dc stop
  ok "Containers arrêtés (données conservées)"
}

# ============================================================
#  restart — Redémarrer sans rebuild
# ============================================================
cmd_restart() {
  header "Redémarrage"
  info "Redémarrage de l'application..."
  dc restart app
  ok "Application redémarrée"
  sleep 2
  cmd_status
}

# ============================================================
#  update — Mettre à jour (rebuild + restart)
# ============================================================
cmd_update() {
  header "Mise à jour"
  check_deps

  info "Étape 1/5 — Build du frontend React..."
  cmd_build_frontend

  info "Étape 2/5 — Arrêt de l'application..."
  dc stop app

  info "Étape 3/5 — Rebuild de l'image Docker..."
  dc build --no-cache app
  ok "Image reconstruite"

  info "Étape 4/5 — Migration base de données (si nécessaire)..."
  # Exécuter les migrations SQL en attente
  for migration in migration_*.sql; do
    [ -f "$migration" ] || continue
    info "  Migration : $migration"
    dc exec -T postgres psql \
      -U "${PG_USER:-postgres}" \
      -d "${PG_DATABASE:-clictopay_db}" \
      -f "/tmp/$migration" 2>/dev/null || {
      # Copier d'abord le fichier dans le container
      docker cp "$migration" "$DB:/tmp/$migration" 2>/dev/null
      dc exec -T postgres psql \
        -U "${PG_USER:-postgres}" \
        -d "${PG_DATABASE:-clictopay_db}" \
        -f "/tmp/$migration" 2>/dev/null || warn "Migration $migration : vérifiez si déjà appliquée"
    }
  done

  info "Étape 5/5 — Démarrage de la nouvelle version..."
  dc up -d app
  ok "Mise à jour terminée"

  sleep 3
  cmd_status
}

# ============================================================
#  deploy — Premier déploiement complet
# ============================================================
cmd_deploy() {
  header "Premier déploiement"
  check_deps

  info "Étape 1/5 — Build du frontend React..."
  cmd_build_frontend

  info "Étape 2/5 — Build de l'image Docker..."
  dc build --no-cache
  ok "Image construite"

  info "Étape 3/5 — Démarrage PostgreSQL..."
  dc up -d postgres
  info "  Attente démarrage PostgreSQL (30s max)..."
  sleep 5
  for i in $(seq 1 6); do
    dc exec -T postgres pg_isready -U "${PG_USER:-postgres}" &>/dev/null && break
    sleep 5
  done
  ok "PostgreSQL prêt"

  info "Étape 3/5 — Initialisation du schéma..."
  # Le schema.sql est monté et exécuté automatiquement par postgres
  # Attendre que l'init soit terminée
  sleep 5
  ok "Schéma initialisé"

  info "Étape 4/5 — Application des migrations..."
  for migration in migration_*.sql; do
    [ -f "$migration" ] || continue
    info "  $migration..."
    docker cp "$migration" "$DB:/tmp/$migration" 2>/dev/null || true
    dc exec -T postgres psql \
      -U "${PG_USER:-postgres}" \
      -d "${PG_DATABASE:-clictopay_db}" \
      -f "/tmp/$migration" 2>/dev/null || warn "  Déjà appliquée : $migration"
  done
  ok "Migrations appliquées"

  info "Étape 5/5 — Démarrage de l'application..."
  dc up -d
  ok "Application démarrée"

  sleep 3
  cmd_status

  echo ""
  warn "N'oubliez pas de créer le premier utilisateur admin :"
  echo "  ./deploy.sh create-admin"
}

# ============================================================
#  status — État des containers
# ============================================================
cmd_status() {
  echo ""
  echo -e "${C}  État des services :${N}"
  echo "  ─────────────────────────────────────────────"

  # App
  APP_STATUS=$(docker inspect --format='{{.State.Status}}' "$APP" 2>/dev/null || echo "absent")
  APP_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' "$APP" 2>/dev/null || echo "")
  APP_PORT=$(docker port "$APP" 3000 2>/dev/null | head -1 || echo "—")
  if [ "$APP_STATUS" = "running" ]; then
    STATUS_COLOR=$G
  else
    STATUS_COLOR=$R
  fi
  printf "  %-20s ${STATUS_COLOR}%-12s${N} %s\n" "Application" "$APP_STATUS" "$APP_PORT"
  [ -n "$APP_HEALTH" ] && printf "  %-20s %-12s\n" "  Health" "$APP_HEALTH"

  # DB
  DB_STATUS=$(docker inspect --format='{{.State.Status}}' "$DB" 2>/dev/null || echo "absent")
  DB_PORT=$(docker port "$DB" 5432 2>/dev/null | head -1 || echo "—")
  if [ "$DB_STATUS" = "running" ]; then
    STATUS_COLOR=$G
  else
    STATUS_COLOR=$R
  fi
  printf "  %-20s ${STATUS_COLOR}%-12s${N} %s\n" "PostgreSQL" "$DB_STATUS" "$DB_PORT"

  echo "  ─────────────────────────────────────────────"

  # URL d'accès
  if [ "$APP_STATUS" = "running" ]; then
    PORT=$(docker port "$APP" 3000 2>/dev/null | grep -oP ':\K\d+' | head -1 || echo "3000")
    IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")
    echo ""
    ok "Application accessible :"
    echo "  Local   : http://localhost:$PORT"
    echo "  Réseau  : http://$IP:$PORT"
    echo "  Health  : http://localhost:$PORT/api/health"
  fi
  echo ""
}

# ============================================================
#  logs — Afficher les logs en temps réel
# ============================================================
cmd_logs() {
  local service="${2:-app}"
  local lines="${3:-100}"
  header "Logs — $service"
  dc logs -f --tail="$lines" "$service"
}

# ============================================================
#  create-admin — Créer le premier utilisateur admin
# ============================================================
cmd_create_admin() {
  header "Création compte admin"
  read -p "  Email    : " ADMIN_EMAIL
  read -p "  Nom      : " ADMIN_NAME
  read -sp "  Mot de passe : " ADMIN_PASS; echo ""

  HASH=$(docker exec "$APP" node -e "
    const bcrypt = require('bcrypt');
    bcrypt.hash('$ADMIN_PASS', 12).then(h => console.log(h));
  " 2>/dev/null)

  [ -z "$HASH" ] && err "Impossible de hasher le mot de passe"

  docker exec "$DB" psql \
    -U "${PG_USER:-postgres}" \
    -d "${PG_DATABASE:-clictopay_db}" \
    -c "INSERT INTO users (nom, email, password_hash, role, actif)
        VALUES ('$ADMIN_NAME', '$ADMIN_EMAIL', '$HASH', 'admin', true)
        ON CONFLICT (email) DO UPDATE SET password_hash='$HASH', role='admin';" \
    2>/dev/null && ok "Admin créé : $ADMIN_EMAIL" || err "Erreur création admin"
}

# ============================================================
#  backup — Sauvegarder la base de données
# ============================================================
cmd_backup() {
  header "Sauvegarde PostgreSQL"
  mkdir -p ./backups
  STAMP=$(date +%Y%m%d_%H%M%S)
  BACKUP_FILE="./backups/smt_cockpit_backup_$STAMP.sql"

  info "Sauvegarde en cours → $BACKUP_FILE"
  docker exec "$DB" pg_dump \
    -U "${PG_USER:-postgres}" \
    "${PG_DATABASE:-clictopay_db}" \
    --no-owner --no-acl --clean \
    > "$BACKUP_FILE" 2>/dev/null

  gzip "$BACKUP_FILE"
  FINAL="${BACKUP_FILE}.gz"
  SIZE=$(du -sh "$FINAL" | cut -f1)
  ok "Sauvegarde créée : $FINAL ($SIZE)"
}

# ============================================================
#  restore — Restaurer une sauvegarde
# ============================================================
cmd_restore() {
  header "Restauration PostgreSQL"
  local backup_file="$2"
  [ -z "$backup_file" ] && {
    echo "  Sauvegardes disponibles :"
    ls -1t ./backups/*.sql.gz 2>/dev/null | head -10 | nl -w2 -s'. '
    echo ""
    read -p "  Fichier à restaurer : " backup_file
  }
  [ -f "$backup_file" ] || err "Fichier introuvable : $backup_file"

  warn "ATTENTION : Cette opération écrase la base actuelle !"
  read -p "  Confirmer ? [y/N] : " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || { info "Annulé"; exit 0; }

  info "Décompression et restauration..."
  if [[ "$backup_file" == *.gz ]]; then
    zcat "$backup_file" | docker exec -i "$DB" psql \
      -U "${PG_USER:-postgres}" -d "${PG_DATABASE:-clictopay_db}" 2>/dev/null
  else
    docker exec -i "$DB" psql \
      -U "${PG_USER:-postgres}" -d "${PG_DATABASE:-clictopay_db}" \
      < "$backup_file" 2>/dev/null
  fi
  ok "Restauration terminée"
}

# ============================================================
#  clean — Nettoyer les images/containers orphelins
# ============================================================
cmd_clean() {
  header "Nettoyage Docker"
  warn "Cela supprimera les images et containers non utilisés"
  read -p "  Continuer ? [y/N] : " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || exit 0

  docker system prune -f
  ok "Nettoyage terminé"
}

# ============================================================
#  destroy — Suppression complète (containers + volumes)
# ============================================================
cmd_destroy() {
  header "Suppression complète"
  warn "ATTENTION : Supprime les containers ET les données PostgreSQL !"
  read -p "  Tapez 'CONFIRMER' pour continuer : " confirm
  [ "$confirm" = "CONFIRMER" ] || { info "Annulé"; exit 0; }

  cmd_backup 2>/dev/null || warn "Sauvegarde échouée — continuez quand même"
  dc down -v --remove-orphans
  ok "Suppression complète terminée"
}

# ============================================================
#  help — Aide
# ============================================================
cmd_help() {
  echo ""
  echo -e "${C}  SMT COCKPIT v2 — Commandes Docker${N}"
  echo ""
  echo "  ./deploy.sh deploy        Premier déploiement complet"
  echo "  ./deploy.sh start         Démarrer les containers"
  echo "  ./deploy.sh stop          Arrêter les containers"
  echo "  ./deploy.sh restart       Redémarrer l'application"
  echo "  ./deploy.sh update        Mettre à jour (rebuild + restart)"
  echo "  ./deploy.sh status        État des services"
  echo "  ./deploy.sh logs          Logs en temps réel"
  echo "  ./deploy.sh create-admin  Créer un compte administrateur"
  echo "  ./deploy.sh backup        Sauvegarder la base de données"
  echo "  ./deploy.sh restore       Restaurer une sauvegarde"
  echo "  ./deploy.sh clean         Nettoyer Docker (images orphelines)"
  echo "  ./deploy.sh destroy       Supprimer tout (containers + données)"
  echo ""
  echo -e "${Y}  Workflow mise à jour :${N}"
  echo "  1. Copiez les fichiers modifiés dans le répertoire"
  echo "  2. ./deploy.sh update"
  echo ""
}

# ── Dispatch ──────────────────────────────────────────────
case "${1:-help}" in
  deploy)       cmd_deploy        ;;
  start)        cmd_start         ;;
  stop)         cmd_stop          ;;
  restart)      cmd_restart       ;;
  update)       cmd_update        ;;
  status)       cmd_status        ;;
  logs)         cmd_logs "$@"     ;;
  create-admin) cmd_create_admin  ;;
  backup)       cmd_backup        ;;
  restore)      cmd_restore "$@"  ;;
  clean)        cmd_clean         ;;
  destroy)      cmd_destroy       ;;
  *)            cmd_help          ;;
esac
