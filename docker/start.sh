#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL must be provided}"

attempt=1
max_attempts="${DB_STARTUP_MAX_ATTEMPTS:-60}"
retry_seconds="${DB_STARTUP_RETRY_SECONDS:-2}"

while ! node /app/database/scripts/check-database.mjs; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "MariaDB connectivity failed after ${max_attempts} attempts" >&2
    exit 1
  fi
  echo "Waiting for MariaDB (${attempt}/${max_attempts})" >&2
  attempt=$((attempt + 1))
  sleep "$retry_seconds"
done

node /app/database/node_modules/prisma/build/index.js migrate deploy \
  --config /app/database/prisma.config.ts

exec node /app/dist/server.js
