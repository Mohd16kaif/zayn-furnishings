# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN corepack enable && corepack prepare pnpm@12.4.2 --activate

WORKDIR /app

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

FROM dependencies AS build

COPY packages/shared packages/shared
COPY apps/api apps/api

RUN pnpm --filter @zayn/shared build \
    && pnpm --filter @zayn/api build \
    && pnpm --filter @zayn/api deploy --prod /prod/api

FROM node:24-bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=4000

WORKDIR /app

RUN groupadd --system --gid 1001 zayn \
    && useradd --system --uid 1001 --gid zayn --home-dir /app --shell /usr/sbin/nologin zayn \
    && mkdir -p /data/media \
    && chown -R zayn:zayn /app /data/media

COPY --from=build --chown=zayn:zayn /prod/api/package.json ./package.json
COPY --from=build --chown=zayn:zayn /prod/api/dist ./dist
COPY --from=build --chown=zayn:zayn /prod/api/drizzle ./drizzle
COPY --from=build --chown=zayn:zayn /prod/api/db-bootstrap ./db-bootstrap
COPY --from=build --chown=zayn:zayn /prod/api/node_modules ./node_modules

USER zayn

EXPOSE 4000

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
