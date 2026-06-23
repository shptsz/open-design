import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const posthogCapture = vi.hoisted(() => vi.fn());
const posthogShutdown = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('posthog-node', () => ({
  PostHog: vi.fn(function PostHogMock() {
    return {
      capture: posthogCapture,
      on: vi.fn(),
      shutdown: posthogShutdown,
    };
  }),
}));

const PRIVATE_ENV = { OPEN_DESIGN_PRIVATE_DEPLOYMENT: '1' };

describe('private deployment telemetry hard-off', () => {
  it('drops PostHog config even when POSTHOG_KEY is present', async () => {
    const { readPosthogConfig, readPublicConfigResponse } = await import(
      '../src/analytics.js'
    );

    const env = { ...PRIVATE_ENV, POSTHOG_KEY: 'phc_test', POSTHOG_HOST: 'https://example.com' };
    expect(readPosthogConfig(env)).toBeNull();
    expect(readPublicConfigResponse(env)).toMatchObject({
      enabled: false,
      key: null,
      host: null,
    });
  });

  it('makes daemon capture and captureSafety no-ops', async () => {
    posthogCapture.mockReset();
    const dataDir = await mkdtemp(path.join(tmpdir(), 'od-private-'));
    await writeFile(
      path.join(dataDir, 'app-config.json'),
      JSON.stringify({ installationId: 'install-1', telemetry: { metrics: true, content: true } }),
    );
    const { createAnalyticsService } = await import('../src/analytics.js');
    const analytics = createAnalyticsService({
      dataDir,
      env: { ...PRIVATE_ENV, POSTHOG_KEY: 'phc_test' },
    });

    analytics.capture({
      eventName: 'unit_event',
      appVersion: '1.2.3',
      context: {
        deviceId: 'device-1',
        sessionId: 'session-1',
        clientType: 'web',
        locale: 'en',
        requestId: null,
      },
      insertId: 'insert-1',
      properties: {},
    });
    await analytics.captureSafety({
      eventName: 'renderer_crash',
      appVersion: '1.2.3',
      properties: {},
    });

    // Give the async capture path a tick; it must never reach posthog-node.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posthogCapture).not.toHaveBeenCalled();
  });

  it('forces telemetry consent off regardless of saved prefs', async () => {
    vi.stubEnv('OPEN_DESIGN_PRIVATE_DEPLOYMENT', '1');
    try {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'od-private-cfg-'));
      await writeFile(
        path.join(dataDir, 'app-config.json'),
        JSON.stringify({ telemetry: { metrics: true, content: true, artifactManifest: true } }),
      );
      const { readAppConfig } = await import('../src/app-config.js');
      const cfg = await readAppConfig(dataDir);
      expect(cfg.telemetry).toEqual({
        metrics: false,
        content: false,
        artifactManifest: false,
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('applies default OpenCode agent/model when no agent was selected', async () => {
    vi.stubEnv('OPEN_DESIGN_DEFAULT_AGENT_ID', 'opencode');
    vi.stubEnv('OPEN_DESIGN_DEFAULT_AGENT_MODEL', 'local-qwen36/qwen3.6-35b-a3b-fp8');
    try {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'od-private-agent-'));
      const { readAppConfig } = await import('../src/app-config.js');
      const cfg = await readAppConfig(dataDir);
      expect(cfg.agentId).toBe('opencode');
      expect(cfg.agentModels?.opencode?.model).toBe('local-qwen36/qwen3.6-35b-a3b-fp8');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('resolves no telemetry sink even with relay/Langfuse env set', async () => {
    const { readTelemetrySinkConfig } = await import('../src/langfuse-trace.js');
    expect(
      readTelemetrySinkConfig({
        ...PRIVATE_ENV,
        OPEN_DESIGN_TELEMETRY_RELAY_URL: 'https://relay.example.com',
        LANGFUSE_PUBLIC_KEY: 'pk',
        LANGFUSE_SECRET_KEY: 'sk',
      }),
    ).toBeNull();
  });
});
