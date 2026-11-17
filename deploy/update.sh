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

# Find Node.js: the app's environment from "Setup Node.js App" (CloudLinux), or cPanel's
# EasyApache Node.js used by "Application Manager", or whatever node is already on PATH.
ACTIVATE="$(ls -d "$HOME/nodevenv/$REL"/*/bin/activate 2>/dev/null | sort -V | tail -n 1 || true)"
EA_NODE="$(ls -d /opt/cpanel/ea-nodejs*/bin 2>/dev/null | sort -V | tail -n 1 || true)"
if [ -n "$ACTIVATE" ]; then
  # shellcheck disable=SC1090
  set +u; source "$ACTIVATE"; set -u
  echo "==> Using $(node -v) from Setup Node.js App"
elif [ -n "$EA_NODE" ]; then
  export PATH="$EA_NODE:$PATH"
  echo "==> Using $(node -v) from $EA_NODE"
elif command -v npm >/dev/null 2>&1; then
  echo "==> Using $(node -v) from PATH"
else
  echo "!!  Node.js not found. Create the app in cPanel (Setup Node.js App or Application Manager)"
  echo "    with application root $REL and startup file app.js, then run this script again."
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
