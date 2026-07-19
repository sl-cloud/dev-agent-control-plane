import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildTestApp } from '../helpers/build-app.js';
import {
  agentRunsTable,
  aiOperationsTable,
  projectsTable,
  workflowStepsTable,
} from '../../src/db/schema.js';

let app: FastifyInstance;
let publicProjectId: string;
let publicProjectSlug: string;
let privateProjectId: string;
let privateProjectSlug: string;
let publicRunId: string;
let privateRunId: string;

beforeAll(async () => {
  app = await buildTestApp();
  await app.ready();

  publicProjectSlug = `dash-public-${crypto.randomUUID()}`;
  privateProjectSlug = `dash-private-${crypto.randomUUID()}`;

  const [publicProject] = await app.db
    .insert(projectsTable)
    .values({
      slug: publicProjectSlug,
      name: 'public project',
      webhookSecretRef: 'SUPER_SECRET_ENV_KEY',
      isPublicOnDashboard: true,
      repositoryUrl: 'https://github.com/sl-cloud/api-test-gateway.git',
    })
    .returning();
  publicProjectId = publicProject!.id;

  const [privateProject] = await app.db
    .insert(projectsTable)
    .values({
      slug: privateProjectSlug,
      name: 'private project',
      webhookSecretRef: 'ANOTHER_SECRET_ENV_KEY',
      isPublicOnDashboard: false,
    })
    .returning();
  privateProjectId = privateProject!.id;

  const [publicRun] = await app.db
    .insert(agentRunsTable)
    .values({
      projectId: publicProjectId,
      workflowName: 'change-analysis',
      status: 'succeeded',
      triggerDeliveryId: crypto.randomUUID(),
      isPublicOnDashboard: true,
      commitSha: 'abcdef1234567890',
      branch: 'main',
    })
    .returning();
  publicRunId = publicRun!.id;

  const [privateRun] = await app.db
    .insert(agentRunsTable)
    .values({
      projectId: privateProjectId,
      workflowName: 'change-analysis',
      status: 'succeeded',
      triggerDeliveryId: crypto.randomUUID(),
      isPublicOnDashboard: true,
    })
    .returning();
  privateRunId = privateRun!.id;

  const [step] = await app.db
    .insert(workflowStepsTable)
    .values({
      runId: publicRunId,
      stepName: 'analyseChanges',
      attempt: 1,
      status: 'succeeded',
      startedAt: new Date(),
      finishedAt: new Date(),
      output: { summary: 'changed safely', securitySensitive: false, behaviouralChanges: [] },
    })
    .returning();

  await app.db.insert(workflowStepsTable).values([
    {
      runId: publicRunId,
      stepName: 'generateTests',
      attempt: 1,
      status: 'succeeded',
      startedAt: new Date(),
      finishedAt: new Date(),
      output: { specSource: "import { test } from '@playwright/test';" },
    },
    {
      runId: publicRunId,
      stepName: 'validateTests',
      attempt: 1,
      status: 'succeeded',
      startedAt: new Date(),
      finishedAt: new Date(),
      output: { valid: true },
    },
    {
      runId: publicRunId,
      stepName: 'executeTests',
      attempt: 1,
      status: 'succeeded',
      startedAt: new Date(),
      finishedAt: new Date(),
      output: { passed: false, failed: true, duration: 12, results: [] },
    },
    {
      runId: publicRunId,
      stepName: 'finaliseReport',
      attempt: 1,
      status: 'succeeded',
      startedAt: new Date(),
      finishedAt: new Date(),
      output: {
        passed: false,
        failed: true,
        passedCount: 0,
        failedCount: 1,
        duration: 12,
        results: [{ title: 'visible failure', status: 'failed', error: 'Expected text' }],
      },
    },
  ]);

  await app.db.insert(aiOperationsTable).values({
    runId: publicRunId,
    stepId: step!.id,
    kind: 'change-analysis',
    model: 'fake-test',
    promptTokens: 10,
    completionTokens: 5,
    costUsd: '0.000175',
  });
});

afterAll(async () => {
  await app.db.delete(aiOperationsTable).where(eq(aiOperationsTable.runId, publicRunId));
  await app.db.delete(workflowStepsTable).where(eq(workflowStepsTable.runId, publicRunId));
  await app.db.delete(agentRunsTable).where(eq(agentRunsTable.projectId, publicProjectId));
  await app.db.delete(agentRunsTable).where(eq(agentRunsTable.projectId, privateProjectId));
  await app.db.delete(projectsTable).where(eq(projectsTable.id, publicProjectId));
  await app.db.delete(projectsTable).where(eq(projectsTable.id, privateProjectId));
  await app.close();
});

describe('GET /api/v1/public/overview', () => {
  it('only includes public projects and only whitelisted fields', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/public/overview' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ projects: Array<Record<string, unknown>> }>();

    const slugs = body.projects.map((p) => p.slug);
    expect(slugs).toContain(publicProjectSlug);
    expect(slugs).not.toContain(privateProjectSlug);

    const raw = JSON.stringify(body);
    expect(raw).not.toContain('webhookSecretRef');
    expect(raw).not.toContain('SUPER_SECRET_ENV_KEY');

    const entry = body.projects.find((p) => p.slug === publicProjectSlug)!;
    expect(Object.keys(entry).sort()).toEqual(['name', 'slug']);
  });
});

describe('GET /api/v1/public/runs', () => {
  it('only includes runs for public projects and only whitelisted fields', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/public/runs' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ runs: Array<Record<string, unknown>> }>();

    const projectSlugs = body.runs.map((r) => r.projectSlug);
    expect(projectSlugs).toContain(publicProjectSlug);
    expect(projectSlugs).not.toContain(privateProjectSlug);

    const raw = JSON.stringify(body);
    expect(raw).not.toContain('webhookSecretRef');
    expect(raw).not.toContain('payload');
    expect(raw).not.toContain('SUPER_SECRET_ENV_KEY');
    expect(raw).not.toContain('ANOTHER_SECRET_ENV_KEY');

    const entry = body.runs.find((r) => r.projectSlug === publicProjectSlug)!;
    expect(Object.keys(entry).sort()).toEqual(
      [
        'branch',
        'commitSha',
        'createdAt',
        'id',
        'projectSlug',
        'repositoryUrl',
        'status',
        'updatedAt',
        'workflowName',
      ].sort(),
    );
    expect(entry.repositoryUrl).toBe('https://github.com/sl-cloud/api-test-gateway.git');
  });

  it('filters by project slug', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/public/runs?project=${publicProjectSlug}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ runs: Array<Record<string, unknown>> }>();
    expect(body.runs.every((r) => r.projectSlug === publicProjectSlug)).toBe(true);
  });

  it('returns an empty list when filtering by a non-public project slug', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/public/runs?project=${privateProjectSlug}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ runs: unknown[] }>();
    expect(body.runs).toEqual([]);
  });
});

describe('GET /api/v1/public/runs/:id', () => {
  it('returns run detail with steps, AI operations, and only whitelisted fields', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/public/runs/' + publicRunId });
    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();

    expect(body.id).toBe(publicRunId);
    expect(body.projectSlug).toBe(publicProjectSlug);
    expect(body.workflowName).toBe('change-analysis');
    expect(body.repositoryUrl).toBe('https://github.com/sl-cloud/api-test-gateway.git');
    expect(Array.isArray(body.steps)).toBe(true);
    expect(Array.isArray(body.aiOperations)).toBe(true);
    expect(body).not.toHaveProperty('totalCostUsd');

    const raw = JSON.stringify(body);
    expect(raw).not.toContain('webhookSecretRef');
    expect(raw).not.toContain('SUPER_SECRET_ENV_KEY');
    expect(raw).not.toContain('triggerDeliveryId');
    expect(raw).not.toContain('costUsd');
    expect(raw).not.toContain('/tmp/cp-playwright-');

    const steps = body.steps as Array<{ name: string; output: unknown }>;
    const report = steps.find((step) => step.name === 'finaliseReport')?.output;
    expect(report).toMatchObject({
      passed: false,
      failed: true,
      passedCount: 0,
      failedCount: 1,
      results: [{ title: 'visible failure', status: 'failed', error: 'Expected text' }],
    });
  });

  it('does not expose runs for non-public projects', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/public/runs/' + privateRunId });
    expect(res.statusCode).toBe(404);
  });
});
