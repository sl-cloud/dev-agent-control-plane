import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/index.js';

/**
 * Test-only defaults. These deliberately target `localhost` and the
 * *published* DB port, not the compose service name `db`, because
 * integration tests run as a host process, not inside the app container.
 * Real env vars always take precedence: these are fallbacks only.
 */
const TEST_DEFAULTS = {
  NODE_ENV: 'test',
  DATABASE_URL: `postgres://control_plane:cp_dev_password@localhost:${process.env.DB_HOST_PORT ?? '5432'}/control_plane`,
  PLAYWRIGHT_TARGET_URL: 'http://127.0.0.1:3000',
  ADMIN_API_TOKEN: 'test_only_admin_token_not_for_any_real_use',
  LOG_LEVEL: 'silent',
} as const;

/**
 * Builds an app instance for integration tests, wired to a real database.
 * No pg-boss instance is attached by default (app.boss stays undefined), so
 * ingestion routes still create agent_runs rows but skip enqueueing; tests
 * that need queue behavior pass a boss explicitly via buildTestApp's second
 * argument.
 */
export async function buildTestApp(
  overrides: Record<string, string> = {},
): Promise<FastifyInstance> {
  const config = loadConfig({ ...TEST_DEFAULTS, ...process.env, ...overrides });

  return buildApp({ config });
}
