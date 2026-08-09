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
- Authenticated System dashboard for Synology, Docker, MariaDB, Cloudflare, DDNS, proxy diagnostics,
  self-tests, and sanitized in-memory logs
- Local Argon2 administrator login with MariaDB-backed HttpOnly sessions
- Responsive React dashboard

## Requirements

- Synology DSM Container Manager or Docker Engine with Compose v2
- An existing Synology MariaDB 10 database and non-root application user reachable over TCP
- A Cloudflare API token
- Port `8090` available on the Synology host
- At least 512 MB free memory for the application container

## Quick start

1. Clone or copy this repository to the NAS.
2. Create the environment file:

   ```sh
   cp .env.example .env
   ```

3. Set `DATABASE_URL` for the existing Synology MariaDB database, plus `APP_ORIGIN`,
   `ENCRYPTION_KEY`, and `SESSION_SECRET`.

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

4. Preserve the verified native MariaDB address in `DATABASE_URL`. Host networking makes
   `127.0.0.1` refer to the Synology host, but do not change a working LAN-address connection until
   MariaDB TCP binding and user grants have been verified. Synology MariaDB 10 commonly uses port
   `3307`. URL-encode reserved characters in the database password.
5. Build and start:

   ```sh
   docker compose build
   docker compose up -d
   ```

6. Configure Synology Reverse Proxy for `https://dns.highrulez.com` to
   `http://127.0.0.1:8090`, then open the HTTPS URL and complete setup.

Compose starts only the application container. It does not install, create, initialize, start,
stop, or back up MariaDB.

## Environment variables

Important values:

- `APP_HOST`: Fastify bind address, fixed to `0.0.0.0` by Compose
- `APP_PORT`: Fastify host-network port, fixed to `8090` by Compose
- `APP_ORIGIN`: exact public browser origin, `https://dns.highrulez.com`
- `DATABASE_URL`: complete URL for the existing Synology MariaDB database, such as
  `mysql://cloudflare_ddns:encoded-password@192.168.1.10:3307/cloudflare_ddns`
- `ENCRYPTION_KEY`: canonical base64 for exactly 32 random bytes; encrypts API tokens
- `SESSION_SECRET`: at least 32 random characters; protects opaque session-token hashes
- `COOKIE_SECURE`: keep `true` when the dashboard is served over HTTPS
- `TZ`: defaults to `Asia/Kuala_Lumpur`

Never commit `.env`. Losing `ENCRYPTION_KEY` makes stored Cloudflare tokens unrecoverable.

Fastify trusts Synology's forwarded protocol, host, port, and client-address headers. Origin
validation and absolute public-origin reporting always use `APP_ORIGIN`; the application does not
derive public URLs from the internal `127.0.0.1:8090` listener.

## Cloudflare API token

Create a scoped API token in the Cloudflare dashboard. Grant:

- Zone → Zone → Read
- Zone → DNS → Edit

Restrict the token to only the zones this manager should control. The token is shown once by
Cloudflare. The application encrypts it with AES-256-GCM and subsequently returns only a masked
hint.

## First setup

The wizard creates the administrator, verifies and stores a Cloudflare token, discovers every
accessible zone and its A/AAAA records, detects public IPv4/IPv6, and lets you select exactly which
records DDNS may control. New records can be created from the same screen. Setup endpoints close
after completion.

## Managing records

Use **Cloudflare → View Zones → View Records** to discover existing A/AAAA records and select only
the records that should follow the Synology public IP. Unselected records are never written by the
scheduler.

Use **DNS Records → Add DNS Record** to create a new Cloudflare record without leaving the
application. Select an account and zone, enter a subdomain such as `nas` or `@` for the apex, choose
A or AAAA, detected or custom IP, proxy mode, TTL, and DDNS state. Duplicate records are never
created blindly; an existing match can instead be linked for management.

**Stop Managing** removes only the local DDNS association and leaves Cloudflare untouched.
**Delete from Cloudflare** is a separate destructive action that requires typing the full hostname.

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

The public endpoint reports only liveness/readiness status and a timestamp. Docker uses the same
minimal endpoint. Detailed database, scheduler, network, and provider information is available only
on the authenticated System page.

The authenticated **System** page auto-refreshes every 30 seconds. It provides infrastructure
status, on-demand self-tests, and a sanitized diagnostics report. Recent logs are held only in
container memory and are cleared on restart. API tokens, passwords, cookies, encryption material,
session secrets, and the database URL are excluded from log and diagnostics responses.

## Backups

Back up:

- The existing MariaDB database using your normal Synology database backup procedure
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

The application waits for the existing MariaDB service and applies its committed application-table
migrations before startup. It never creates a MariaDB server, database, or database user.

## Troubleshooting

- **Port unavailable:** free TCP port `8090` on the Synology host before startup. Port `8080` is not
  used.
- **Origin rejected:** make `APP_ORIGIN` exactly match the browser scheme, host, and port.
- **Database access denied:** verify the existing database, application user grants, TCP access, and
  URL-encoded `DATABASE_URL`.
- **Token rejected:** confirm Bearer token permissions and zone-resource restrictions.
- **No zones:** the token needs Zone Read access for at least one zone.
- **Updates forbidden:** the token needs Zone DNS Edit for the selected zone.
- **Container/network IPv6 unavailable:** verify the application uses host networking, then run the
  documented Node IPv6 diagnostic from inside the container.
- **Container unhealthy:** inspect `docker compose logs app` and verify native MariaDB is reachable
  from containers.

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
