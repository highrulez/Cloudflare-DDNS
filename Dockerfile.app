FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true
RUN corepack enable
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/jobs/package.json packages/jobs/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY apps/worker apps/worker
COPY packages packages
# Prisma 7 resolves DATABASE_URL while loading prisma.config.ts even though
# client generation never connects to the database. This scoped, non-production
# placeholder exists only for `prisma generate`.
RUN DATABASE_URL="mysql://prisma_build:prisma_build@127.0.0.1:3306/prisma_build" pnpm db:generate \
    && pnpm --filter @infra-hub/api build \
    && pnpm --filter @infra-hub/worker build \
    && pnpm --filter @infra-hub/api deploy --prod --legacy /prod/api \
    && pnpm --filter @infra-hub/worker deploy --prod --legacy /prod/worker \
    && pnpm --filter @infra-hub/database deploy --prod --legacy /prod/database \
    && rm -rf /prod/api/node_modules/@infra-hub /prod/worker/node_modules/@infra-hub \
    && generated_package="$(readlink -f /app/packages/database/node_modules/@prisma/client)" \
    && generated_client="$(dirname "$(dirname "${generated_package}")")/.prisma" \
    && test -d "${generated_client}/client" \
    && for deployment in /prod/api /prod/worker /prod/database; do \
         client_package="$(readlink -f "${deployment}/node_modules/@prisma/client")"; \
         target_modules="$(dirname "$(dirname "${client_package}")")"; \
         cp -R "${generated_client}" "${target_modules}/.prisma"; \
       done \
    && (cd /prod/api && node -e "for (const name of ['fastify','@fastify/cookie','@fastify/helmet','@fastify/rate-limit','zod','@prisma/client','@prisma/adapter-mariadb','mariadb','argon2','bullmq','ioredis','dotenv']) require.resolve(name); require('@prisma/client')") \
    && (cd /prod/worker && node -e "for (const name of ['zod','@prisma/client','@prisma/adapter-mariadb','mariadb','bullmq','ioredis','dotenv']) require.resolve(name); require('@prisma/client')") \
    && (cd /prod/database && node -e "require.resolve('prisma/package.json'); require('@prisma/client')")

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV HOME=/home/node
ENV TMPDIR=/tmp
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
USER node

FROM runtime AS api
COPY --from=build /prod/api/package.json ./package.json
COPY --from=build /prod/api/dist ./dist
COPY --from=build /prod/api/node_modules ./node_modules
COPY --from=build /prod/database/package.json ./database/package.json
COPY --from=build /prod/database/prisma.config.ts ./database/prisma.config.ts
COPY --from=build /prod/database/prisma ./database/prisma
COPY --from=build /prod/database/scripts ./database/scripts
COPY --from=build /prod/database/node_modules ./database/node_modules
COPY scripts/smoke-auth.mjs ./smoke-auth.mjs
COPY --chmod=755 docker/start-api.sh /usr/local/bin/start-api
RUN node -e "['fastify','@fastify/cookie','@fastify/helmet','@fastify/rate-limit','ioredis','bullmq','argon2','mariadb','@prisma/client','zod','dotenv'].forEach(require.resolve); require('@prisma/client'); console.log('Runtime dependencies OK')"
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=8 CMD node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["/usr/local/bin/start-api"]

FROM runtime AS worker
COPY --from=build /prod/worker/package.json ./package.json
COPY --from=build /prod/worker/dist ./dist
COPY --from=build /prod/worker/node_modules ./node_modules
RUN node -e "['ioredis','bullmq','mariadb','@prisma/client','zod','dotenv'].forEach(require.resolve); require('@prisma/client'); console.log('Worker runtime dependencies OK')"
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 CMD node -e "require('node:fs').accessSync('/tmp/infra-hub-worker-ready')"
CMD ["node", "/app/dist/index.js"]
