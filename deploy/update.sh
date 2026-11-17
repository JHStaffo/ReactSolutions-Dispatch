#!/usr/bin/env bash
# Updates this cPanel Node.js app from the `release` branch and restarts it.
# Run from anywhere:  ~/reactsolutions-dispatch/update.sh
# Your data (DATA_DIR) and environment variables are not touched.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"
REL="${APP_DIR#"$HOME"/}"

echo "==> Pulling latest release"
before="$(git rev-parse --short HEAD)"
git pull --ff-only --quiet
after="$(git rev-parse --short HEAD)"
if [ "$before" = "$after" ]; then echo "    Already up to date ($after)"; else echo "    $before -> $after"; fi

# Use the Node.js version selected in cPanel "Setup Node.js App" (its virtual environment).
ACTIVATE="$(ls -d "$HOME/nodevenv/$REL"/*/bin/activate 2>/dev/null | sort -V | tail -n 1 || true)"
if [ -n "$ACTIVATE" ]; then
  # shellcheck disable=SC1090
  set +u; source "$ACTIVATE"; set -u
  echo "==> Using $(node -v) from $(dirname "$(dirname "$ACTIVATE")")"
else
  echo "!!  No Node.js app found for $REL."
  echo "    Create it first in cPanel > Setup Node.js App (Application root: $REL, startup file: app.js),"
  echo "    then run this script again."
  exit 1
fi

echo "==> Installing runtime dependencies"
npm install --omit=dev --no-audit --no-fund --loglevel=error

echo "==> Restarting"
mkdir -p tmp
touch tmp/restart.txt
if command -v cloudlinux-selector >/dev/null 2>&1; then
  cloudlinux-selector restart --json --interpreter nodejs --app-root "$REL" >/dev/null 2>&1 || true
fi

echo "==> Done. Running $(cat RELEASE.txt | head -n 1)"
