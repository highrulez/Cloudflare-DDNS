# Cloudflare DDNS Manager

A self-hosted Cloudflare Dynamic DNS dashboard for Synology DSM and Docker. It detects public
IPv4/IPv6 addresses, compares them with managed Cloudflare records, updates only changed records,
and records every result in MariaDB.

## Features

- First-run setup wizard; no JSON/YAML editing after deployment
- Multiple encrypted Cloudflare API-token accounts
- Zone and DNS-record discovery
- Managed A and AAAA records with enable/disable, check-now, and force-update controls
- Configurable 1–60 minute scheduler with restart recovery and overlap protection
- Public-IP provider fallback with strict public-address validation
- Per-record retries and failures; one bad record never stops the remaining run
- Dashboard health, scheduler state, recent activity, and paginated update history
- Local Argon2 administrator login with MariaDB-backed HttpOnly sessions
- Responsive React dashboard

## Requirements

- Synology DSM Container Manager or Docker Engine with Compose v2
- A Cloudflare API token
- Port `8090` available, or another value configured with `HOST_PORT`
- At least 512 MB free memory; 1 GB is recommended for the app and MariaDB

## Quick start

1. Clone or copy this repository to the NAS.
2. Create the environment file:

   ```sh
   cp .env.example .env
   ```

3. Set unique database passwords, `APP_ORIGIN`, `ENCRYPTION_KEY`, and `SESSION_SECRET`.

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

4. If the database password contains reserved URL characters, URL-encode it in `DATABASE_URL`.
5. Build and start:

   ```sh
   docker compose build
   docker compose up -d
   ```

6. Open `http://SYNOLOGY-IP:8090` and complete the setup wizard.

The database is internal-only and is not published on a host port.

## Environment variables

Important values:

- `HOST_PORT`: host-facing port, default `8090`
- `APP_PORT`: container port, default `3000`
- `APP_ORIGIN`: exact browser origin, such as `http://192.168.1.10:8090`
- `DATABASE_URL`: application MariaDB URL using hostname `db`
- `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_ROOT_PASSWORD`: MariaDB initialization
- `ENCRYPTION_KEY`: canonical base64 for exactly 32 random bytes; encrypts API tokens
- `SESSION_SECRET`: at least 32 random characters; protects opaque session-token hashes
- `COOKIE_SECURE`: set `true` when the dashboard is served over HTTPS
- `TZ`: defaults to `Asia/Kuala_Lumpur`

Never commit `.env`. Losing `ENCRYPTION_KEY` makes stored Cloudflare tokens unrecoverable.

## Cloudflare API token

Create a scoped API token in the Cloudflare dashboard. Grant:

- Zone → Zone → Read
- Zone → DNS → Edit

Restrict the token to only the zones this manager should control. The token is shown once by
Cloudflare. The application encrypts it with AES-256-GCM and subsequently returns only a masked
hint.

## First setup

The wizard creates the administrator, verifies and stores a Cloudflare token, discovers available
zones, adds the first managed A/AAAA record, and configures the scheduler. Setup endpoints close
after completion.

## Managing records

Use **DNS Records → Add DNS Record**. Select an account and discovered zone, enter the full
hostname, select A or AAAA, proxy mode, TTL, and automatic-DDNS state. Removing a managed record
does not remove the Cloudflare record. Cloudflare deletion is never implicit.

- **Check Now** detects the address and compares Cloudflare without forcing an update.
- **Update Now** updates an individual record only when needed.
- **Force Update** re-submits the detected address and requires confirmation.

Duplicate account/zone/hostname/type combinations are rejected.

## IPv6

IPv6 is disabled by default. Enable it only when the NAS has reliable public IPv6 connectivity.
AAAA records are skipped—not failed—when IPv6 is disabled or cannot be determined safely.

## Scheduler and retries

The scheduler runs inside the application and uses a MariaDB lease so runs cannot overlap. Settings
support 1, 2, 5, 10, 15, 30, and 60 minute intervals. Transient network, 429, and 5xx failures use
bounded 2/5/10-second retry delays. Authentication, permission, validation, and stable not-found
errors are not retried.

## Health

```sh
curl -fsS http://SYNOLOGY-IP:8090/api/health
```

The endpoint reports application, database, scheduler, latest check, and current public-IP state
without secrets. Docker uses the same endpoint.

## Backups

Back up:

- The Compose volume `cloudflare-ddns-manager_mariadb-data`
- `.env`, especially `ENCRYPTION_KEY` and `SESSION_SECRET`

Protect backups as secrets. A database dump without `ENCRYPTION_KEY` cannot decrypt API tokens.

## Upgrade

```sh
docker compose down
git pull
docker compose build --pull
docker compose up -d
docker compose logs -f app
```

The application waits for MariaDB and applies committed Prisma migrations before startup.

## Troubleshooting

- **Port unavailable:** change `HOST_PORT`; do not change `APP_PORT` unless necessary.
- **Origin rejected:** make `APP_ORIGIN` exactly match the browser scheme, host, and port.
- **Database access denied:** verify both MariaDB variables and the URL-encoded `DATABASE_URL`.
- **Token rejected:** confirm Bearer token permissions and zone-resource restrictions.
- **No zones:** the token needs Zone Read access for at least one zone.
- **Updates forbidden:** the token needs Zone DNS Edit for the selected zone.
- **IPv6 not detected:** confirm outbound IPv6 from the container, or leave IPv6 disabled.
- **Container unhealthy:** inspect `docker compose logs app db`.

## Development

```sh
corepack pnpm install
corepack pnpm db:generate
corepack pnpm dev
```

Quality gates:

```sh
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

Database timestamps are stored in UTC and displayed in `Asia/Kuala_Lumpur` by default.
