#!/usr/bin/env bash

set -Eeuo pipefail

SOURCE_DIR="/opt/peeper-source"
PRODUCTION_ROOT="/var/www/peeper.frenzyradio.online"
PRODUCTION_BACKEND="$PRODUCTION_ROOT/backend"
DEPLOY_BACKUP_DIR="/var/backups/peeper-deploy"
DEPLOY_MARKER="$PRODUCTION_ROOT/DEPLOYED_GIT_COMMIT"
LOCK_FILE="/var/lock/peeper-deploy.lock"
BRANCH="main"

force_deploy=false
if [[ "${1:-}" == "--force" ]]; then
    force_deploy=true
elif [[ -n "${1:-}" ]]; then
    echo "Usage: peeper-deploy [--force]" >&2
    exit 2
fi

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    echo "Another Peeper deployment is already running." >&2
    exit 1
fi

if [[ ! -d "$SOURCE_DIR/.git" ]]; then
    echo "Git checkout is missing at $SOURCE_DIR." >&2
    exit 1
fi

if [[ ! -f "$PRODUCTION_BACKEND/peeper.db" ]]; then
    echo "Production database is missing at $PRODUCTION_BACKEND/peeper.db." >&2
    exit 1
fi

cd "$SOURCE_DIR"
if [[ -n "$(git status --porcelain)" ]]; then
    echo "The deployment checkout is dirty; refusing to overwrite it." >&2
    git status --short >&2
    exit 1
fi

git fetch origin "$BRANCH"
target_commit="$(git rev-parse "origin/$BRANCH")"
deployed_commit="$(cat "$DEPLOY_MARKER" 2>/dev/null || true)"

if [[ "$force_deploy" == false && "$deployed_commit" == "$target_commit" ]]; then
    echo "Production is already on $target_commit."
    exit 0
fi

mkdir -p "$DEPLOY_BACKUP_DIR"
timestamp="$(date +%Y%m%d-%H%M%S)"
backup_path="$DEPLOY_BACKUP_DIR/peeper-before-${target_commit:0:12}-$timestamp.db"

echo "Creating production database backup..."
cd "$PRODUCTION_BACKEND"
node -e '
const Database = require("better-sqlite3");
const source = new Database("peeper.db", { readonly: true });
source.backup(process.argv[1])
  .then(() => {
    source.close();
    console.log(`Backup ready: ${process.argv[1]}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
' "$backup_path"

cd "$SOURCE_DIR"
git pull --ff-only origin "$BRANCH"

echo "Deploying Git commit $target_commit..."
bash deploy.sh

sleep 3
pm2_pid="$(pm2 pid peeper-backend | tail -n 1 | tr -d '[:space:]')"
if [[ ! "$pm2_pid" =~ ^[1-9][0-9]*$ ]]; then
    echo "PM2 health check failed." >&2
    exit 1
fi

curl -fsS -o /dev/null https://peeper.frenzyradio.online/
api_status="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:4000/api/game/state)"
if [[ "$api_status" != "401" ]]; then
    echo "Backend health check returned HTTP $api_status instead of 401." >&2
    exit 1
fi

printf '%s\n' "$target_commit" > "$DEPLOY_MARKER"

# Cron backups live elsewhere and are never touched. Keep only the newest
# successful pre-deploy restore point in this dedicated directory.
find "$DEPLOY_BACKUP_DIR" -maxdepth 1 -type f -name 'peeper-before-*.db' \
    ! -path "$backup_path" -delete

echo "Deployment complete: $target_commit"
echo "Rollback backup retained: $backup_path"
