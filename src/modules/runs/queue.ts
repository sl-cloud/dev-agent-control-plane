import PgBoss from 'pg-boss';
import type { Db } from '../../db/index.js';
import { executeRun } from './workflow-runner.js';

export const WORKFLOW_RUN_QUEUE = 'workflow-run';

export interface WorkflowRunJob {
  runId: string;
}

function isRetryableSchemaRaceError(err: unknown): boolean {
  // Both the api and worker processes call createBoss independently at boot
  // and each tries to create the same queue/schema objects; concurrent
  // first-time setup can race into a Postgres deadlock (40P01) or unique
  // violation (23505) on pg-boss's own internal tables. Both are safe to
  // retry once: the losing process just needs to see the winner's committed
  // schema.
  const code =
    typeof err === 'object' && err !== null ? (err as { code?: string }).code : undefined;
  return code === '40P01' || code === '23505';
}

export async function createBoss(databaseUrl: string): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString: databaseUrl });
  await boss.start();

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await boss.createQueue(WORKFLOW_RUN_QUEUE);
      return boss;
    } catch (err) {
      if (!isRetryableSchemaRaceError(err) || attempt === 3) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }

  return boss;
}

/** Enqueues a workflow run job. Called from the api process; never executes the workflow itself. */
export async function enqueueWorkflowRun(boss: PgBoss, runId: string): Promise<void> {
  await boss.send(WORKFLOW_RUN_QUEUE, { runId } satisfies WorkflowRunJob);
}

/** Starts the worker-side consumer: pulls jobs off the queue and executes the workflow run. */
export async function startWorkflowWorker(boss: PgBoss, db: Db): Promise<void> {
  await boss.work<WorkflowRunJob>(WORKFLOW_RUN_QUEUE, async ([job]) => {
    if (!job) {
      return;
    }
    await executeRun(db, job.data.runId);
  });
}
