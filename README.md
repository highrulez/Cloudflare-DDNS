# Infrastructure Hub

Infrastructure Hub is a self-hosted operations dashboard for DNS and infrastructure services. Sprint 1 ships a provider-neutral DNS inventory, Cloudflare connectivity, encrypted credentials, queued discovery, DDNS record selection, and the foundation for monitoring and notifications.

## Architecture

- React + Vite dashboard behind an unprivileged Nginx reverse proxy
- Fastify API with Redis-backed opaque sessions
- BullMQ workers for provider discovery and scheduled observations
- Prisma with the official MariaDB adapter and an external MariaDB 10.x database
- AES-256-GCM provider credential encryption
- Capability-based provider adapters; Cloudflare is the first implementation

The API only queues database identifiers. Provider credentials never enter BullMQ payloads or browser responses.

## Synology quick start

1. Copy `.env.example` to `.env`.
2. Set the existing MariaDB password in `DATABASE_URL`, replace the Redis/admin passwords, and generate `APP_ENCRYPTION_KEY`:

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

3. Start the application:

   ```sh
   docker compose up -d --build
   ```

4. Open `http://192.168.68.100:8080` and sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

The bootstrap credentials only create the first user. Change the password from Settings immediately.

The default Compose project creates only the web, API, worker, and Redis services. It connects to the existing Synology MariaDB server through `DATABASE_URL` and never creates a database container.

See [Synology deployment](docs/synology.md) for MariaDB permissions, Container Manager instructions, startup behavior, backups, and troubleshooting.

## Local development

Requirements: Node.js 22+, Corepack, MariaDB 10.x or MySQL 8.0+, and Redis 7+.

```sh
corepack pnpm install
corepack pnpm db:generate
corepack pnpm db:deploy
corepack pnpm dev
```

The web app runs on `http://localhost:5173`, proxies `/api` to Fastify on port 3000, and the worker consumes BullMQ jobs independently.

## Cloudflare token

Use a scoped API token with:

- Account: Account Settings Read
- Zone: Zone Read
- Zone: DNS Read
- Zone: DNS Edit (reserved for Sprint 2 DDNS updates)

The token is encrypted before persistence and is shown only as a short suffix after saving. Revoking a connection in Infrastructure Hub deletes its local credential; revoke the token in Cloudflare as well to invalidate it at the provider.

## Commands

```sh
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm db:generate
corepack pnpm db:migrate
corepack pnpm db:deploy
```

## Current scope

Sprint 1 discovers provider accounts, zones, and records and allows selecting A/AAAA records for DDNS. It does not mutate DNS records. Docker, System, SSL, Notifications, and DDNS execution are module placeholders backed by the shared worker architecture.
