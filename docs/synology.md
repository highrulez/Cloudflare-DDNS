# Synology DSM deployment

## Container Manager project

1. Place the repository in a shared folder, for example
   `/volume1/docker/cloudflare-ddns-manager`.
2. Copy `.env.example` to `.env` and replace every placeholder.
3. Preserve the currently verified `DATABASE_URL` for the existing Synology MariaDB 10 database.
   Host networking makes `127.0.0.1` refer to the NAS, but changing the address can change which
   MariaDB user grant applies. Verify before changing it.
4. In Container Manager, create a Project from the repository directory and select `compose.yaml`.
5. Build and start the project.
6. Configure the reverse proxy, then open `https://dns.highrulez.com`.

The project creates exactly one container:

- `app`: React dashboard, Fastify API, DDNS scheduler, and application schema migrations

It does not deploy or manage a MariaDB container, volume, database, or database user.

The application container uses Docker host networking. It shares the Synology network namespace so
public IPv4 and IPv6 detection represent the NAS itself. Compose does not publish ports or create a
separate Docker IPv6 subnet; Fastify listens directly on `0.0.0.0:8090`. Port `8080` is not used.
Compose also shares the host UTS namespace for the NAS hostname and mounts
`/etc.defaults/VERSION` read-only so the System page can identify DSM. The Docker socket is not
mounted.

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

With host networking, `127.0.0.1` and `localhost` refer to the Synology host. However, keep the
existing LAN-address URL until all of the following are verified:

- MariaDB accepts TCP connections on loopback.
- The application user has an applicable MariaDB host grant.
- The existing URL works from the host-networked application image.

Test the unchanged URL before startup:

```sh
docker compose run --rm app node /app/database/scripts/check-database.mjs
```

## Startup order

1. The existing Synology MariaDB service must already be running.
2. The app checks connectivity using `DATABASE_URL`.
3. Prisma applies pending application-table migrations to the selected existing database.
4. Fastify starts the scheduler and API.
5. `/api/health` becomes healthy.

The startup process does not create the MariaDB server, database, or user.

## Reverse proxy and HTTPS

Create a Synology DSM reverse-proxy rule:

- Source protocol: `HTTPS`
- Source hostname: `dns.highrulez.com`
- Source port: `443`
- Destination protocol: `HTTP`
- Destination hostname: `127.0.0.1`
- Destination port: `8090`

Set `APP_ORIGIN=https://dns.highrulez.com` and
`APP_ALLOWED_ORIGINS=https://dns.highrulez.com,http://192.168.68.100:8090`. Keep
`COOKIE_SECURE=true`. Ensure Synology forwards:

- `X-Forwarded-Proto: https`
- `X-Forwarded-Host: dns.highrulez.com`
- `X-Forwarded-Port: 443`
- `X-Forwarded-For: $remote_addr`

Fastify trusts forwarded headers only from loopback (`127.0.0.1` or `::1`), matching the destination
above. Direct LAN clients cannot spoof `request.protocol`, `request.hostname`, or `request.ip`.
Mutating browser requests must present an Origin that exactly matches an entry in
`APP_ALLOWED_ORIGINS` (and/or `APP_ORIGIN`). Do not expose port `8090` publicly. After signing in, open
**System → Overview** and confirm HTTPS, original host, client IP, secure cookies, and trusted-proxy
handling are healthy.

Direct LAN access at `http://192.168.68.100:8090` can load and authenticate without changing
`APP_ORIGIN` or disabling production Secure cookies. LAN HTTP sessions use a non-Secure cookie for
that HTTP origin only. Production HTTPS sessions continue to use Secure cookies.

To include release metadata in the System page, set these values before rebuilding:

```sh
export APP_VERSION=1.0.0
export GIT_COMMIT="$(git rev-parse --short HEAD)"
export BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
docker compose build --pull
docker compose up -d
```

## Operations

```sh
docker compose ps
docker compose logs -f app
docker compose restart app
```

The authenticated **System** page includes read-only MariaDB migration status, Cloudflare
connectivity, scheduler state, on-demand infrastructure self-tests, and sanitized recent logs. Logs
shown there are held in memory and reset when the container restarts. Diagnostics never include API
tokens, passwords, cookies, session/encryption secrets, or `DATABASE_URL`.

## Verify host-network IPv4 and IPv6

After rebuilding and starting the application, test Node.js from inside the same container:

```sh
docker compose exec app node -e "fetch('https://api4.ipify.org').then(r=>r.text()).then(v=>console.log('IPv4:',v.trim())).catch(e=>{console.error(e);process.exit(1)})"
docker compose exec app node -e "fetch('https://api6.ipify.org').then(r=>r.text()).then(v=>console.log('IPv6:',v.trim())).catch(e=>{console.error(e);process.exit(1)})"
```

Both commands must print the Synology host's public addresses. The IPv6 command must not report
`EADDRNOTAVAIL` or `ENETUNREACH`.

Stopping or removing this Compose project affects only the application container. Native Synology
MariaDB continues running.

## Backup

Back up the existing MariaDB database through your normal Synology database backup process, and
back up `.env`. Test restoration periodically. The encryption and session secrets are required
alongside the database.
