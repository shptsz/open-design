# Private deployment — network egress control

This is the **primary** security boundary for a self-hosted Open Design that
must not talk to the public internet. The in-repo code patch
(`OPEN_DESIGN_PRIVATE_DEPLOYMENT=1`, see
`apps/daemon/src/private-deployment.ts`) is only defense-in-depth: it stops
Open Design from *attempting* its known telemetry calls (PostHog, Langfuse,
telemetry relay) and disables the auto-updater. It cannot constrain every
child process (OpenCode, MCP servers, plugins, generated HTML previews), so
the host/container network layer must enforce the real allow-list.

## Threat model

Open Design and the agents it spawns can make outbound requests. With the
telemetry gate on, the daemon itself should only need:

- your **internal OpenAI-compatible model endpoint** (e.g.
  `http://model.internal:8000`),
- internal **DNS** and, optionally, a corporate **HTTP(S) proxy**,
- (one-time, build only) the package registry so OpenCode can fetch its
  provider SDK — see the caveat below.

Everything else (PostHog, Langfuse, the release updater, GitHub/Discord stats,
marketplaces, third-party media/AI providers) should be **denied by default**.

## Option A — egress HTTP(S) proxy with a domain allow-list (recommended)

Run a forward proxy (Squid, tinyproxy, or a sidecar like
`mitmproxy`/`envoy`) that only permits the model host and required
infrastructure, then force the container through it:

```yaml
# add to deploy/docker-compose.private.yml under services.open-design.environment
HTTP_PROXY: http://egress-proxy.internal:3128
HTTPS_PROXY: http://egress-proxy.internal:3128
NO_PROXY: model.internal,127.0.0.1,localhost
```

Squid ACL sketch (`/etc/squid/squid.conf`):

```
acl allowed_dst dstdomain model.internal
http_access allow allowed_dst
http_access deny all
```

Node's `fetch`/`undici` honors `HTTP_PROXY`/`HTTPS_PROXY`, and so does OpenCode
and most agent CLIs, so a deny-by-default proxy is the simplest portable
whitelist.

## Option B — host firewall on the Docker bridge (no proxy)

Deny-by-default on the `DOCKER-USER` chain, allowing only the model host and
DNS. Run on the Docker host (Linux):

```bash
# Resolve the model host to an IP (or use the literal IP directly).
MODEL_IP=10.0.0.20
DNS_IP=10.0.0.2

# Allow established/related return traffic.
iptables -I DOCKER-USER -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
# Allow DNS + the model endpoint.
iptables -I DOCKER-USER -d ${DNS_IP}   -p udp --dport 53  -j ACCEPT
iptables -I DOCKER-USER -d ${MODEL_IP} -p tcp --dport 8000 -j ACCEPT
# Deny everything else leaving the container subnet.
iptables -A DOCKER-USER -j DROP
```

`nftables` equivalent: add a `chain forward` rule set that accepts the model
IP/DNS and drops the rest of the container subnet. Persist the rules
(`iptables-save` / `nft list ruleset`) so they survive a host reboot.

> A Docker `internal: true` network is **not** enough on its own — it blocks
> *all* outbound traffic including your model host, so the agent can't run.
> Use a proxy (Option A) or explicit allow rules (Option B) instead.

## OpenCode provider-SDK caveat (read before locking egress)

OpenCode loads its provider via the `npm` field in
`deploy/opencode/opencode.json` (`@ai-sdk/openai-compatible`). On first use it
may fetch that package from the registry. In a fully locked-down environment
this fetch will fail. Choose one:

1. **Warm the cache during image build** (network is available at build time):
   add a step to `deploy/Dockerfile.private` that runs OpenCode once with a
   throwaway config so the provider SDK is cached in the image, then ship it.
2. **Briefly allow the registry**: permit `registry.npmjs.org` (or your
   internal mirror) through the proxy for the first run, confirm the provider
   loads, then tighten the allow-list back to the model host only.

Document which option you picked in your runbook; option 1 keeps runtime
egress strictly model-only.

## Verification (do this once after deploy)

1. Bring the stack up with the overlay and egress control in place.
2. Run a full chat through the web UI (or `od chat`), confirming the local
   model answers.
3. Capture egress and confirm **only** the model host (and DNS/proxy) appears:

```bash
# On the host, watch what the container tries to reach.
sudo tcpdump -n -i any 'tcp and not host 127.0.0.1' | grep -v <model-ip>
# Expect: no PostHog (*.posthog.com), no Langfuse (*.langfuse.com),
# no releases host, no github.com, no discord.com, no provider clouds.
```

If anything other than the model endpoint appears, tighten the allow-list
before exposing the service.
