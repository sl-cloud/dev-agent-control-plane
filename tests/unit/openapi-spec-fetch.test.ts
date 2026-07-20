import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config/index.js';
import { fetchOpenApiSpec } from '../../src/modules/scm/source-context.js';

const TEST_DEFAULTS = {
  DATABASE_URL: 'postgres://control_plane:cp_dev_password@localhost:5432/control_plane',
  PLAYWRIGHT_TARGET_URL: 'http://127.0.0.1:3000',
  ADMIN_API_TOKEN: 'x'.repeat(20),
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('fetchOpenApiSpec', () => {
  it('returns the stringified spec on success', async () => {
    const spec = { openapi: '3.0.0', paths: { '/health/live': {} } };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => spec,
    });

    const config = loadConfig({ ...TEST_DEFAULTS });
    const result = await fetchOpenApiSpec(config);

    expect(result).toBe(JSON.stringify(spec));
  });

  it('sends Basic Auth when credentials are configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    globalThis.fetch = fetchMock;

    const config = loadConfig({
      ...TEST_DEFAULTS,
      PLAYWRIGHT_BASIC_AUTH_USERNAME: 'user',
      PLAYWRIGHT_BASIC_AUTH_PASSWORD: 'pass',
    });
    await fetchOpenApiSpec(config);

    const [, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('user:pass').toString('base64')}`);
  });

  it('returns null on a non-2xx response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });

    const config = loadConfig({ ...TEST_DEFAULTS });
    const result = await fetchOpenApiSpec(config);

    expect(result).toBeNull();
  });

  it('returns null on network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'));

    const config = loadConfig({ ...TEST_DEFAULTS });
    const result = await fetchOpenApiSpec(config);

    expect(result).toBeNull();
  });

  it('returns null when the response body is not valid JSON', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });

    const config = loadConfig({ ...TEST_DEFAULTS });
    const result = await fetchOpenApiSpec(config);

    expect(result).toBeNull();
  });
});
