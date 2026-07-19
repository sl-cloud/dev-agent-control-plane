import { timingSafeEqual } from 'node:crypto';
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '../lib/errors.js';

function tokenMatches(header: string | undefined, expected: string): boolean {
  if (!header) {
    return false;
  }
  const headerBuf = Buffer.from(header);
  const expectedBuf = Buffer.from(expected);
  if (headerBuf.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(headerBuf, expectedBuf);
}

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
    if (!tokenMatches(header, expected)) {
      throw new UnauthorizedError('missing or invalid admin bearer token');
    }
  });
});
