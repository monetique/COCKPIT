# ── Dockerfile — SMT COCKPIT v2 ──────────────────────────
# Build React inline — pas besoin de Node.js sur le serveur host

FROM node:20-alpine

LABEL maintainer="Monetique Tunisie"
LABEL description="SMT COCKPIT v2 — ClicToPay Monitoring Dashboard"

WORKDIR /app

# ── Dépendances système ───────────────────────────────────
RUN apk add --no-cache libaio libnsl libc6-compat python3 py3-pip make g++ \
    && pip3 install reportlab --break-system-packages --quiet

# ── Backend : dépendances ─────────────────────────────────
COPY package*.json ./
RUN npm install --only=production --legacy-peer-deps

# ── Frontend : dépendances ────────────────────────────────
COPY frontend/package*.json ./frontend/
RUN cd frontend && \
    npm install --legacy-peer-deps && \
    npm install vite@5.4.19 --save-dev --legacy-peer-deps && \
    chmod +x node_modules/.bin/vite node_modules/.bin/* 2>/dev/null || true

# ── Sources ───────────────────────────────────────────────
COPY server-v2.js   ./
COPY routes/        ./routes/
COPY middleware/    ./middleware/
COPY config/        ./config/
COPY db/            ./db/
COPY *.sql          ./
COPY CahierDesRecettes_TEMPLATE.xlsx ./
COPY Manuel_Integration_ClicToPay_v1.0.pdf ./
COPY frontend/      ./frontend/
COPY schedulers/    ./schedulers/
COPY scripts/       ./scripts/

# ── Build React ───────────────────────────────────────────
RUN cd frontend && npm run build

# ── Répertoires persistants ───────────────────────────────
RUN mkdir -p logs cahiers_outbox migration_exports

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "--max-old-space-size=512", "server-v2.js"]
