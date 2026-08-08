#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL must be provided at container runtime}"

attempt=1
max_attempts="${DB_STARTUP_MAX_ATTEMPTS:-60}"
retry_seconds="${DB_STARTUP_RETRY_SECONDS:-2}"

while ! node /app/packages/database/scripts/check-database.mjs; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "MariaDB connectivity failed after $max_attempts attempts" >&2
    exit 1
  fi
  echo "Retrying MariaDB connectivity in ${retry_seconds}s ($attempt/$max_attempts)" >&2
  attempt=$((attempt + 1))
  sleep "$retry_seconds"
done

if ! node /app/packages/database/node_modules/prisma/build/index.js migrate deploy \
  --config /app/packages/database/prisma.config.ts; then
  echo "Prisma migrate deploy failed after MariaDB connectivity succeeded. Check migration files and database privileges." >&2
  exit 1
fi

# API startup performs the idempotent first-admin bootstrap before listening.
exec node /app/apps/api/dist/server.js
