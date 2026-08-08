FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true
RUN corepack enable

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
    && generated_package="$(readlink -f /app/node_modules/@prisma/client)" \
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

WORKDIR /app
USER node

FROM runtime AS api
COPY --from=build /prod/api/package.json ./apps/api/package.json
COPY --from=build /prod/api/dist ./apps/api/dist
COPY --from=build /prod/api/node_modules ./apps/api/node_modules
COPY --from=build /prod/database/package.json ./packages/database/package.json
COPY --from=build /prod/database/prisma.config.ts ./packages/database/prisma.config.ts
COPY --from=build /prod/database/prisma ./packages/database/prisma
COPY --from=build /prod/database/scripts ./packages/database/scripts
COPY --from=build /prod/database/node_modules ./packages/database/node_modules
COPY --chmod=755 docker/start-api.sh /usr/local/bin/start-api
CMD ["/usr/local/bin/start-api"]

FROM runtime AS worker
COPY --from=build /prod/worker/package.json ./apps/worker/package.json
COPY --from=build /prod/worker/dist ./apps/worker/dist
COPY --from=build /prod/worker/node_modules ./apps/worker/node_modules
CMD ["node", "/app/apps/worker/dist/index.js"]
