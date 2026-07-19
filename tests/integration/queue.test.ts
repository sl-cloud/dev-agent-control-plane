import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import PgBoss from 'pg-boss';
import { loadConfig } from '../../src/config/index.js';
import { createDbPool, type DbPool } from '../../src/db/client.js';
import { createDb, type Db } from '../../src/db/index.js';
import { agentRunsTable, projectsTable } from '../../src/db/schema.js';
import {
  createBoss,
  enqueueWorkflowRun,
  startWorkflowWorker,
} from '../../src/modules/runs/queue.js';
import { defineWorkflow, resetWorkflowRegistry } from '../../src/modules/runs/workflow-runner.js';

// Fallback only; real env vars (e.g. CI's DATABASE_URL) always take
// precedence, same pattern as tests/helpers/build-app.ts.
const TEST_DEFAULTS = {
  DATABASE_URL: `postgres://control_plane:cp_dev_password@localhost:${process.env.DB_HOST_PORT ?? '5432'}/control_plane`,
  PLAYWRIGHT_TARGET_URL: 'http://127.0.0.1:3000',
  ADMIN_API_TOKEN: 'x'.repeat(20),
};

let pool: DbPool;
let db: Db;
let boss: PgBoss;
let projectId: string;

beforeAll(async () => {
  const config = loadConfig({ ...TEST_DEFAULTS, ...process.env });
  pool = createDbPool(config);
  db = createDb(pool);
  boss = await createBoss(config.DATABASE_URL);

  const [project] = await db
    .insert(projectsTable)
    .values({
      slug: `queue-test-${crypto.randomUUID()}`,
      name: 'queue test project',
      webhookSecretRef: 'UNUSED',
    })
    .returning();
  projectId = project!.id;
}, 30_000);

afterAll(async () => {
  await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  await boss.stop({ graceful: false });
  await pool.end();
});

describe('pg-boss workflow queue', () => {
  it('enqueues a job on the api side and the worker consumes it end-to-end', async () => {
    resetWorkflowRegistry();
    let executed = false;
    defineWorkflow('queue-e2e', [
      {
        name: 'noop',
        run: async () => {
          executed = true;
        },
      },
    ]);

    const [run] = await db
      .insert(agentRunsTable)
      .values({
        projectId,
        workflowName: 'queue-e2e',
        triggerDeliveryId: crypto.randomUUID(),
      })
      .returning();

    await startWorkflowWorker(boss, db);
    await enqueueWorkflowRun(boss, run!.id);

    // Poll for completion instead of a fixed sleep: pg-boss delivery isn't
    // instantaneous under CI load.
    const deadline = Date.now() + 15_000;
    let status: string | undefined;
    while (Date.now() < deadline) {
      const updated = await db.query.agentRunsTable.findFirst({
        where: eq(agentRunsTable.id, run!.id),
      });
      status = updated?.status;
      if (status === 'succeeded' || status === 'failed') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    expect(executed).toBe(true);
    expect(status).toBe('succeeded');
  }, 20_000);
});
