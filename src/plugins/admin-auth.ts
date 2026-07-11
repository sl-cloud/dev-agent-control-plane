import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '../lib/errors.js';

/**
 * Bearer-token preHandler for admin routes. Compares against
 * ADMIN_API_TOKEN. No admin UI in this stage: retry/cancel are curl-only
 * operations, per the architecture's explicit MVP scope.
 */
export const adminAuthPlugin = fp(async function adminAuthPlugin(
  app: FastifyInstance,
): Promise<void> {
  app.decorate('requireAdminToken', async (request: FastifyRequest, _reply: FastifyReply) => {
    const header = request.headers.authorization;
    const expected = `Bearer ${app.appConfig.ADMIN_API_TOKEN}`;
    if (!header || header !== expected) {
      throw new UnauthorizedError('missing or invalid admin bearer token');
    }
  });
});
