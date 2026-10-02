# syntax=docker/dockerfile:1
# Shapio image. The runtime stage installs the same `shapio` npm tarball the npm path publishes,
# so both install paths run identical code.

FROM node:24-slim AS build
RUN corepack enable
WORKDIR /repo
# Manifests first so dependency installation is cached across source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
# Every workspace project's manifest is needed for a frozen install, even ones the image does not ship.
COPY apps/example-site/package.json apps/example-site/
COPY packages/schema/package.json packages/schema/
COPY packages/client/package.json packages/client/
COPY packages/cli/package.json packages/cli/
COPY packages/create-shapio/package.json packages/create-shapio/
COPY packages/editor-sdk/package.json packages/editor-sdk/
RUN pnpm install --frozen-lockfile
COPY . .
# prepack builds shapio and its workspace dependencies plus the admin bundle, then copies the admin in.
RUN pnpm --filter shapio pack --pack-destination /out && mv /out/shapio-*.tgz /out/shapio.tgz

FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4300 \
    MEDIA_PATH=/data/media
WORKDIR /app
COPY --from=build /out/shapio.tgz /tmp/shapio.tgz
RUN npm install --omit=dev --no-audit --no-fund /tmp/shapio.tgz \
    && rm /tmp/shapio.tgz \
    && npm cache clean --force \
    && mkdir -p /data/media \
    && chown -R node:node /app /data
USER node
EXPOSE 4300
VOLUME ["/data/media"]
# `shapio healthcheck` probes /api/ready over loopback with the right scheme, port and BASE_PATH.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "node_modules/shapio/dist/cli.js", "healthcheck"]
CMD ["node", "node_modules/shapio/dist/cli.js", "start"]
