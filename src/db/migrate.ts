import { existsSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadConfig } from '../config/index.js';
import { createDbPool } from './client.js';

const MIGRATIONS_FOLDER = './migrations';

async function main(): Promise<void> {
  if (!existsSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`)) {
    console.log('no migrations to apply yet: skipping');
    return;
  }

  const config = loadConfig();
  const pool = createDbPool(config);
  const db = drizzle(pool);

  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    console.log('migrations applied successfully');
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('migration failed:', err);
  process.exit(1);
});
