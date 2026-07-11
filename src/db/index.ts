import { drizzle } from 'drizzle-orm/node-postgres';
import type { DbPool } from './client.js';
import * as schema from './schema.js';

export function createDb(pool: DbPool) {
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDb>;
