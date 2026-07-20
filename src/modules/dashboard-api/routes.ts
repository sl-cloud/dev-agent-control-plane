import { and, asc, count, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  agentRunsTable,
  aiOperationsTable,
  projectsTable,
  workflowStepsTable,
} from '../../db/schema.js';
import { toProjectSummary, toRunDetail, toRunSummary } from './view-models.js';

const PAGE_SIZE = 15;

export async function dashboardApiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/overview', async () => {
    const projects = await app.db.query.projectsTable.findMany({
      where: eq(projectsTable.isPublicOnDashboard, true),
    });

    return { projects: projects.map(toProjectSummary) };
  });

  app.get('/runs/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const run = await app.db.query.agentRunsTable.findFirst({
      where: and(eq(agentRunsTable.id, params.id), eq(agentRunsTable.isPublicOnDashboard, true)),
    });
    if (!run) {
      return reply.status(404).send({ error: 'run not found' });
    }

    const project = await app.db.query.projectsTable.findFirst({
      where: and(eq(projectsTable.id, run.projectId), eq(projectsTable.isPublicOnDashboard, true)),
    });
    if (!project) {
      return reply.status(404).send({ error: 'run not found' });
    }

    const steps = await app.db.query.workflowStepsTable.findMany({
      where: eq(workflowStepsTable.runId, run.id),
      orderBy: [asc(workflowStepsTable.startedAt), asc(workflowStepsTable.attempt)],
    });
    const aiOperations = await app.db.query.aiOperationsTable.findMany({
      where: eq(aiOperationsTable.runId, run.id),
      orderBy: [asc(aiOperationsTable.createdAt)],
    });

    return toRunDetail({
      run,
      projectSlug: project.slug,
      repositoryUrl: project.repositoryUrl,
      steps,
      aiOperations,
    });
  });

  app.get('/runs', async (request, reply) => {
    const query = request.query as { project?: string; page?: string };
    const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
    const offset = (page - 1) * PAGE_SIZE;

    let projectFilter;
    if (query.project) {
      const project = await app.db.query.projectsTable.findFirst({
        where: and(
          eq(projectsTable.slug, query.project),
          eq(projectsTable.isPublicOnDashboard, true),
        ),
      });
      if (!project) {
        return reply.send({ runs: [], page, pageSize: PAGE_SIZE, total: 0 });
      }
      projectFilter = project;
    }

    const projects = await app.db.query.projectsTable.findMany({
      where: eq(projectsTable.isPublicOnDashboard, true),
    });
    const publicProjectIds = new Set(projects.map((p) => p.id));
    const projectById = new Map(projects.map((p) => [p.id, p]));

    const runsWhere = and(
      eq(agentRunsTable.isPublicOnDashboard, true),
      projectFilter ? eq(agentRunsTable.projectId, projectFilter.id) : undefined,
    );

    const runs = await app.db.query.agentRunsTable.findMany({
      where: runsWhere,
      orderBy: [desc(agentRunsTable.createdAt)],
      limit: PAGE_SIZE,
      offset,
    });

    const countRows = await app.db.select({ value: count() }).from(agentRunsTable).where(runsWhere);
    const total = countRows[0]?.value ?? 0;

    const visibleRuns = runs.filter((run) => publicProjectIds.has(run.projectId));

    return {
      runs: visibleRuns.map((run) => {
        const project = projectById.get(run.projectId)!;
        return toRunSummary(run, project.slug, project.repositoryUrl);
      }),
      page,
      pageSize: PAGE_SIZE,
      total,
    };
  });
}
