ARG NODE_IMAGE=crpi-sxza8grrzyp8e6zm.cn-shanghai.personal.cr.aliyuncs.com/shpt/node:24-alpine
ARG RUNTIME_IMAGE=crpi-sxza8grrzyp8e6zm.cn-shanghai.personal.cr.aliyuncs.com/shpt/node:24-alpine
# Keep the legacy ARG names declared for older build scripts, but pin FROM to
# ACR directly so CI cannot override the base image back to Docker Hub.

FROM crpi-sxza8grrzyp8e6zm.cn-shanghai.personal.cr.aliyuncs.com/shpt/node:24-alpine AS build

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG http_proxy
ARG https_proxy
ARG no_proxy
ARG NO_PROXY

ENV HTTP_PROXY=${HTTP_PROXY}
ENV HTTPS_PROXY=${HTTPS_PROXY}
ENV http_proxy=${http_proxy}
ENV https_proxy=${https_proxy}
ENV no_proxy=${no_proxy}
ENV NO_PROXY=${NO_PROXY}
ENV CI=true
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
ENV PNPM_HOME=/pnpm
ENV PNPM_STORE_PATH=/pnpm/store
ENV PATH="${PNPM_HOME}:${PATH}"

RUN sed -i 's|https://dl-cdn.alpinelinux.org/alpine|https://mirrors.aliyun.com/alpine|g' /etc/apk/repositories && \
    apk add --no-cache python3 make g++

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/postinstall.mjs ./scripts/postinstall.mjs
COPY packages/agui-adapter/package.json ./packages/agui-adapter/package.json
COPY packages/components/package.json ./packages/components/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/diagnostics/package.json ./packages/diagnostics/package.json
COPY packages/download/package.json ./packages/download/package.json
COPY packages/host/package.json ./packages/host/package.json
COPY packages/launcher-proto/package.json ./packages/launcher-proto/package.json
COPY packages/metatool/package.json ./packages/metatool/package.json
COPY packages/platform/package.json ./packages/platform/package.json
COPY packages/plugin-runtime/package.json ./packages/plugin-runtime/package.json
COPY packages/registry-protocol/package.json ./packages/registry-protocol/package.json
COPY packages/sidecar/package.json ./packages/sidecar/package.json
COPY packages/sidecar-proto/package.json ./packages/sidecar-proto/package.json
COPY tools/dev/package.json ./tools/dev/package.json
COPY tools/pack/package.json ./tools/pack/package.json
COPY tools/serve/package.json ./tools/serve/package.json
COPY apps/daemon/package.json ./apps/daemon/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY e2e/package.json ./e2e/package.json
RUN --mount=type=cache,id=corepack-cache,target=/root/.cache/node/corepack \
    --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    corepack enable && \
    corepack prepare pnpm@10.33.2 --activate && \
    pnpm fetch --frozen-lockfile

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline

COPY packages ./packages
COPY tools ./tools
COPY apps ./apps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @open-design/daemon build && \
    pnpm --filter @open-design/web build && \
    pnpm --filter @open-design/daemon deploy --legacy --prod /app/deploy/daemon && \
    pnpm store prune && \
    rm -rf \
      /root/.cache \
      /root/.local/share/pnpm/store \
      /app/deploy/daemon/node_modules/.cache \
      /app/deploy/daemon/node_modules/@types \
      /app/deploy/daemon/node_modules/.pnpm/@types+* \
      /app/deploy/daemon/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/deps \
      /app/deploy/daemon/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/src && \
    find /app/deploy/daemon/node_modules -type d \( \
      -name test -o \
      -name tests -o \
      -name "__tests__" -o \
      -name docs -o \
      -name doc -o \
      -name example -o \
      -name examples -o \
      -name ".github" \
    \) -prune -exec rm -rf '{}' + && \
    find /app/deploy/daemon/node_modules -type f \( \
      -name "*.md" -o \
      -name "*.markdown" -o \
      -name "*.d.ts" -o \
      -name "*.d.cts" -o \
      -name "*.d.mts" -o \
      -name "*.map" -o \
      -name "*.tsbuildinfo" -o \
      -name "binding.gyp" \
    \) -delete

# Stage-2 assets — copied into the build stage so the runtime stage
# can pull them via --from=build instead of reaching back into the
# build context.  This lets the Dockerfile work when the build context
# differs from the repo root (Railway, CI runners with a subdirectory
# context, etc.).
COPY skills ./skills
COPY design-systems ./design-systems
COPY craft ./craft
COPY prompt-templates ./prompt-templates
COPY assets ./assets
COPY plugins/_official ./plugins/_official

FROM crpi-sxza8grrzyp8e6zm.cn-shanghai.personal.cr.aliyuncs.com/shpt/node:24-alpine

RUN sed -i 's|https://dl-cdn.alpinelinux.org/alpine|https://mirrors.aliyun.com/alpine|g' /etc/apk/repositories && \
    apk add --no-cache tini poppler-utils && \
    addgroup -S -g 1001 open-design && \
    adduser -S -D -H -u 1001 -G open-design open-design

WORKDIR /app
COPY --from=build --chown=open-design:open-design /app/deploy/daemon ./apps/daemon
COPY --from=build --chown=open-design:open-design /app/apps/web/out ./apps/web/out
COPY --from=build --chown=open-design:open-design /app/skills ./skills
COPY --from=build --chown=open-design:open-design /app/design-systems ./design-systems
COPY --from=build --chown=open-design:open-design /app/craft ./craft
COPY --from=build --chown=open-design:open-design /app/prompt-templates ./prompt-templates
COPY --from=build --chown=open-design:open-design /app/assets/frames ./assets/frames
COPY --from=build --chown=open-design:open-design /app/assets/community-pets ./assets/community-pets
# Plan §3.J4 / spec §23.3.5 — bundled atom plugins registered on
# daemon boot. The directory contains `plugins/_official/atoms/<atom>/`
# pairs (SKILL.md + open-design.json); registerBundledPlugins() walks
# it on startup so the container ships with first-party atoms reachable
# via the same registry path third-party plugins use.
COPY --from=build --chown=open-design:open-design /app/plugins/_official ./plugins/_official

RUN mkdir -p /app/.od && \
    chown -R open-design:open-design /app

ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=192
ENV OD_BIND_HOST=0.0.0.0
ENV OD_PORT=7456

EXPOSE 7456

USER open-design
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/daemon/dist/cli.js", "--no-open"]
