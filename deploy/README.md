# Docker deployment

This deployment ships Open Design as a single Alpine-based runtime image. The
daemon serves both the API and the built Next.js static export, so there is no
separate nginx container.

## Private / offline deployment (OpenCode + local model)

For a self-hosted server that must not talk to the public internet — driving a
local OpenAI-compatible model through OpenCode, with telemetry and the updater
disabled — see:

- [`Dockerfile.private`](./Dockerfile.private) — thin layer adding the OpenCode CLI.
- [`docker-compose.private.yml`](./docker-compose.private.yml) — overlay that sets
  `OPEN_DESIGN_PRIVATE_DEPLOYMENT=1` and mounts the OpenCode provider config.
- [`private-egress/README.md`](./private-egress/README.md) — the network egress
  allow-list (the real security boundary).

### Two-stage ACR build (base → private)

`Dockerfile.private` builds *on top of* the runtime image produced by
`deploy/Dockerfile`. It resolves that base through `OPEN_DESIGN_BASE_IMAGE`,
which defaults to the ACR **moving tag**:

```text
crpi-sxza8grrzyp8e6zm.cn-shanghai.personal.cr.aliyuncs.com/shpt/open-design:base
```

So the base build step must push that moving `:base` tag in addition to any
versioned tag. With buildx, pass both `-t` flags in the same step so they push
together:

```bash
docker buildx build --progress=plain \
  -t crpi-sxza8grrzyp8e6zm.cn-shanghai.personal.cr.aliyuncs.com/shpt/open-design:base-<version> \
  -t crpi-sxza8grrzyp8e6zm.cn-shanghai.personal.cr.aliyuncs.com/shpt/open-design:base \
  -f deploy/Dockerfile . --push
```

Then the private step needs no `--build-arg` — it resolves `:base` automatically:

```bash
docker buildx build --progress=plain \
  -t crpi-sxza8grrzyp8e6zm.cn-shanghai.personal.cr.aliyuncs.com/shpt/open-design:private-<version> \
  -f deploy/Dockerfile.private . --push
```

Ordering matters: the private build must run only after the base build has
finished pushing `:base`. If a pipeline only publishes a versioned base tag,
override the base ref instead:

```bash
--build-arg OPEN_DESIGN_BASE_IMAGE=crpi-sxza8grrzyp8e6zm.cn-shanghai.personal.cr.aliyuncs.com/shpt/open-design:base-<version>
```

For the Qwen3.6 LiteLLM service documented in
`/Users/mayiming/IdeaProjects/xj_hr/litellm-deploy/QWEN_USAGE.md`, start from
the dedicated template:

```bash
cp deploy/.env.private.example deploy/.env.private
cp deploy/opencode/opencode.qwen36.example.json deploy/opencode/opencode.json
```

Then edit `deploy/.env.private` and set `OD_API_TOKEN`, and edit
`deploy/opencode/opencode.json` replacing `<LITELLM_MASTER_KEY>` with the
LiteLLM master key. The template points OpenCode at:

```text
baseURL: http://192.168.10.188:30400/v1
model:   local-qwen36/qwen3.6-35b-a3b-fp8
```

## Local compose

Before starting:

1. Copy the environment template:

   ```bash
   cp .env.example .env
   ```

2. Generate a secure token:

   ```bash
   openssl rand -hex 32
   ```

3. Open `.env` in your editor, find `OD_API_TOKEN=`, and paste the generated token there.

Then pull and start the service:

```bash
OPEN_DESIGN_IMAGE=docker.io/vanjayak/open-design:latest docker compose pull
OPEN_DESIGN_IMAGE=docker.io/vanjayak/open-design:latest docker compose up -d --no-build
```

Defaults:

- Host port: `127.0.0.1:7456` (`OPEN_DESIGN_PORT=8080` to publish on `127.0.0.1:8080`)
- Runtime data: before documenting, changing, or choosing persistent daemon
  storage, you MUST read root [`AGENTS.md`](../AGENTS.md) → **Daemon data
  directory contract**. This README MUST NOT restate it.
- Node heap cap: `--max-old-space-size=192`
- Compose memory cap: `384m` (`OPEN_DESIGN_MEM_LIMIT=256m` to override)

Do not publish the daemon directly on a public or shared LAN interface. The API is
unauthenticated for non-browser clients, so remote deployments should keep Compose
bound to localhost and put an authenticated reverse proxy, SSH tunnel, or VPN in
front of it.

When exposing the service through an authenticated public IP, domain, or reverse
proxy, set `OPEN_DESIGN_ALLOWED_ORIGINS` to the browser origins that should be
allowed to call `/api`:

```bash
OPEN_DESIGN_ALLOWED_ORIGINS=https://od.example.com,http://203.0.113.10:7456 docker compose up -d --no-build
```

Pin a specific published image with a digest instead of the mutable `latest` tag:

```bash
OPEN_DESIGN_IMAGE=docker.io/vanjayak/open-design@sha256:<digest> docker compose up -d --no-build
```
The image intentionally does not bundle Claude/Codex/Gemini CLI binaries. Keep
those outside the image, or build a separate private runtime layer if a server
deployment needs local code-agent CLIs installed in the container.

If you install Codex inside an unprivileged Linux container and it fails while
creating its `workspace-write` sandbox, opt into Codex's full-access mode for
all Codex runs in that deployment:

```bash
OD_CODEX_SANDBOX=danger-full-access docker compose up -d --no-build
```

Only the exact value `danger-full-access` is supported; unknown values are
ignored. Use this only for trusted, single-user deployments. It lets Codex run
without the workspace-write sandbox, which is useful when the container host
blocks unprivileged user namespaces, but it gives the Codex process broader
filesystem access inside the container.

## Publish to Docker Hub

```bash
deploy/scripts/publish-images.sh --image_tag latest
```

Useful overrides:

```bash
IMAGE_NAMESPACE=your-dockerhub-user deploy/scripts/publish-images.sh --arch arm64
deploy/scripts/publish-images.sh --image docker.io/your-user/open-design:0.1.0
```

The script defaults to:

- `docker.io/vanjayak/open-design:<tag>`
- `linux/amd64,linux/arm64`
- `skopeo` push strategy with Docker credentials read from `~/.docker/config.json`
- preloading base images through `skopeo` to reduce Docker Hub pull flakiness

If `127.0.0.1:7890` is available and no proxy is already set, the script uses it
for registry access and passes `host.docker.internal:7890` into Docker builds. The
host-gateway alias is only added for builds that need this local proxy mapping.

### Colima swap helper for Apple Silicon

`deploy/scripts/prepare-colima-build-swap.sh` is for manual Docker image
publishing from an Apple Silicon macOS host that uses Colima as the Docker VM.
The helper is intentionally Apple Silicon-only because the failure mode it covers
is local arm64 Colima builds exhausting a small Linux VM while preparing
multi-arch images. It exits before touching Colima on non-macOS or
non-Apple-Silicon hosts.

Low-memory Colima VMs can run out of RAM during multi-arch image builds. The
helper checks the VM memory and swap status, then creates and enables a temporary
swap file only when the VM has no swap and less than 4 GiB of RAM. The 4 GiB
threshold is a conservative default for short-lived manual publishes on small
Colima profiles; raise `COLIMA_BUILD_SWAP_MEMORY_THRESHOLD_KIB` if larger builds
still OOM, or lower it if you only want swap for very small VMs.

Prefer increasing the Colima VM memory (`colima start --memory <GiB>` or the
profile config) when you want a persistent build machine. Use this helper when
you need a temporary, reversible boost for one manual publish without resizing
or recreating the VM.

Run it before a manual publish if Docker builds fail with out-of-memory errors,
or if `status` shows a small Colima VM with no swap. The swap remains active
until cleanup or VM restart, so use a shell trap for one-off sessions:

```bash
deploy/scripts/prepare-colima-build-swap.sh status
deploy/scripts/prepare-colima-build-swap.sh
trap 'deploy/scripts/prepare-colima-build-swap.sh cleanup' EXIT
deploy/scripts/publish-images.sh --image_tag latest
```

Useful overrides:

```bash
COLIMA_BUILD_SWAP_SIZE=6G deploy/scripts/prepare-colima-build-swap.sh
COLIMA_BUILD_SWAP_MEMORY_THRESHOLD_KIB=6291456 deploy/scripts/prepare-colima-build-swap.sh
COLIMA_BIN=/opt/homebrew/bin/colima deploy/scripts/prepare-colima-build-swap.sh status
COLIMA_BUILD_SWAP_CLEANUP_FORCE=1 COLIMA_BUILD_SWAPFILE=/custom-swapfile deploy/scripts/prepare-colima-build-swap.sh cleanup
```

`cleanup` removes the default helper path and the old helper path. If you set a
custom `COLIMA_BUILD_SWAPFILE`, cleanup refuses to remove it unless
`COLIMA_BUILD_SWAP_CLEANUP_FORCE=1` is also set.

### Docker Desktop on macOS

When running Docker Compose on macOS with `OD_API_TOKEN` enabled, Docker Desktop bridge networking may cause the daemon to see API requests as non-loopback peers. In that case, the web UI can fail with:

`Authorization: Bearer <OD_API_TOKEN> required`

Workaround — apply the ready-made [`docker-compose.hostnet.yml`](./docker-compose.hostnet.yml) overlay:

1. Enable host networking in Docker Desktop:
   `Docker Desktop → Settings → Resources → Network → Enable host networking → Apply and restart`

2. Append the overlay to your `-f` chain and recreate. From the repository root, run:

   ```bash
   ROOT="$PWD"
   docker compose --project-directory "$ROOT" \
     -f "$ROOT/deploy/docker-compose.yml" \
     -f "$ROOT/deploy/docker-compose.private.yml" \
     -f "$ROOT/deploy/docker-compose.hostnet.yml" \
     --env-file "$ROOT/deploy/.env.private" \
     down
   docker compose --project-directory "$ROOT" \
     -f "$ROOT/deploy/docker-compose.yml" \
     -f "$ROOT/deploy/docker-compose.private.yml" \
     -f "$ROOT/deploy/docker-compose.hostnet.yml" \
     --env-file "$ROOT/deploy/.env.private" \
     up -d --force-recreate
   ```

   If your shell is already in `./deploy`, use the parent directory as `ROOT`:

   ```bash
   ROOT="$(cd .. && pwd)"
   docker compose --project-directory "$ROOT" \
     -f "$ROOT/deploy/docker-compose.yml" \
     -f "$ROOT/deploy/docker-compose.private.yml" \
     -f "$ROOT/deploy/docker-compose.hostnet.yml" \
     --env-file "$ROOT/deploy/.env.private" \
     down
   docker compose --project-directory "$ROOT" \
     -f "$ROOT/deploy/docker-compose.yml" \
     -f "$ROOT/deploy/docker-compose.private.yml" \
     -f "$ROOT/deploy/docker-compose.hostnet.yml" \
     --env-file "$ROOT/deploy/.env.private" \
     up -d --force-recreate
   ```

   For the plain local compose, run from the repository root:

   ```bash
   ROOT="$PWD"
   docker compose --project-directory "$ROOT" \
     -f "$ROOT/deploy/docker-compose.yml" \
     -f "$ROOT/deploy/docker-compose.hostnet.yml" \
     down
   docker compose --project-directory "$ROOT" \
     -f "$ROOT/deploy/docker-compose.yml" \
     -f "$ROOT/deploy/docker-compose.hostnet.yml" \
     up -d --force-recreate
   ```

3. Verify:

   ```bash
   docker inspect open-design --format '{{.HostConfig.NetworkMode}}'
   # host
   ```

The overlay forces the daemon to listen on `0.0.0.0` because Docker Desktop host
networking only forwards container listeners back to the host when they bind all
interfaces. Keep `OD_API_TOKEN` set. This is a Docker Desktop localhost
convenience — for multi-host or public deployments, keep bridge networking and
front the daemon with an authenticated reverse proxy that injects the bearer
instead.
