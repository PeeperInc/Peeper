#!/bin/bash
# ============================================================
# PEEPER — Full Deployment Script
# Run from your LOCAL machine or directly on the VDS
# Usage: bash deploy.sh
# ============================================================

set -e

DOMAIN="peeper.frenzyradio.online"
WEB_ROOT="/var/www/${DOMAIN}/html"
BACKEND_DIR="/var/www/${DOMAIN}/backend"

echo "🐸 Deploying Peeper..."

# ── 1. Build frontend ─────────────────────────────────────────────────────────
echo "📦 Building React frontend..."
cd frontend
npm install
npm run build
cd ..

# ── 2. Deploy frontend ────────────────────────────────────────────────────────
echo "📁 Copying frontend to ${WEB_ROOT}..."
sudo mkdir -p "${WEB_ROOT}"
# Remove only frontend build assets — preserve uploaded runtime content
# such as clothing sprites, gifts, personal-home decor, and avatars.
sudo find "${WEB_ROOT}" -maxdepth 1 -mindepth 1 \
    ! -name 'sprites' ! -name 'gifts' ! -name 'home' ! -name 'avatars' ! -name 'profile' \
    -exec rm -rf {} +
sudo cp -r frontend/dist/* "${WEB_ROOT}/"

# Keep admin-uploaded profile art and install bundled starter frames/scenes.
if [ -d "html/profile" ]; then
    sudo mkdir -p "${WEB_ROOT}/profile"
    sudo cp -r html/profile/* "${WEB_ROOT}/profile/"
fi

# ── 3. Deploy backend ─────────────────────────────────────────────────────────
echo "🖥  Deploying backend to ${BACKEND_DIR}..."
sudo mkdir -p "${BACKEND_DIR}"

# Copy all backend files except node_modules and .env
sudo rsync -av --exclude='node_modules' --exclude='.env' --exclude='peeper.db' \
    backend/ "${BACKEND_DIR}/"

# Install production deps on server
cd "${BACKEND_DIR}"
sudo npm install --production
cd -

# ── 4. Environment file ───────────────────────────────────────────────────────
echo ""
echo "⚠️  Make sure ${BACKEND_DIR}/.env exists with your BOT_TOKEN!"
echo "   Example: BOT_TOKEN=123456789:AAAA... NODE_ENV=production PORT=4000"
echo ""
if [ ! -f "${BACKEND_DIR}/.env" ]; then
    echo "Creating empty .env — FILL IT IN BEFORE STARTING:"
    sudo bash -c "echo 'BOT_TOKEN=YOUR_TOKEN_HERE\nPORT=4000\nNODE_ENV=production' > ${BACKEND_DIR}/.env"
fi

# ── 5. PM2 / process management ──────────────────────────────────────────────
echo "🔄 (Re)starting backend with PM2..."
sudo mkdir -p /var/log/peeper
sudo cp ecosystem.config.js "${BACKEND_DIR}/"

cd "${BACKEND_DIR}"
if pm2 list | grep -q "peeper-backend"; then
    pm2 restart peeper-backend
else
    pm2 start ecosystem.config.js
    pm2 save
fi
cd -

# ── 6. Nginx ─────────────────────────────────────────────────────────────────
echo "🌐 Reloading nginx..."
sudo nginx -t

if [ -s /run/nginx.pid ] && pgrep -x nginx >/dev/null 2>&1; then
    sudo nginx -s reload || sudo systemctl restart nginx || sudo service nginx restart
else
    echo "nginx is not running cleanly — starting it instead of reloading..."
    sudo systemctl restart nginx || sudo service nginx restart || sudo nginx
fi

echo ""
echo "✅ Deployment complete!"
echo "   Frontend: https://${DOMAIN}"
echo "   Backend:  http://localhost:4000"
echo ""
echo "📋 Next steps:"
echo "   1. Set BOT_TOKEN in ${BACKEND_DIR}/.env"
echo "   2. In BotFather: /newapp → use https://${DOMAIN}"
echo "   3. Make sure SSL cert exists: sudo certbot --nginx -d ${DOMAIN}"
