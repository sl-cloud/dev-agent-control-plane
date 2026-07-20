import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { loadConfig } from '../../src/config/index.js';
import { createDbPool, type DbPool } from '../../src/db/client.js';
import { createDb, type Db } from '../../src/db/index.js';
import { agentRunsTable, projectsTable } from '../../src/db/schema.js';
import { buildSourceContext } from '../../src/modules/scm/source-context.js';

// Fallback only; real env vars (e.g. CI's DATABASE_URL) always take
// precedence, same pattern as tests/helpers/build-app.ts.
const TEST_DEFAULTS = {
  DATABASE_URL: `postgres://control_plane:cp_dev_password@localhost:${process.env.DB_HOST_PORT ?? '5432'}/control_plane`,
  PLAYWRIGHT_TARGET_URL: 'http://127.0.0.1:3000',
  ADMIN_API_TOKEN: 'x'.repeat(20),
};

let pool: DbPool;
let db: Db;
let projectId: string;

// commitSha is left empty so buildSourceContext short-circuits before ever
// invoking git, keeping this test network-free while still exercising the
// baseSha/repositoryUrl resolution logic in isolation.
async function createRun(overrideBaseSha: string | null) {
  const [run] = await db
    .insert(agentRunsTable)
    .values({
      projectId,
      workflowName: 'change-analysis',
      status: 'queued',
      triggerDeliveryId: crypto.randomUUID(),
      overrideBaseSha,
    })
    .returning();
  return run!;
}

beforeAll(async () => {
  const config = loadConfig({ ...TEST_DEFAULTS, ...process.env });
  pool = createDbPool(config);
  db = createDb(pool);

  const [project] = await db
    .insert(projectsTable)
    .values({
      slug: `source-context-resolution-test-${crypto.randomUUID()}`,
      name: 'source context resolution test project',
      webhookSecretRef: 'UNUSED',
      lastSuccessfulCommitSha: 'tracked-base-sha',
      repositoryUrl: 'https://github.com/example/repo.git',
    })
    .returning();
  projectId = project!.id;
});

afterAll(async () => {
  await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  await pool.end();
});

describe('buildSourceContext base/repository resolution', () => {
  it('falls back to the project repositoryUrl when no webhook event exists', async () => {
    const run = await createRun(null);
    const context = await buildSourceContext(db, run);
    expect(context.repositoryUrl).toBe('https://github.com/example/repo.git');
  });

  it('uses project.lastSuccessfulCommitSha as the base when no override is set', async () => {
    const run = await createRun(null);
    const context = await buildSourceContext(db, run);
    expect(context.baseSha).toBe('tracked-base-sha');
  });

  it('prefers run.overrideBaseSha over project.lastSuccessfulCommitSha', async () => {
    const run = await createRun('forced-base-sha');
    const context = await buildSourceContext(db, run);
    expect(context.baseSha).toBe('forced-base-sha');
  });
});
