# Synology DSM deployment

## Container Manager project

1. Place the repository in a shared folder, for example
   `/volume1/docker/cloudflare-ddns-manager`.
2. Copy `.env.example` to `.env` and replace every placeholder.
3. In Container Manager, create a Project from the repository directory and select
   `compose.yaml`.
4. Build and start the project.
5. Open `http://NAS-IP:8090`.

The project creates two containers:

- `app`: React dashboard, Fastify API, scheduler, migrations
- `db`: MariaDB 10.11 with the persistent `mariadb-data` volume

MariaDB has no host port and is reachable only on the private Compose network.

## Startup order

1. MariaDB initializes and passes its official health check.
2. The app checks connectivity using the runtime `DATABASE_URL`.
3. Prisma applies pending migrations.
4. Fastify starts the scheduler and API.
5. `/api/health` becomes healthy.

## Reverse proxy and HTTPS

When using Synology Login Portal or another reverse proxy:

- Forward the public host to `http://127.0.0.1:8090`.
- Set `APP_ORIGIN` to the exact HTTPS URL.
- Set `COOKIE_SECURE=true`.
- Preserve `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto`.

## Operations

```sh
docker compose ps
docker compose logs -f app db
docker compose restart app
```

Use `docker compose down` without `-v` during routine maintenance. The `-v` option permanently
deletes MariaDB data.

## Backup

Back up the named MariaDB volume and `.env`. Test restoration periodically. The encryption and
session secrets are required alongside the database.
