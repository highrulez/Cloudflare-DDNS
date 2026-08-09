# Synology DSM deployment

## Container Manager project

1. Place the repository in a shared folder, for example
   `/volume1/docker/cloudflare-ddns-manager`.
2. Copy `.env.example` to `.env` and replace every placeholder.
3. Set `DATABASE_URL` to the existing Synology MariaDB 10 database. Use the NAS LAN address rather
   than `localhost`; Synology MariaDB 10 commonly uses TCP port `3307`.
4. In Container Manager, create a Project from the repository directory and select `compose.yaml`.
5. Build and start the project.
6. Open `http://NAS-IP:8090`.

The project creates exactly one container:

- `app`: React dashboard, Fastify API, DDNS scheduler, and application schema migrations

It does not deploy or manage a MariaDB container, volume, database, or database user.

## Existing MariaDB prerequisites

Before starting the application:

- Create the application database and non-root database user using your existing administration
  process.
- Allow that user to connect from the Docker network and manage tables in only that database.
- Ensure MariaDB listens on a TCP interface reachable from containers.
- Permit the configured MariaDB port through DSM Firewall if necessary.
- URL-encode reserved characters in the password embedded in `DATABASE_URL`.

For example:

```dotenv
DATABASE_URL=mysql://cloudflare_ddns:encoded-password@192.168.1.10:3307/cloudflare_ddns
```

Do not use `127.0.0.1` or `localhost`: inside the container those addresses refer to the application
container, not the Synology host.

## Startup order

1. The existing Synology MariaDB service must already be running.
2. The app checks connectivity using `DATABASE_URL`.
3. Prisma applies pending application-table migrations to the selected existing database.
4. Fastify starts the scheduler and API.
5. `/api/health` becomes healthy.

The startup process does not create the MariaDB server, database, or user.

## Reverse proxy and HTTPS

When using Synology Login Portal or another reverse proxy:

- Forward the public host to `http://127.0.0.1:8090`.
- Set `APP_ORIGIN` to the exact HTTPS URL.
- Set `COOKIE_SECURE=true`.
- Preserve `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto`.

## Operations

```sh
docker compose ps
docker compose logs -f app
docker compose restart app
```

Stopping or removing this Compose project affects only the application container. Native Synology
MariaDB continues running.

## Backup

Back up the existing MariaDB database through your normal Synology database backup process, and
back up `.env`. Test restoration periodically. The encryption and session secrets are required
alongside the database.
