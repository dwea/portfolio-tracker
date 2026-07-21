#!/bin/bash
# Restarts the PM2-managed portfolio-tracker server after a commit, but only when the
# commit touched code the long-running server.js process has already loaded into memory.
#
# Why: server.js runs continuously under PM2 and imports src/db.ts (statically) and
# src/calculator.ts (dynamically, but still cached after first use) once at/near startup.
# Node never re-reads a module from disk once it's been imported, so editing those files
# has no effect on the running process until it restarts — it'll keep executing the old
# code, and since db.ts's sql.js keeps the whole database in memory and dumps it back to
# disk on every write, a stale process can silently revert on-disk data to an old state.
#
# Installed as .git/hooks/post-commit (see that file — it just calls this script).

RESTART_TRIGGERS='^(server\.js|src/db\.ts|src/calculator\.ts|src/rebalancer\.ts|src/types\.ts)$'
PM2_APP_NAME='portfolio-tracker'

cd "$(git rev-parse --show-toplevel)" || exit 0

changed=$(git diff-tree --no-commit-id --name-only -r HEAD)

if echo "$changed" | grep -qE "$RESTART_TRIGGERS"; then
  if command -v pm2 >/dev/null 2>&1 && pm2 describe "$PM2_APP_NAME" >/dev/null 2>&1; then
    echo "post-commit: server-loaded code changed — restarting $PM2_APP_NAME"
    pm2 restart "$PM2_APP_NAME" >/dev/null 2>&1
  fi
fi
