ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS dependencies
ARG BUILD_NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=build_ca,target=/run/secrets/build_ca,required=false \
    --mount=type=cache,id=idealmakoo-npm,target=/root/.npm,sharing=locked \
    if [ -s /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi \
    && npm ci --no-audit --no-fund --registry="${BUILD_NPM_REGISTRY}" \
       --fetch-retries=3 --fetch-retry-mintimeout=1000 --fetch-retry-maxtimeout=15000 --fetch-timeout=90000

FROM dependencies AS builder
ARG NEXT_PUBLIC_SITE_URL=https://idealmako.ir
# Deployment identity is supplied at runtime by Compose. A new installation
# timestamp must not invalidate compilation of otherwise identical source.
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_DATA_MODE=api \
    NEXT_PUBLIC_DEMO_MODE=false \
    NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
# Keep compilation independent of operational shell/Python files and guides.
# TypeScript checks still include the current typed scripts, tests and configs.
COPY next.config.ts next-env.d.ts tsconfig.json tailwind.config.ts postcss.config.mjs playwright.config.ts vitest.config.ts ./
COPY src ./src
COPY public ./public
COPY worker ./worker
COPY scripts/*.ts ./scripts/
COPY scripts/lib ./scripts/lib
COPY scripts/build-service-worker.mjs ./scripts/
COPY tests/*.ts ./tests/
COPY tests/e2e ./tests/e2e
RUN --mount=type=secret,id=build_ca,target=/run/secrets/build_ca,required=false \
    if [ -s /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi \
    && npm run build

# Share the one lockfile installation instead of running a second npm resolver
# concurrently on small hosts. Pruning happens only in this derived build stage.
FROM dependencies AS production-dependencies
RUN --mount=type=secret,id=build_ca,target=/run/secrets/build_ca,required=false \
    --mount=type=cache,id=idealmakoo-npm,target=/root/.npm,sharing=locked \
    if [ -s /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi \
    && npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NPM_CONFIG_CACHE=/tmp/npm \
    STORAGE_DIR=/app/storage
WORKDIR /app
RUN --mount=type=cache,id=idealmakoo-apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=idealmakoo-apt-lists,target=/var/lib/apt/lists,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean \
    && apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 -o APT::Update::Error-Mode=any update \
    && DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 install -y --no-install-recommends ffmpeg ca-certificates \
    && groupadd --system --gid 10001 idealmakoo \
    && useradd --system --uid 10001 --gid 10001 --home-dir /app --no-create-home idealmakoo \
    && mkdir -p /app/storage/public /app/storage/private /app/privacy-ledger /app/integrations /app/.next/cache \
    && chown -R 10001:10001 /app
COPY --from=production-dependencies --chown=10001:10001 /app/node_modules ./node_modules
COPY --from=builder --chown=10001:10001 /app/.next/standalone ./
COPY --from=builder --chown=10001:10001 /app/.next/static ./.next/static
COPY --from=builder --chown=10001:10001 /app/public ./public
COPY --from=builder --chown=10001:10001 /app/src ./src
COPY --from=builder --chown=10001:10001 /app/worker ./worker
# Read operational files from the current context, after the compiled output.
COPY --chown=10001:10001 scripts ./scripts
COPY --chown=10001:10001 db ./db
COPY --chown=10001:10001 deploy ./deploy
COPY --from=builder --chown=10001:10001 /app/tsconfig.json /app/package.json ./
USER 10001:10001
EXPOSE 3000
ENTRYPOINT ["/bin/sh", "/app/scripts/entrypoint.sh"]
CMD ["web"]
