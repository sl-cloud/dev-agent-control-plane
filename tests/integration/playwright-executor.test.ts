import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { executePlaywrightSpec } from '../../src/modules/execution/playwright-executor.js';

let server: Server;
let targetUrl: string;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(
      '<!doctype html><html><head><title>Executor fixture</title></head><body><h1>Ready</h1></body></html>',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('test server did not expose a port');
  }
  targetUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe('executePlaywrightSpec', () => {
  it('records failing assertions without throwing', async () => {
    const output = await executePlaywrightSpec(
      { PLAYWRIGHT_TARGET_URL: targetUrl },
      `import { expect, test } from '@playwright/test';

test('reports a failed browser assertion', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('Not ready', { timeout: 500 });
});
`,
    );

    expect(output).toMatchObject({ passed: false, failed: true });
    expect(output.results).toEqual([
      expect.objectContaining({ title: 'reports a failed browser assertion', status: 'failed' }),
    ]);
    expect(output.results[0]?.error).toContain('Not ready');
  }, 30_000);
});
