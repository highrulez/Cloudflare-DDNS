#!/bin/sh
set -eu

attempt=1
max_attempts="${DB_STARTUP_MAX_ATTEMPTS:-60}"
retry_seconds="${DB_STARTUP_RETRY_SECONDS:-2}"

until pnpm db:deploy; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "Database migration failed after $max_attempts attempts" >&2
    exit 1
  fi
  echo "MariaDB is not ready; retrying connectivity and migrations ($attempt/$max_attempts)" >&2
  attempt=$((attempt + 1))
  sleep "$retry_seconds"
done

# API startup performs the idempotent first-admin bootstrap before listening.
exec node apps/api/dist/server.js
