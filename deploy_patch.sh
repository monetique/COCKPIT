#!/bin/bash
# ============================================================
#  SMT COCKPIT v2 — Patch déploiement
#  Modifications : Dashboard, CLICTOPAY, PAYSMART, Merchants
#  Date : 22 Avril 2026
# ============================================================
set -e

COCKPIT=/data/applications/COCKPIT
CONTAINER=smt-cockpit-app

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║     SMT COCKPIT v2 — Déploiement du patch            ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── 1. Vérifier que le container tourne ─────────────────────
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "❌ Container ${CONTAINER} non trouvé. Arrêt."
  exit 1
fi
echo "✅ Container ${CONTAINER} actif"

# ── 2. Copier les fichiers backend modifiés ─────────────────
echo ""
echo "📁 Copie des fichiers backend…"

docker cp ${COCKPIT}/config/email-prise-en-charge.js  ${CONTAINER}:/app/config/
docker cp ${COCKPIT}/routes/v1-affiliates.js          ${CONTAINER}:/app/routes/
echo "   ✓ email-prise-en-charge.js"
echo "   ✓ v1-affiliates.js"

# ── 3. Rebuild frontend ─────────────────────────────────────
echo ""
echo "🔨 Build frontend React…"
cd ${COCKPIT}/frontend
npm run build 2>&1 | tail -5
echo "   ✓ Build terminé"

# ── 4. Rebuild image + restart ──────────────────────────────
echo ""
echo "🐳 Rebuild image Docker…"
cd ${COCKPIT}
docker compose build --no-cache app 2>&1 | tail -10
docker compose up -d app
echo "   ✓ Container redémarré"

# ── 5. Vérification santé ───────────────────────────────────
echo ""
echo "⏳ Attente démarrage (10s)…"
sleep 10

STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3005/api/health 2>/dev/null || echo "000")
if [ "$STATUS" = "200" ]; then
  echo "✅ API /health : OK (HTTP 200)"
else
  echo "⚠️  API /health : HTTP $STATUS — vérifiez les logs"
  docker logs ${CONTAINER} --tail=20
fi

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Patch déployé avec succès                           ║"
echo "║  URL : https://cockpit.monetiquetunisie.com          ║"
echo "╚══════════════════════════════════════════════════════╝"
