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
- Cloudflare Turnstile on login, login rate limiting, session hardening, and authentication audit events
- Optional TOTP multi-factor authentication with QR enrollment and one-time recovery codes
- Responsive React dashboard

## Requirements

- Synology DSM Container Manager or Docker Engine with Compose v2
- An existing Synology MariaDB 10 database and non-root application user reachable over TCP
- A Cloudflare API token
- A Cloudflare Turnstile widget for your public application hostname
- Port `8090` available on the Synology host
- At least 512 MB free memory for the application container

## Documentation-safe examples

Examples in this repository use reserved documentation values. Replace every placeholder with your
own values before deploying. Do not copy another operator’s production `.env`.

| Purpose | Example placeholder | Replace with |
| --- | --- | --- |
| Public application URL | `https://ddns.example.com` | Your HTTPS hostname served by Synology Reverse Proxy |
| LAN diagnostics URL | `http://192.0.2.10:8090` | Your NAS LAN IP and app port |
| Example DNS zone | `example.com` | A Cloudflare zone you control |
| Example subdomains | `nas.example.com`, `vpn.example.com`, `home.example.com` | Hostnames you choose to manage |
| Example public IPv4 | `203.0.113.10` | Detected automatically in normal operation |
| Example public IPv6 | `2001:db8::10` | Detected automatically when IPv6 is enabled |
| Database name | `infrahub` | Your MariaDB database name |
| Database user | `ddns_app` | Your non-root MariaDB user |

## Quick start

1. Clone or copy this repository to the NAS.
2. Create the environment file:

   ```sh
   cp .env.example .env
   ```

3. Edit `.env` and replace every placeholder. At minimum set:

   - `APP_ORIGIN`
   - `APP_ALLOWED_ORIGINS`
   - `DATABASE_URL`
   - `ENCRYPTION_KEY`
   - `SESSION_SECRET`
   - `TURNSTILE_SITE_KEY`
   - `TURNSTILE_SECRET_KEY`
   - `TURNSTILE_EXPECTED_HOSTNAME`

   Generate secrets locally:

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

4. Preserve a verified MariaDB address in `DATABASE_URL`. With host networking, `127.0.0.1` refers to
   the Synology host, but do not change a working connection until MariaDB TCP binding and user
   grants have been verified. Confirm the MariaDB TCP port used by your NAS. URL-encode reserved
   characters in the database password.
5. Build and start:

   ```sh
   docker compose build
   docker compose up -d
   ```

6. Configure Synology Reverse Proxy so your public hostname (for example `https://ddns.example.com`)
   forwards to `http://127.0.0.1:8090`, then open the HTTPS URL and complete setup.

Compose starts only the application container. It does not install, create, initialize, start,
stop, or back up MariaDB.

Detailed Synology steps: [docs/synology.md](docs/synology.md).

## Environment variables

Important values (examples only — replace with your own):

```env
APP_ORIGIN=https://ddns.example.com
APP_ALLOWED_ORIGINS=https://ddns.example.com,http://192.0.2.10:8090
APP_PORT=8090
DATABASE_URL=mysql://ddns_app:CHANGE_ME@127.0.0.1:3306/infrahub
TURNSTILE_SITE_KEY=YOUR_TURNSTILE_SITE_KEY
TURNSTILE_SECRET_KEY=YOUR_TURNSTILE_SECRET_KEY
TURNSTILE_EXPECTED_HOSTNAME=ddns.example.com
TURNSTILE_EXPECTED_ACTION=login
ENCRYPTION_KEY=GENERATE_YOUR_OWN_KEY
SESSION_SECRET=GENERATE_YOUR_OWN_SECRET
COOKIE_SECURE=true
TZ=UTC
```

| Variable | Purpose |
| --- | --- |
| `APP_HOST` | Fastify bind address; Compose sets `0.0.0.0` |
| `APP_PORT` | Host-network listen port; Compose sets `8090` |
| `APP_ORIGIN` | Canonical public browser origin (HTTPS in production) |
| `APP_ALLOWED_ORIGINS` | Exact comma-separated browser origins allowed for mutating requests |
| `DATABASE_URL` | Existing Synology MariaDB URL for your app user and database |
| `ENCRYPTION_KEY` | Canonical base64 for exactly 32 random bytes; encrypts API tokens |
| `SESSION_SECRET` | At least 32 random characters; protects opaque session-token hashes |
| `COOKIE_SECURE` | Keep `true` when the dashboard is served over HTTPS |
| `TURNSTILE_SITE_KEY` | Public Turnstile site key |
| `TURNSTILE_SECRET_KEY` | Server-only Turnstile secret; never expose to the browser or commit it |
| `TURNSTILE_EXPECTED_HOSTNAME` | Hostname Turnstile Siteverify must return (your public app host) |
| `TURNSTILE_EXPECTED_ACTION` | Must match the widget action; production default is `login` |
| `TZ` | Container timezone for display; defaults to `UTC` in examples |

Never commit `.env`. Losing `ENCRYPTION_KEY` makes stored Cloudflare tokens unrecoverable.

Fastify trusts Synology's forwarded protocol, host, port, and client-address headers from loopback
only. Origin validation uses an exact allowlist from `APP_ALLOWED_ORIGINS` plus `APP_ORIGIN`.

When `COOKIE_SECURE=true`, Secure session cookies are still emitted for HTTPS production requests.
Direct HTTP LAN access may receive a non-Secure cookie scoped to that HTTP origin only. Do not set
`COOKIE_SECURE=false` globally just to make LAN HTTP login work.

Authenticated production administration should use your HTTPS hostname. Keep direct `:8090` access
primarily for diagnostics and health checks. Do not disable Turnstile or weaken hostname validation
for raw LAN IP access.

## Cloudflare Turnstile

1. In the Cloudflare dashboard, create a Turnstile widget for your public application hostname
   (example: `ddns.example.com`).
2. Use Managed mode. Dark theme and interaction-only appearance are recommended where supported.
3. Set the widget action to `login`.
4. Put the site key and secret key into `.env`. Production startup fails closed if they are missing.
5. Set `TURNSTILE_EXPECTED_HOSTNAME` to the same public hostname.

Automated/local tests should use Cloudflare’s official Turnstile test keys. Never call your
production Turnstile secret from CI.

## Multi-factor authentication (TOTP)

After Turnstile + password, accounts with MFA enabled must complete a short-lived MFA challenge
using a standard authenticator app (Microsoft Authenticator, Google Authenticator, 1Password,
Bitwarden, Authy, and other RFC-compatible TOTP apps) or a one-time recovery code.

Enable MFA from **Settings → Multi-factor authentication**:

1. Confirm your current password.
2. Scan the QR code (or reveal/copy the setup key).
3. Confirm with a 6-digit TOTP code.
4. Save the recovery codes shown once (copy or download `.txt` client-side).

There is no email or SMS recovery path. If you lose both the authenticator and all recovery codes,
there is no web-based bypass—restore access only through a controlled self-hosted recovery procedure
on the server.

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
curl -fsS http://192.0.2.10:8090/api/health
```

Replace `192.0.2.10` with your NAS LAN address.

The public endpoint reports only liveness/readiness status and a timestamp. Docker uses the same
minimal endpoint. Detailed database, scheduler, network, and provider information is available only
on the authenticated System page.

The authenticated **System** page auto-refreshes every 30 seconds. It provides infrastructure
status, on-demand self-tests, and a sanitized diagnostics report. Recent logs are held only in
container memory and are cleared on restart. API tokens, passwords, cookies, encryption material,
session secrets, Turnstile secrets, and the database URL are excluded from log and diagnostics
responses.

## Backups

Back up:

- The existing MariaDB database using your normal Synology database backup procedure
- `.env`, especially `ENCRYPTION_KEY`, `SESSION_SECRET`, and Turnstile secrets

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
- **Origin rejected:** make `APP_ORIGIN` and `APP_ALLOWED_ORIGINS` include the exact browser
  scheme, host, and port being used.
- **Turnstile failed:** confirm the widget hostname matches `TURNSTILE_EXPECTED_HOSTNAME`, the
  action is `login`, and you are signing in through the public HTTPS hostname.
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

Database timestamps are stored in UTC and displayed using the container `TZ` setting.
