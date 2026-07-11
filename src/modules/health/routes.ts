import type { FastifyInstance } from 'fastify';
import { pingDb } from '../../db/client.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health/live', async () => {
    return { status: 'ok' as const, commitSha: app.appConfig.COMMIT_SHA };
  });

  app.get('/health/ready', async (_request, reply) => {
    try {
      await pingDb(app.dbPool);
      return { status: 'ok' as const, commitSha: app.appConfig.COMMIT_SHA };
    } catch (err) {
      app.log.error({ err }, 'readiness check failed: database unreachable');
      return reply.status(503).send({
        status: 'unavailable' as const,
        reason: 'database_unreachable',
      });
    }
  });
}
