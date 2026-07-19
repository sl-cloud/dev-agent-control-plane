import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from '../helpers/build-app.js';

const ADMIN_TOKEN = 'rate_limit_test_admin_token_not_for_real_use';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp({ ADMIN_API_TOKEN: ADMIN_TOKEN });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('rate limiting', () => {
  it('returns 429 once the admin route limit is exceeded', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/runs/00000000-0000-0000-0000-000000000000/retry`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      statuses.push(res.statusCode);
    }
    // First 20 are auth'd-but-not-found (404); limit is 20/min, so request 21 is throttled.
    expect(statuses.slice(0, 20).every((s) => s === 404)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it('returns 429 once the webhook route limit is exceeded', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/github-ci',
        headers: {
          'x-portfolio-delivery': crypto.randomUUID(),
          'x-portfolio-timestamp': String(Math.floor(Date.now() / 1000)),
          'x-portfolio-signature': 'sha256=deadbeef',
        },
        payload: { project: 'no-such-project', event: 'deployment.completed' },
      });
      statuses.push(res.statusCode);
    }
    // First 60 are rejected on signature/unknown-project (401); limit is 60/min.
    expect(statuses.slice(0, 60).every((s) => s === 401)).toBe(true);
    expect(statuses[60]).toBe(429);
  });
});
