#!/bin/sh
set -eu

attempt=1
max_attempts=30

until pnpm db:deploy; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "Database migration failed after $max_attempts attempts" >&2
    exit 1
  fi
  echo "Database is not ready; retrying migration ($attempt/$max_attempts)" >&2
  attempt=$((attempt + 1))
  sleep 2
done

exec node apps/api/dist/server.js
