import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { agentRunsTable, projectsTable } from '../../db/schema.js';
import { adminAuthPlugin } from '../../plugins/admin-auth.js';
import { NotFoundError, ConflictError, ValidationError } from '../../lib/errors.js';
import { prepareRetry } from '../runs/workflow-runner.js';
import { enqueueWorkflowRun } from '../runs/queue.js';

// Tighter than the webhook limit: admin calls are low-volume, curl-only
// operations (no UI yet), so a low ceiling bounds bearer-token brute-force
// attempts without affecting legitimate use.
const ADMIN_RATE_LIMIT = { max: 20, timeWindow: '1 minute' };

interface RerunBody {
  commitSha?: unknown;
  branch?: unknown;
  baseSha?: unknown;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  await app.register(adminAuthPlugin);

  app.post(
    '/projects/:slug/rerun',
    { preHandler: app.requireAdminToken, config: { rateLimit: ADMIN_RATE_LIMIT } },
    async (request) => {
      const { slug } = request.params as { slug: string };
      const body = (request.body ?? {}) as RerunBody;

      if (!isNonEmptyString(body.commitSha)) {
        throw new ValidationError('commitSha is required');
      }
      const commitSha = body.commitSha;
      const branch = isNonEmptyString(body.branch) ? body.branch : 'main';
      const baseSha = isNonEmptyString(body.baseSha) ? body.baseSha : `${commitSha}^`;

      const project = await app.db.query.projectsTable.findFirst({
        where: eq(projectsTable.slug, slug),
      });
      if (!project) {
        throw new NotFoundError(`project not found: ${slug}`);
      }
      if (!project.repositoryUrl) {
        throw new ConflictError(
          `project ${slug} has no known repository yet; at least one real webhook delivery must land before a forced rerun can resolve one`,
        );
      }

      const [run] = await app.db
        .insert(agentRunsTable)
        .values({
          projectId: project.id,
          workflowName: 'change-analysis',
          status: 'queued',
          triggerDeliveryId: `admin-rerun-${randomUUID()}`,
          commitSha,
          branch,
          overrideBaseSha: baseSha,
        })
        .returning();

      if (!run) {
        throw new Error('insert into agent_runs returned no row');
      }

      if (app.boss) {
        await enqueueWorkflowRun(app.boss, run.id);
      }

      return { status: 'queued', runId: run.id };
    },
  );

  app.post(
    '/runs/:id/retry',
    { preHandler: app.requireAdminToken, config: { rateLimit: ADMIN_RATE_LIMIT } },
    async (request) => {
      const { id } = request.params as { id: string };

      const run = await app.db.query.agentRunsTable.findFirst({
        where: eq(agentRunsTable.id, id),
      });
      if (!run) {
        throw new NotFoundError(`run not found: ${id}`);
      }
      if (run.status !== 'failed') {
        throw new ConflictError(`run ${id} is not in 'failed' status (current: ${run.status})`);
      }

      await prepareRetry(app.db, id);
      if (app.boss) {
        await enqueueWorkflowRun(app.boss, id);
      }

      return { status: 'queued', runId: id };
    },
  );

  app.post(
    '/runs/:id/cancel',
    { preHandler: app.requireAdminToken, config: { rateLimit: ADMIN_RATE_LIMIT } },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const run = await app.db.query.agentRunsTable.findFirst({
        where: eq(agentRunsTable.id, id),
      });
      if (!run) {
        throw new NotFoundError(`run not found: ${id}`);
      }

      if (run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled') {
        throw new ConflictError(`run ${id} has already finished (status: ${run.status})`);
      }

      if (run.status === 'queued') {
        await app.db
          .update(agentRunsTable)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(eq(agentRunsTable.id, id));
        return { status: 'cancelled', runId: id };
      }

      // status === 'running': set the flag; the runner checks it between steps.
      await app.db
        .update(agentRunsTable)
        .set({ cancellationRequested: true, updatedAt: new Date() })
        .where(eq(agentRunsTable.id, id));

      return reply.status(202).send({ status: 'cancellation_requested', runId: id });
    },
  );
}
