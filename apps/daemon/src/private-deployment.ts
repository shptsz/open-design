// Private/offline deployment switch.
//
// Set OPEN_DESIGN_PRIVATE_DEPLOYMENT=1 (or true/yes/on) when running Open
// Design behind a locked-down network egress policy (e.g. a self-hosted
// server that only talks to an internal OpenAI-compatible model endpoint).
//
// This is intentionally a single, narrow gate that a few high-risk outbound
// telemetry surfaces consult so a fork can stay close to upstream:
//   - apps/daemon/src/analytics.ts        → PostHog config becomes null
//   - apps/daemon/src/app-config.ts       → telemetry consent forced off
//   - apps/daemon/src/langfuse-trace.ts   → Langfuse/relay sink becomes null
//
// It is defense-in-depth ONLY. The real boundary is the container/host
// network whitelist (see deploy/private-egress/README.md); this flag just
// stops Open Design from attempting known telemetry calls in the first place.

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

export function isPrivateDeployment(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.OPEN_DESIGN_PRIVATE_DEPLOYMENT?.trim().toLowerCase();
  return raw !== undefined && TRUTHY.has(raw);
}
