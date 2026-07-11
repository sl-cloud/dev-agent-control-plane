import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildTestApp } from '../helpers/build-app.js';
import { agentRunsTable, projectsTable } from '../../src/db/schema.js';

let app: FastifyInstance;
let publicProjectId: string;
let publicProjectSlug: string;
let privateProjectId: string;
let privateProjectSlug: string;

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

  await app.db.insert(agentRunsTable).values({
    projectId: publicProjectId,
    workflowName: 'stub',
    status: 'succeeded',
    triggerDeliveryId: crypto.randomUUID(),
    isPublicOnDashboard: true,
  });
  await app.db.insert(agentRunsTable).values({
    projectId: privateProjectId,
    workflowName: 'stub',
    status: 'succeeded',
    triggerDeliveryId: crypto.randomUUID(),
    isPublicOnDashboard: true,
  });
});

afterAll(async () => {
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
        'status',
        'updatedAt',
        'workflowName',
      ].sort(),
    );
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
