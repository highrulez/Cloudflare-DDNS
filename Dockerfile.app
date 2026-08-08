FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
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
    && pnpm --filter @infra-hub/worker build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV HOME=/home/node
ENV TMPDIR=/tmp

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/database ./packages/database
USER node

FROM runtime AS api
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --chmod=755 docker/start-api.sh /usr/local/bin/start-api
CMD ["/usr/local/bin/start-api"]

FROM runtime AS worker
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
CMD ["node", "/app/apps/worker/dist/index.js"]
