import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config/index.js';
import { buildLoggerOptions } from './lib/logger.js';
import { generateRequestId } from './lib/request-id.js';
import { createDbPool, type DbPool } from './db/client.js';
import { createDb } from './db/index.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { healthRoutes } from './modules/health/routes.js';
import { ingestionRoutes } from './modules/ingestion/routes.js';
import { adminRoutes } from './modules/admin/routes.js';
import { dashboardApiRoutes } from './modules/dashboard-api/routes.js';
import type PgBoss from 'pg-boss';

export interface BuildAppOptions {
  config: AppConfig;
  /** Injectable for tests (e.g. a pool pointed at a test database). */
  dbPool?: DbPool;
  /** Injectable for tests / the api entrypoint enqueues through this. */
  boss?: PgBoss;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = options;

  const app = Fastify({
    logger: buildLoggerOptions(config),
    genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? generateRequestId(),
    requestIdHeader: 'x-request-id',
  });

  const dbPool = options.dbPool ?? createDbPool(config);

  app.decorate('appConfig', config);
  app.decorate('dbPool', dbPool);
  app.decorate('db', createDb(dbPool));
  if (options.boss) {
    app.decorate('boss', options.boss);
  }

  // Capture the raw request body before JSON parsing: webhook signatures are
  // computed over the exact bytes sent, not a re-serialized JSON string.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    request.rawBody = body as Buffer;
    if (body.length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body.toString('utf8')) as unknown);
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    return payload;
  });

  await app.register(errorHandlerPlugin);
  await app.register(healthRoutes);
  await app.register(ingestionRoutes, { prefix: '/api/v1/webhooks' });
  await app.register(adminRoutes, { prefix: '/api/v1/admin' });
  await app.register(dashboardApiRoutes, { prefix: '/api/v1/public' });

  app.addHook('onClose', async (instance) => {
    await instance.dbPool.end();
  });

  return app;
}
