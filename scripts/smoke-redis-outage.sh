#!/bin/sh
set -eu

compose() {
  docker compose -f compose.smoke.yaml "$@"
}

cleanup() {
  compose down -v --remove-orphans
}
trap cleanup EXIT INT TERM

compose up -d --build mariadb redis api
compose run --rm --no-deps smoke
compose stop redis
compose run \
  --rm \
  --no-deps \
  -e AUTH_SMOKE_EXPECT_REDIS_FAILURE=true \
  -e AUTH_SMOKE_TIMEOUT_MS=10000 \
  smoke
