#!/bin/bash
set -u

APP_NAME="peeper-backend"
HEALTH_URL="http://127.0.0.1:4000/api/health"
LOG_FILE="/var/log/peeper/watchdog.log"
TIMEOUT_SECONDS=8

mkdir -p /var/log/peeper

timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

log() {
  echo "[$(timestamp)] $1" >> "$LOG_FILE"
}

PM2_BIN="$(command -v pm2 || true)"
CURL_BIN="$(command -v curl || true)"

if [ -z "$PM2_BIN" ]; then
  log "pm2 not found in PATH"
  exit 1
fi

if [ -z "$CURL_BIN" ]; then
  log "curl not found in PATH"
  exit 1
fi

HEALTH_RESPONSE="$($CURL_BIN -fsS --max-time "$TIMEOUT_SECONDS" "$HEALTH_URL" 2>/dev/null || true)"

if printf '%s' "$HEALTH_RESPONSE" | grep -q '"status":"ok"'; then
  exit 0
fi

log "health check failed, restarting $APP_NAME"
"$PM2_BIN" restart "$APP_NAME" >> "$LOG_FILE" 2>&1
sleep 5

HEALTH_RESPONSE="$($CURL_BIN -fsS --max-time "$TIMEOUT_SECONDS" "$HEALTH_URL" 2>/dev/null || true)"
if printf '%s' "$HEALTH_RESPONSE" | grep -q '"status":"ok"'; then
  log "restart successful"
  exit 0
fi

log "restart failed, service still unhealthy"
exit 1
