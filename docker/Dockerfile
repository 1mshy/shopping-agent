# syntax=docker/dockerfile:1
# Core image (S§5.14): node:26-trixie-slim, non-root, amd64 + arm64.
#
# Everything is built on the build host's own platform: the output is plain JS, and
# better-sqlite3 ships N-API prebuilds for every platform, so the target arch only decides
# which prebuild is kept. A multi-arch build therefore never runs code under emulation.

ARG NODE_IMAGE=node:26-trixie-slim

FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS build
ARG PNPM_VERSION=12.21.0
RUN --mount=type=cache,id=npm,target=/root/.npm npm install -g pnpm@${PNPM_VERSION}
WORKDIR /src

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store

COPY . .
RUN pnpm build

ARG TARGETARCH
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm --filter @agentic-dasher/server deploy --prod --store-dir /pnpm-store /out \
 && case "$TARGETARCH" in \
      amd64) arch=x64 ;; \
      arm64) arch=arm64 ;; \
      *) echo "unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && cd "$(readlink -f /out/node_modules/better-sqlite3)" \
 && rm -rf deps src binding.gyp \
 && find prebuilds -type f ! -name "linux-$arch.node" -delete \
 && test -f "prebuilds/linux-$arch.node" \
 && mkdir /empty

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
COPY --from=build --chown=node:node /empty /data
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /src/apps/server/dist ./dist
COPY --from=build /src/apps/web/dist ./public

ARG APP_VERSION=0.0.0-dev
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    WEB_ROOT=/app/public \
    APP_VERSION=${APP_VERSION}

USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
