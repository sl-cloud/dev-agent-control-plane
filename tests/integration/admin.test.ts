import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildTestApp } from '../helpers/build-app.js';
import { agentRunsTable, projectsTable } from '../../src/db/schema.js';

const ADMIN_TOKEN = 'test_only_admin_token_not_for_any_real_use';

let app: FastifyInstance;
let projectId: string;

async function createRun(status: 'queued' | 'running' | 'failed' | 'succeeded' | 'cancelled') {
  const [run] = await app.db
    .insert(agentRunsTable)
    .values({ projectId, workflowName: 'stub', status, triggerDeliveryId: crypto.randomUUID() })
    .returning();
  return run!.id;
}

beforeAll(async () => {
  app = await buildTestApp({ ADMIN_API_TOKEN: ADMIN_TOKEN });
  await app.ready();

  const [project] = await app.db
    .insert(projectsTable)
    .values({
      slug: `admin-test-${crypto.randomUUID()}`,
      name: 'admin test',
      webhookSecretRef: 'UNUSED',
    })
    .returning();
  projectId = project!.id;
});

afterAll(async () => {
  await app.db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  await app.close();
});

describe('admin routes bearer auth', () => {
  it('rejects requests with no Authorization header', async () => {
    const runId = await createRun('failed');
    const res = await app.inject({ method: 'POST', url: `/api/v1/admin/runs/${runId}/retry` });
    expect(res.statusCode).toBe(401);
  });

  it('rejects requests with the wrong token', async () => {
    const runId = await createRun('failed');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/runs/${runId}/retry`,
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a same-length wrong token (exercises the timingSafeEqual path, not just the length guard)', async () => {
    const runId = await createRun('failed');
    const wrongSameLength = ADMIN_TOKEN.slice(0, -1) + (ADMIN_TOKEN.endsWith('x') ? 'y' : 'x');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/runs/${runId}/retry`,
      headers: { authorization: `Bearer ${wrongSameLength}` },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/v1/admin/runs/:id/retry', () => {
  it('succeeds only when the run is in failed status', async () => {
    const runId = await createRun('failed');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/runs/${runId}/retry`,
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);

    const run = await app.db.query.agentRunsTable.findFirst({
      where: eq(agentRunsTable.id, runId),
    });
    expect(run?.status).toBe('queued');
  });

  it('rejects retry from a non-failed status', async () => {
    const runId = await createRun('succeeded');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/runs/${runId}/retry`,
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('POST /api/v1/admin/runs/:id/cancel', () => {
  it('cancels immediately from queued', async () => {
    const runId = await createRun('queued');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/runs/${runId}/cancel`,
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const run = await app.db.query.agentRunsTable.findFirst({
      where: eq(agentRunsTable.id, runId),
    });
    expect(run?.status).toBe('cancelled');
  });

  it('sets the cancellation flag from running (does not immediately mark cancelled)', async () => {
    const runId = await createRun('running');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/runs/${runId}/cancel`,
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(res.statusCode).toBe(202);
    const run = await app.db.query.agentRunsTable.findFirst({
      where: eq(agentRunsTable.id, runId),
    });
    expect(run?.cancellationRequested).toBe(true);
    expect(run?.status).toBe('running');
  });

  it('rejects cancel on an already-finished run', async () => {
    const runId = await createRun('succeeded');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/runs/${runId}/cancel`,
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(res.statusCode).toBe(409);
  });
});
