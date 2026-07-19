import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { loadConfig } from '../../src/config/index.js';
import { createDbPool, type DbPool } from '../../src/db/client.js';
import { createDb, type Db } from '../../src/db/index.js';
import {
  agentRunsTable,
  aiOperationsTable,
  projectsTable,
  workflowStepsTable,
} from '../../src/db/schema.js';
import {
  defineWorkflow,
  executeRun,
  prepareRetry,
  resetWorkflowRegistry,
} from '../../src/modules/runs/workflow-runner.js';
import { registerChangeAnalysisWorkflow } from '../../src/modules/analysis/workflow.js';
import type { AiGenerator } from '../../src/modules/ai/generator.js';
import type { SourceContext } from '../../src/modules/scm/source-context.js';

// Fallback only; real env vars (e.g. CI's DATABASE_URL) always take
// precedence, same pattern as tests/helpers/build-app.ts.
const TEST_DEFAULTS = {
  DATABASE_URL: `postgres://control_plane:cp_dev_password@localhost:${process.env.DB_HOST_PORT ?? '5432'}/control_plane`,
  ADMIN_API_TOKEN: 'x'.repeat(20),
};

let pool: DbPool;
let db: Db;
let projectId: string;

async function createRun(workflowName: string): Promise<string> {
  const [run] = await db
    .insert(agentRunsTable)
    .values({
      projectId,
      workflowName,
      triggerDeliveryId: crypto.randomUUID(),
    })
    .returning();
  return run!.id;
}

beforeAll(async () => {
  const config = loadConfig({ ...TEST_DEFAULTS, ...process.env });
  pool = createDbPool(config);
  db = createDb(pool);

  const [project] = await db
    .insert(projectsTable)
    .values({
      slug: `workflow-runner-test-${crypto.randomUUID()}`,
      name: 'workflow runner test project',
      webhookSecretRef: 'UNUSED',
    })
    .returning();
  projectId = project!.id;
});

afterAll(async () => {
  await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  await pool.end();
});

beforeEach(() => {
  resetWorkflowRegistry();
});

describe('executeRun', () => {
  it('runs all steps to completion when every step succeeds', async () => {
    const calls: string[] = [];
    defineWorkflow('all-succeed', [
      { name: 'a', run: async () => void calls.push('a') },
      { name: 'b', run: async () => void calls.push('b') },
    ]);
    const runId = await createRun('all-succeed');

    await executeRun(db, runId);

    const run = await db.query.agentRunsTable.findFirst({ where: eq(agentRunsTable.id, runId) });
    expect(run?.status).toBe('succeeded');
    expect(calls).toEqual(['a', 'b']);

    const steps = await db.query.workflowStepsTable.findMany({
      where: eq(workflowStepsTable.runId, runId),
    });
    expect(steps.every((s) => s.status === 'succeeded')).toBe(true);
  });

  it('marks the run failed when a step throws, and stops subsequent steps', async () => {
    const calls: string[] = [];
    defineWorkflow('step-throws', [
      { name: 'a', run: async () => void calls.push('a') },
      {
        name: 'b',
        run: async () => {
          throw new Error('boom');
        },
      },
      { name: 'c', run: async () => void calls.push('c') },
    ]);
    const runId = await createRun('step-throws');

    await executeRun(db, runId);

    const run = await db.query.agentRunsTable.findFirst({ where: eq(agentRunsTable.id, runId) });
    expect(run?.status).toBe('failed');
    expect(calls).toEqual(['a']);

    const stepB = await db.query.workflowStepsTable.findFirst({
      where: eq(workflowStepsTable.runId, runId),
      orderBy: (t, { asc: ascFn }) => ascFn(t.startedAt),
    });
    void stepB;
  });

  it('resumes after a simulated crash, skipping already-succeeded steps', async () => {
    const calls: string[] = [];
    defineWorkflow('resume', [
      { name: 'a', run: async () => void calls.push('a') },
      { name: 'b', run: async () => void calls.push('b') },
    ]);
    const runId = await createRun('resume');

    // Manually pre-insert a succeeded 'a' step, simulating a crash after
    // step a committed but before the run finished, then let pg-boss
    // redelivery call executeRun again.
    await db.insert(workflowStepsTable).values({
      runId,
      stepName: 'a',
      attempt: 1,
      status: 'succeeded',
      startedAt: new Date(),
      finishedAt: new Date(),
    });

    await executeRun(db, runId);

    expect(calls).toEqual(['b']);
    const run = await db.query.agentRunsTable.findFirst({ where: eq(agentRunsTable.id, runId) });
    expect(run?.status).toBe('succeeded');

    const aSteps = await db.query.workflowStepsTable.findMany({
      where: eq(workflowStepsTable.runId, runId),
    });
    expect(aSteps.filter((s) => s.stepName === 'a')).toHaveLength(1);
  });

  it('retry adds a new attempt row and the run returns to succeeded', async () => {
    let shouldFail = true;
    defineWorkflow('retry', [
      {
        name: 'flaky',
        run: async () => {
          if (shouldFail) {
            throw new Error('first attempt fails');
          }
        },
      },
    ]);
    const runId = await createRun('retry');

    await executeRun(db, runId);
    let run = await db.query.agentRunsTable.findFirst({ where: eq(agentRunsTable.id, runId) });
    expect(run?.status).toBe('failed');

    shouldFail = false;
    await prepareRetry(db, runId);
    await executeRun(db, runId);

    run = await db.query.agentRunsTable.findFirst({ where: eq(agentRunsTable.id, runId) });
    expect(run?.status).toBe('succeeded');

    const attempts = await db.query.workflowStepsTable.findMany({
      where: eq(workflowStepsTable.runId, runId),
    });
    expect(attempts.map((a) => a.attempt).sort()).toEqual([1, 2]);
  });

  it('stops before the next step when cancellation is requested mid-run', async () => {
    const calls: string[] = [];
    let runId = '';
    defineWorkflow('cancel', [
      {
        name: 'a',
        run: async () => {
          calls.push('a');
          // Simulate cancellation being requested while step a is running.
          await db
            .update(agentRunsTable)
            .set({ cancellationRequested: true })
            .where(eq(agentRunsTable.id, runId));
        },
      },
      { name: 'b', run: async () => void calls.push('b') },
    ]);
    runId = await createRun('cancel');

    await executeRun(db, runId);

    expect(calls).toEqual(['a']);
    const run = await db.query.agentRunsTable.findFirst({ where: eq(agentRunsTable.id, runId) });
    expect(run?.status).toBe('cancelled');
  });
});

describe('change-analysis workflow', () => {
  it('persists source context, analysis, plan, and AI ledger rows', async () => {
    const sourceContext: SourceContext = {
      projectSlug: 'api-test-gateway',
      repository: 'sl-cloud/api-test-gateway',
      repositoryUrl: 'https://github.com/sl-cloud/api-test-gateway.git',
      branch: 'main',
      commitSha: 'abcdef1234567890',
      baseSha: '1234567890abcdef',
      environment: 'staging',
      ciRunUrl: 'https://example.test/actions/runs/1',
      diffStat: 'src/modules/tasks/service.ts | 2 +-',
      diff: 'diff --git a/src/modules/tasks/service.ts b/src/modules/tasks/service.ts',
      changedFiles: ['src/modules/tasks/service.ts'],
      fileContents: [
        { path: 'src/modules/tasks/service.ts', content: 'export const changed = true;' },
      ],
    };
    const fakeGenerator: AiGenerator = {
      analyseChanges: async () => ({
        output: {
          summary: 'Task service behaviour changed.',
          behaviouralChanges: [
            {
              description: 'Task status validation changed.',
              kind: 'business_rule_changed',
              files: ['src/modules/tasks/service.ts'],
              risk: 'medium',
            },
          ],
          securitySensitive: false,
        },
        usage: { model: 'fake-test', promptTokens: 10, completionTokens: 5, costUsd: 0.000175 },
      }),
      planTests: async () => ({
        output: {
          tests: [
            {
              title: 'rejects invalid task status transition',
              kind: 'business_rule',
              reasoning: 'The changed service owns task status rules.',
              priority: 'must',
              coveredByExisting: false,
            },
          ],
        },
        usage: { model: 'fake-test', promptTokens: 12, completionTokens: 7, costUsd: 0.000235 },
      }),
    };

    registerChangeAnalysisWorkflow(loadConfig({ ...TEST_DEFAULTS, ...process.env }), {
      sourceContextBuilder: async () => sourceContext,
      aiGenerator: fakeGenerator,
    });
    const runId = await createRun('change-analysis');

    await executeRun(db, runId);

    const run = await db.query.agentRunsTable.findFirst({ where: eq(agentRunsTable.id, runId) });
    expect(run?.status).toBe('succeeded');

    const steps = await db.query.workflowStepsTable.findMany({
      where: eq(workflowStepsTable.runId, runId),
      orderBy: (table, { asc }) => asc(table.startedAt),
    });
    expect(steps.map((step) => step.stepName)).toEqual([
      'fetchSource',
      'analyseChanges',
      'planTests',
    ]);
    expect(steps[0]?.output).toMatchObject({ commitSha: 'abcdef1234567890' });
    expect(steps[1]?.output).toMatchObject({ summary: 'Task service behaviour changed.' });
    expect(steps[2]?.output).toMatchObject({
      tests: [{ title: 'rejects invalid task status transition' }],
    });

    const operations = await db.query.aiOperationsTable.findMany({
      where: eq(aiOperationsTable.runId, runId),
    });
    expect(operations.map((operation) => operation.kind).sort()).toEqual([
      'change-analysis',
      'test-planning',
    ]);
  });
});
