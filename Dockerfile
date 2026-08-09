FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true
RUN corepack enable \
    && apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

COPY apps apps
COPY packages packages
RUN DATABASE_URL="mysql://build:build@127.0.0.1:3306/build" pnpm db:generate \
    && pnpm build \
    && pnpm --filter @ddns/server deploy --prod --legacy /output/server \
    && pnpm --filter @ddns/database deploy --prod --legacy /output/database \
    && generated_package="$(readlink -f /workspace/packages/database/node_modules/@prisma/client)" \
    && generated_client="$(dirname "$(dirname "${generated_package}")")/.prisma" \
    && for deployment in /output/server /output/database; do \
         client_package="$(readlink -f "${deployment}/node_modules/@prisma/client")"; \
         target_modules="$(dirname "$(dirname "${client_package}")")"; \
         cp -R "${generated_client}" "${target_modules}/.prisma"; \
       done

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV HOME=/home/node
ENV TMPDIR=/tmp
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /output/server/package.json ./package.json
COPY --from=build /output/server/dist ./dist
COPY --from=build /output/server/node_modules ./node_modules
COPY --from=build /workspace/apps/web/dist ./public
COPY --from=build /output/database/package.json ./database/package.json
COPY --from=build /output/database/prisma.config.ts ./database/prisma.config.ts
COPY --from=build /output/database/prisma ./database/prisma
COPY --from=build /output/database/scripts ./database/scripts
COPY --from=build /output/database/node_modules ./database/node_modules
COPY --chmod=755 docker/start.sh /usr/local/bin/start-cloudflare-ddns

RUN node -e "['fastify','@fastify/cookie','@fastify/static','argon2','mariadb','@prisma/client','zod','dotenv'].forEach(require.resolve); require('@prisma/client'); console.log('Runtime dependencies OK')"

USER node
EXPOSE 3000
CMD ["/usr/local/bin/start-cloudflare-ddns"]
