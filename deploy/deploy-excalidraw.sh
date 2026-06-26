#!/bin/bash
# Deploy excalidraw.saycraft.ai to tencent-us (same box as saycraft.ai).
#
#   Static Excalidraw build  → host nginx  (/www/wwwroot/excalidraw/web)
#   AI 美化 DeepSeek proxy    → docker      (127.0.0.1:8787)
#
# Usage (from repo root):
#   DEEPSEEK_API_KEY=sk-xxx bash deploy/deploy-excalidraw.sh
#
# Idempotent. The DeepSeek key is written ONLY to the server .env, never baked
# into an image or committed. DNS excalidraw.saycraft.ai → 43.162.82.43 must
# already resolve before the first run (needed for the Let's Encrypt cert).
set -euo pipefail

SERVER="tencent-us"
REMOTE_DIR="/www/wwwroot/excalidraw"
DOMAIN="excalidraw.saycraft.ai"
SSH_OPTS="-o ServerAliveInterval=30 -o ServerAliveCountMax=20 -o ConnectTimeout=10"

cd "$(dirname "$0")/.."

if [ -z "${DEEPSEEK_API_KEY:-}" ]; then
  echo "⚠️  DEEPSEEK_API_KEY not set — proxy will run in deterministic fallback mode (no DeepSeek)."
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Deploy ${DOMAIN}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1) Build static frontend locally ────────────────────────────────────────
echo "📦 Building static frontend..."
( cd excalidraw-app && yarn build:app:docker )
test -f excalidraw-app/build/index.html || { echo "❌ build missing"; exit 1; }

# ── 2) Sync artifacts ───────────────────────────────────────────────────────
echo "🚚 Syncing to ${SERVER}:${REMOTE_DIR}..."
ssh ${SSH_OPTS} "${SERVER}" "mkdir -p ${REMOTE_DIR}/web ${REMOTE_DIR}/beautify-proxy ${REMOTE_DIR}/deploy"
rsync -az --delete excalidraw-app/build/ "${SERVER}:${REMOTE_DIR}/web/"
rsync -az --delete beautify-proxy/ "${SERVER}:${REMOTE_DIR}/beautify-proxy/"
rsync -az deploy/docker-compose.excalidraw.yml "${SERVER}:${REMOTE_DIR}/docker-compose.excalidraw.yml"
rsync -az deploy/nginx.excalidraw.saycraft.ai.conf "${SERVER}:${REMOTE_DIR}/deploy/"

# server .env (key only on server, 0600)
ssh ${SSH_OPTS} "${SERVER}" "umask 077; cat > ${REMOTE_DIR}/.env" <<EOF
DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY:-}
DEEPSEEK_BASE_URL=${DEEPSEEK_BASE_URL:-https://api.deepseek.com}
DEEPSEEK_MODEL=${DEEPSEEK_MODEL:-deepseek-v4-flash}
ALLOWED_ORIGIN=${ALLOWED_ORIGIN:-https://${DOMAIN}}
RATE_LIMIT_PER_MIN=${RATE_LIMIT_PER_MIN:-20}
EOF

# ── 3) Build + start the proxy container ────────────────────────────────────
echo "🔨 Starting beautify-proxy container..."
ssh ${SSH_OPTS} "${SERVER}" "
  set -e
  cd ${REMOTE_DIR}
  docker compose -f docker-compose.excalidraw.yml --env-file .env up -d --build beautify-proxy
  for i in 1 2 3 4 5 6 7 8; do
    if curl -sf http://127.0.0.1:8787/health >/dev/null; then echo '✅ proxy healthy'; break; fi
    echo \"waiting for proxy... (\$i/8)\"; sleep 2
  done
  curl -sf http://127.0.0.1:8787/health >/dev/null || { echo '❌ proxy health failed'; docker logs --tail 30 excalidraw-beautify-proxy; exit 1; }
"

# ── 4) nginx vhost + TLS cert (idempotent) ──────────────────────────────────
echo "🔐 Ensuring nginx vhost + certificate for ${DOMAIN}..."
ssh ${SSH_OPTS} "${SERVER}" "bash -s" <<EOF
set -e
sudo mkdir -p /var/www/acme
# obtain cert if missing (webroot; does not touch other vhosts)
if [ ! -d /etc/letsencrypt/live/${DOMAIN} ]; then
  sudo certbot certonly --webroot -w /var/www/acme -d ${DOMAIN} \
    --non-interactive --agree-tos -m admin@saycraft.ai || {
      echo '❌ certbot failed — check DNS for ${DOMAIN} → 43.162.82.43'; exit 1; }
fi
# install vhost (host nginx sites-available/enabled layout)
if [ -d /etc/nginx/sites-available ]; then
  sudo cp ${REMOTE_DIR}/deploy/nginx.excalidraw.saycraft.ai.conf /etc/nginx/sites-available/${DOMAIN}.conf
  sudo ln -sf /etc/nginx/sites-available/${DOMAIN}.conf /etc/nginx/sites-enabled/${DOMAIN}.conf
else
  echo '⚠️  /etc/nginx/sites-available not found (宝塔?). Install the vhost manually:'
  echo "   ${REMOTE_DIR}/deploy/nginx.excalidraw.saycraft.ai.conf"
fi
sudo nginx -t && sudo nginx -s reload && echo '✅ nginx reloaded'
EOF

echo ""
echo "🌐 Done: https://${DOMAIN}"
echo "🔌 Proxy health: https://${DOMAIN}/beautify-api/health"
