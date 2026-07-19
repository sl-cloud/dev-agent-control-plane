import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import { agentRunsTable, workflowStepsTable, type AgentRun } from '../../db/schema.js';

export interface WorkflowStepContext {
  run: AgentRun;
  db: Db;
  stepId: string;
}

export interface WorkflowStepDefinition {
  name: string;
  run: (ctx: WorkflowStepContext) => Promise<unknown>;
}

export interface WorkflowDefinition {
  name: string;
  steps: WorkflowStepDefinition[];
}

const registry = new Map<string, WorkflowDefinition>();

/** Registers a workflow by name. Re-registering the same name overwrites (test convenience). */
export function defineWorkflow(name: string, steps: WorkflowStepDefinition[]): WorkflowDefinition {
  const workflow: WorkflowDefinition = { name, steps };
  registry.set(name, workflow);
  return workflow;
}

export function getWorkflow(name: string): WorkflowDefinition | undefined {
  return registry.get(name);
}

/** Test-only: clears the registry between test files. */
export function resetWorkflowRegistry(): void {
  registry.clear();
}

class CancelledError extends Error {
  constructor() {
    super('run cancelled');
    this.name = 'CancelledError';
  }
}

async function loadRun(db: Db, runId: string): Promise<AgentRun> {
  const run = await db.query.agentRunsTable.findFirst({ where: eq(agentRunsTable.id, runId) });
  if (!run) {
    throw new Error(`agent_runs row not found: ${runId}`);
  }
  return run;
}

async function nextAttemptFor(db: Db, runId: string, stepName: string): Promise<number> {
  const rows = await db.query.workflowStepsTable.findMany({
    where: and(eq(workflowStepsTable.runId, runId), eq(workflowStepsTable.stepName, stepName)),
  });
  return rows.reduce((max, row) => Math.max(max, row.attempt), 0) + 1;
}

async function latestStepStatus(
  db: Db,
  runId: string,
  stepName: string,
): Promise<'succeeded' | 'other' | 'none'> {
  const rows = await db.query.workflowStepsTable.findMany({
    where: and(eq(workflowStepsTable.runId, runId), eq(workflowStepsTable.stepName, stepName)),
    orderBy: [asc(workflowStepsTable.attempt)],
  });
  if (rows.length === 0) {
    return 'none';
  }
  const last = rows[rows.length - 1]!;
  return last.status === 'succeeded' ? 'succeeded' : 'other';
}

async function isCancellationRequested(db: Db, runId: string): Promise<boolean> {
  const run = await loadRun(db, runId);
  return run.cancellationRequested;
}

/**
 * Executes (or resumes) a run's workflow. Resumes from the first
 * non-succeeded step so pg-boss redelivery after a crash picks up where it
 * left off instead of re-running already-succeeded steps. Checks the
 * cancellation flag between steps. Persists each step attempt's
 * status/timing/output to workflow_steps.
 */
export async function executeRun(db: Db, runId: string): Promise<void> {
  const run = await loadRun(db, runId);
  const workflow = getWorkflow(run.workflowName);
  if (!workflow) {
    throw new Error(`unknown workflow: ${run.workflowName}`);
  }

  await db
    .update(agentRunsTable)
    .set({ status: 'running', updatedAt: new Date() })
    .where(eq(agentRunsTable.id, runId));

  try {
    for (const step of workflow.steps) {
      if (await isCancellationRequested(db, runId)) {
        await db
          .update(agentRunsTable)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(eq(agentRunsTable.id, runId));
        return;
      }

      const priorStatus = await latestStepStatus(db, runId, step.name);
      if (priorStatus === 'succeeded') {
        continue;
      }

      const attempt = await nextAttemptFor(db, runId, step.name);
      const [stepRow] = await db
        .insert(workflowStepsTable)
        .values({ runId, stepName: step.name, attempt, status: 'running', startedAt: new Date() })
        .returning();
      if (!stepRow) {
        throw new Error('insert into workflow_steps returned no row');
      }

      try {
        const output = (await step.run({ run, db, stepId: stepRow.id })) ?? null;
        await db
          .update(workflowStepsTable)
          .set({ status: 'succeeded', finishedAt: new Date(), output })
          .where(eq(workflowStepsTable.id, stepRow.id));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await db
          .update(workflowStepsTable)
          .set({ status: 'failed', finishedAt: new Date(), error: message })
          .where(eq(workflowStepsTable.id, stepRow.id));
        throw err;
      }
    }

    await db
      .update(agentRunsTable)
      .set({ status: 'succeeded', updatedAt: new Date() })
      .where(eq(agentRunsTable.id, runId));
  } catch (err) {
    if (err instanceof CancelledError) {
      return;
    }
    await db
      .update(agentRunsTable)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(agentRunsTable.id, runId));
  }
}

/** Registers a fresh-attempt step and re-queues a failed run for retry (used by the admin retry route). */
export async function prepareRetry(db: Db, runId: string): Promise<void> {
  await db
    .update(agentRunsTable)
    .set({ status: 'queued', cancellationRequested: false, updatedAt: new Date() })
    .where(eq(agentRunsTable.id, runId));
}

export const stubWorkflow = defineWorkflow('stub', [
  {
    name: 'noop',
    run: async () => {
      return { message: 'stub workflow: no-op step executed' };
    },
  },
]);
