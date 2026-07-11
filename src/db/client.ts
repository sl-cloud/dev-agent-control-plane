import pg from 'pg';
import type { AppConfig } from '../config/index.js';

const { Pool } = pg;

export type DbPool = pg.Pool;

export function createDbPool(config: Pick<AppConfig, 'DATABASE_URL'>): DbPool {
  return new Pool({
    connectionString: config.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
}

export async function pingDb(pool: DbPool): Promise<void> {
  await pool.query('SELECT 1');
}
