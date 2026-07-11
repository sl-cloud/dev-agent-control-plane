import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildTestApp } from '../helpers/build-app.js';
import { buildSignedWebhookHeaders } from '../helpers/sign-webhook.js';
import {
  projectsTable,
  webhookEventsTable,
  errorEventsTable,
  agentRunsTable,
} from '../../src/db/schema.js';

const SECRET = 'ingestion_test_secret_1234567890';
const SECRET_ENV_KEY = 'INGESTION_TEST_WEBHOOK_SECRET';

let app: FastifyInstance;
let projectSlug: string;
let projectId: string;

beforeAll(async () => {
  process.env[SECRET_ENV_KEY] = SECRET;
  app = await buildTestApp();
  await app.ready();

  projectSlug = `ingestion-test-${crypto.randomUUID()}`;
  const [project] = await app.db
    .insert(projectsTable)
    .values({ slug: projectSlug, name: 'ingestion test', webhookSecretRef: SECRET_ENV_KEY })
    .returning();
  projectId = project!.id;
});

afterAll(async () => {
  await app.db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  await app.close();
  delete process.env[SECRET_ENV_KEY];
});

function deploymentBody(overrides: Partial<Record<string, string>> = {}) {
  return {
    project: projectSlug,
    event: 'deployment.completed',
    repository: 'owner/api-test-gateway',
    branch: 'main',
    commitSha: 'a'.repeat(40),
    baseSha: '',
    environment: 'staging',
    ciRunUrl: 'https://example.com/run/1',
    deployedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('POST /api/v1/webhooks/github-ci', () => {
  it('creates a run on a new valid delivery, then returns the same runId as a duplicate on redelivery', async () => {
    const body = deploymentBody();
    const rawBody = JSON.stringify(body);
    const deliveryId = crypto.randomUUID();
    const headers = buildSignedWebhookHeaders('deployment.completed', SECRET, rawBody, deliveryId);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/github-ci',
      headers: headers as unknown as Record<string, string>,
      payload: rawBody,
    });
    expect(first.statusCode).toBe(201);
    const firstRunId = first.json<{ runId: string }>().runId;
    expect(firstRunId).toBeTruthy();

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/github-ci',
      headers: headers as unknown as Record<string, string>,
      payload: rawBody,
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json<{ status: string; runId: string }>();
    expect(secondBody.status).toBe('duplicate');
    expect(secondBody.runId).toBe(firstRunId);

    const rows = await app.db.query.webhookEventsTable.findMany({
      where: eq(webhookEventsTable.deliveryId, deliveryId),
    });
    expect(rows).toHaveLength(1);
  });

  it('rejects an invalid signature with 401 and creates no run', async () => {
    const body = deploymentBody();
    const rawBody = JSON.stringify(body);
    const deliveryId = crypto.randomUUID();
    const headers = buildSignedWebhookHeaders(
      'deployment.completed',
      'wrong-secret',
      rawBody,
      deliveryId,
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/github-ci',
      headers: headers as unknown as Record<string, string>,
      payload: rawBody,
    });
    expect(res.statusCode).toBe(401);

    const run = await app.db.query.agentRunsTable.findFirst({
      where: eq(agentRunsTable.triggerDeliveryId, deliveryId),
    });
    expect(run).toBeUndefined();
  });

  it('returns the same 401 for an unknown project slug (does not leak which projects exist)', async () => {
    const body = deploymentBody({ project: `unknown-${crypto.randomUUID()}` });
    const rawBody = JSON.stringify(body);
    const headers = buildSignedWebhookHeaders('deployment.completed', SECRET, rawBody);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/github-ci',
      headers: headers as unknown as Record<string, string>,
      payload: rawBody,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'invalid signature' });
  });
});

describe('POST /api/v1/webhooks/error-report', () => {
  it('happy path creates an error_events row only, no run', async () => {
    const body = {
      project: projectSlug,
      environment: 'staging',
      commitSha: 'b'.repeat(40),
      error: { name: 'Error', message: 'boom', stackSanitised: 'at x' },
      request: { method: 'GET', routePattern: '/x', statusCode: 500, requestId: 'r1' },
      occurredAt: new Date().toISOString(),
    };
    const rawBody = JSON.stringify(body);
    const deliveryId = crypto.randomUUID();
    const headers = buildSignedWebhookHeaders('error.reported', SECRET, rawBody, deliveryId);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/error-report',
      headers: headers as unknown as Record<string, string>,
      payload: rawBody,
    });
    expect(res.statusCode).toBe(201);

    const errorRows = await app.db.query.errorEventsTable.findMany({
      where: eq(errorEventsTable.deliveryId, deliveryId),
    });
    expect(errorRows).toHaveLength(1);

    const runs = await app.db.query.agentRunsTable.findMany({
      where: eq(agentRunsTable.triggerDeliveryId, deliveryId),
    });
    expect(runs).toHaveLength(0);
  });
});
