import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { agentRunsTable, projectsTable } from '../../db/schema.js';
import { toProjectSummary, toRunSummary } from './view-models.js';

const PAGE_SIZE = 20;

export async function dashboardApiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/overview', async () => {
    const projects = await app.db.query.projectsTable.findMany({
      where: eq(projectsTable.isPublicOnDashboard, true),
    });

    return { projects: projects.map(toProjectSummary) };
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
        return reply.send({ runs: [], page, pageSize: PAGE_SIZE });
      }
      projectFilter = project;
    }

    const projects = await app.db.query.projectsTable.findMany({
      where: eq(projectsTable.isPublicOnDashboard, true),
    });
    const publicProjectIds = new Set(projects.map((p) => p.id));
    const projectById = new Map(projects.map((p) => [p.id, p]));

    const runs = await app.db.query.agentRunsTable.findMany({
      where: and(
        eq(agentRunsTable.isPublicOnDashboard, true),
        projectFilter ? eq(agentRunsTable.projectId, projectFilter.id) : undefined,
      ),
      orderBy: [desc(agentRunsTable.createdAt)],
      limit: PAGE_SIZE,
      offset,
    });

    const visibleRuns = runs.filter((run) => publicProjectIds.has(run.projectId));

    return {
      runs: visibleRuns.map((run) => toRunSummary(run, projectById.get(run.projectId)!.slug)),
      page,
      pageSize: PAGE_SIZE,
    };
  });
}
