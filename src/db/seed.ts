import { eq } from 'drizzle-orm';
import { loadConfig } from '../config/index.js';
import { createDbPool } from './client.js';
import { createDb } from './index.js';
import { projectsTable } from './schema.js';

const SEED_PROJECTS: Array<{
  slug: string;
  name: string;
  webhookSecretRef: string;
}> = [
  { slug: 'api-test-gateway', name: 'api-test-gateway', webhookSecretRef: 'CP_WEBHOOK_SECRET' },
];

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createDbPool(config);
  const db = createDb(pool);

  try {
    for (const seedProject of SEED_PROJECTS) {
      const existing = await db.query.projectsTable.findFirst({
        where: eq(projectsTable.slug, seedProject.slug),
      });
      if (existing) {
        await db
          .update(projectsTable)
          .set({ name: seedProject.name, webhookSecretRef: seedProject.webhookSecretRef })
          .where(eq(projectsTable.slug, seedProject.slug));
        console.log(`updated: ${seedProject.slug}`);
        continue;
      }
      await db.insert(projectsTable).values(seedProject);
      console.log(`created: ${seedProject.slug}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('seed failed:', err);
  process.exit(1);
});
