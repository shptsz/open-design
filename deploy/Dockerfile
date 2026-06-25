ARG NODE_IMAGE=crpi-sxza8grrzyp8e6zm.cn-shanghai.personal.cr.aliyuncs.com/shpt/node:24-bookworm-slim
ARG RUNTIME_IMAGE=crpi-sxza8grrzyp8e6zm.cn-shanghai.personal.cr.aliyuncs.com/shpt/node:24-bookworm-slim
# Keep the legacy ARG names declared for older build scripts, but pin FROM to
# ACR directly so CI cannot override the base image back to Docker Hub.
#
# glibc base: this image uses the Debian (glibc) node image, NOT alpine/musl.
# The Cursor CLI added by deploy/Dockerfile.agents bundles a glibc-built node
# that segfaults on musl; standardizing the whole base/private/agents chain on
# glibc is the supported fix. NOTE: the ACR `shpt/node:24-bookworm-slim` tag
# above must exist — mirror the upstream `node:24-bookworm-slim` into your ACR
# namespace once (it previously mirrored `node:24-alpine`).

FROM crpi-sxza8grrzyp8e6zm.cn-shanghai.personal.cr.aliyuncs.com/shpt/node:24-bookworm-slim AS build

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

# better-sqlite3 has no usable offline prebuild here, so node-gyp compiles it
# from source during `pnpm install --offline`; python3/make/g++ are its toolchain.
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# `pnpm fetch` only needs the lockfile, so this layer is cached as long as
# pnpm-lock.yaml is unchanged — independent of any source edits.
COPY pnpm-lock.yaml ./
RUN --mount=type=cache,id=corepack-cache,target=/root/.cache/node/corepack \
    --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    corepack enable && \
    corepack prepare pnpm@10.33.2 --activate && \
    pnpm fetch --frozen-lockfile

# Workspace package/tool sources must exist before `pnpm install`, because the
# root postinstall (scripts/postinstall.mjs) compiles packages/* and tools/*
# into the dist/*.d.ts that apps/daemon's tsc build resolves against.
COPY package.json pnpm-workspace.yaml ./
COPY scripts/postinstall.mjs ./scripts/postinstall.mjs
COPY packages ./packages
COPY tools ./tools
COPY apps/daemon/package.json ./apps/daemon/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY e2e/package.json ./e2e/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline

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

FROM crpi-sxza8grrzyp8e6zm.cn-shanghai.personal.cr.aliyuncs.com/shpt/node:24-bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends tini poppler-utils && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd -r -g 1001 open-design && \
    useradd -r -u 1001 -g open-design -M -d /nonexistent -s /usr/sbin/nologin open-design

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
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/daemon/dist/cli.js", "--no-open"]
