import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { agentRunsTable } from '../../db/schema.js';
import { adminAuthPlugin } from '../../plugins/admin-auth.js';
import { NotFoundError, ConflictError } from '../../lib/errors.js';
import { prepareRetry } from '../runs/workflow-runner.js';
import { enqueueWorkflowRun } from '../runs/queue.js';

// Tighter than the webhook limit: admin calls are low-volume, curl-only
// operations (no UI yet), so a low ceiling bounds bearer-token brute-force
// attempts without affecting legitimate use.
const ADMIN_RATE_LIMIT = { max: 20, timeWindow: '1 minute' };

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  await app.register(adminAuthPlugin);

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
