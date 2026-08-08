# Synology deployment

This deployment uses the existing MariaDB service at `192.168.68.100:3306`. The Compose project does not contain MySQL or MariaDB and will never create a second database server.

Redis remains part of the application stack because Sprint 1 actively uses it for authenticated sessions, BullMQ jobs, scheduled public-IP observations, caching, rate limits, and synchronization locks. Redis is isolated on the Compose network and does not publish a host port.

## Prerequisites

- Synology Container Manager with Docker Compose support
- MariaDB 10.x listening on `192.168.68.100:3306`
- Existing database `infrahub`
- Existing database user `infrahub_app`
- The database user is allowed to connect from Synology containers
- The database user can create and alter tables, indexes, and foreign keys in `infrahub`

Prisma uses its official MariaDB driver adapter and the `mysql` schema provider. The schema and migrations avoid MySQL-only extensions and are compatible with MariaDB 10.x; MariaDB 10.11 LTS is the preferred target.

## 1. Prepare the project

Place the repository in a persistent shared folder, for example:

```text
/volume1/docker/infrastructure-hub
```

Copy the environment template:

```sh
cp .env.example .env
```

The `.env` file is excluded from Git. Do not add it to source control or paste its contents into issue reports.

## 2. Configure `.env`

Set the existing MariaDB connection:

```dotenv
DATABASE_URL=mysql://infrahub_app:<URL_ENCODED_PASSWORD>@192.168.68.100:3306/infrahub
```

Replace `<URL_ENCODED_PASSWORD>` only in `.env`. Percent-encode reserved URL characters in the password, including `@`, `:`, `/`, `?`, `#`, and `%`.

Also replace these values:

```dotenv
REDIS_PASSWORD=<LONG_RANDOM_REDIS_PASSWORD>
REDIS_URL=redis://:<LONG_RANDOM_REDIS_PASSWORD>@redis:6379
APP_ENCRYPTION_KEY=<BASE64_ENCODED_32_BYTE_KEY>
ADMIN_EMAIL=<ADMIN_EMAIL>
ADMIN_PASSWORD=<UNIQUE_PASSWORD_WITH_AT_LEAST_12_CHARACTERS>
ALLOWED_ORIGINS=http://192.168.68.100:8080
```

Generate the encryption key on a trusted machine:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Back up `APP_ENCRYPTION_KEY` securely. Provider tokens in MariaDB cannot be recovered without it.

If the dashboard is exposed through HTTPS or a reverse proxy, set `ALLOWED_ORIGINS` to the exact public origin and set `COOKIE_SECURE=true`.

## 3. Start the project

From SSH:

```sh
docker compose build
docker compose up -d
```

Or create a Container Manager project using `compose.yaml` from the project folder and deploy it.

Startup order is automatic:

1. Images build without contacting MariaDB. Prisma Client generation uses a build-scoped placeholder URL containing no production credentials.
2. Redis becomes healthy.
3. The API receives the real `DATABASE_URL` from `.env` at runtime and waits for MariaDB connectivity.
4. Prisma applies pending migrations to `infrahub`.
5. The API creates the first administrator only when no administrator exists.
6. The API becomes healthy.
7. The worker and web dashboard start.

Open:

```text
http://192.168.68.100:8080
```

Sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`. The application requires replacing the bootstrap password before other modules can be used.

## Operations

View status:

```sh
docker compose ps
docker compose logs -f api worker
```

Update:

```sh
git pull
docker compose build
docker compose up -d
```

Stop without deleting Redis data:

```sh
docker compose down
```

The application database remains in the existing Synology MariaDB service. Include the `infrahub` database, `.env`, and encryption key in the NAS backup plan.

## Troubleshooting

- `Access denied`: verify the password, URL encoding, and MariaDB host permissions for `infrahub_app`.
- `Connection refused`: confirm MariaDB listens on the NAS LAN address rather than only `127.0.0.1`.
- Migration permission errors: grant `infrahub_app` schema-level DDL privileges on `infrahub`.
- Origin rejected: make `ALLOWED_ORIGINS` exactly match the browser URL, including scheme and port.
- API remains unhealthy: inspect `docker compose logs api`; the startup script retries MariaDB connectivity and migrations before exiting.
