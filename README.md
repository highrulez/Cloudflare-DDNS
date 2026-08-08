# Infrastructure Hub

Infrastructure Hub is a self-hosted operations dashboard for DNS and infrastructure services. Sprint 1 ships a provider-neutral DNS inventory, Cloudflare connectivity, encrypted credentials, queued discovery, DDNS record selection, and the foundation for monitoring and notifications.

## Architecture

- React + Vite dashboard behind an unprivileged Nginx reverse proxy
- Fastify API with Redis-backed opaque sessions
- BullMQ workers for provider discovery and scheduled observations
- Prisma with MySQL 8.0+ (MariaDB 10.11 is a compatibility target)
- AES-256-GCM provider credential encryption
- Capability-based provider adapters; Cloudflare is the first implementation

The API only queues database identifiers. Provider credentials never enter BullMQ payloads or browser responses.

## Quick start with bundled services

1. Copy `.env.example` to `.env`.
2. Replace every password and generate `APP_ENCRYPTION_KEY`:

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

3. Start the application:

   ```sh
   docker compose --profile bundled up --build
   ```

4. Open `http://localhost:8080` and sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

The bootstrap credentials only create the first user. Change the password from Settings immediately.

## Existing MySQL and Redis

Set `DATABASE_URL` to a MySQL 8.0+ server and `REDIS_URL` to a Redis 7-compatible server, then start only the application services:

```sh
docker compose up --build web api worker
```

The database user must be able to apply the included Prisma migrations. Redis should require authentication and must not be exposed publicly.

## Local development

Requirements: Node.js 22+, Corepack, MySQL 8.0+, and Redis 7+.

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
