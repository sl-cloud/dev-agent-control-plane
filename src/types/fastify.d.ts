import type { AppConfig } from '../config/index.js';
import type { DbPool } from '../db/client.js';
import type { Db } from '../db/index.js';
import type PgBoss from 'pg-boss';
import type { FastifyReply, FastifyRequest as FastifyRequestBase } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    appConfig: AppConfig;
    dbPool: DbPool;
    db: Db;
    boss?: PgBoss;
    requireAdminToken: (request: FastifyRequestBase, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}
