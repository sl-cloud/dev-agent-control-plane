import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { loadConfig } from '../../src/config/index.js';
import { createDbPool, type DbPool } from '../../src/db/client.js';
import { createDb, type Db } from '../../src/db/index.js';
import {
  agentRunsTable,
  acceptedGeneratedTestsTable,
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
import { createFakeGenerator } from '../../src/modules/ai/fake-generator.js';
import type { AiGenerator } from '../../src/modules/ai/generator.js';
import type { SourceContext } from '../../src/modules/scm/source-context.js';

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

function sourceContextFixture(): SourceContext {
  return {
    projectSlug: 'api-test-gateway',
    repository: 'sl-cloud/api-test-gateway',
    repositoryUrl: 'https://github.com/sl-cloud/api-test-gateway.git',
    branch: 'main',
    commitSha: 'abcdef1234567890',
    baseSha: '1234567890abcdef',
    environment: 'staging',
    ciRunUrl: 'https://example.test/actions/runs/1',
    diffStat: 'src/modules/tasks/service.ts | 2 +-\nsrc/modules/tasks/routes.ts | 2 +-',
    diff: 'diff --git a/src/modules/tasks/service.ts b/src/modules/tasks/service.ts',
    changedFiles: ['src/modules/tasks/service.ts', 'src/modules/tasks/routes.ts'],
    fileContents: [
      { path: 'src/modules/tasks/service.ts', content: 'export const changed = true;' },
      { path: 'src/modules/tasks/routes.ts', content: 'export const route = true;' },
    ],
    contractFiles: [
      { path: 'src/modules/tasks/routes.ts', content: "server.get('/api/v1/tasks/:id')" },
    ],
    existingGeneratedTests: [],
  };
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
  it('persists source context, generated spec, execution report, and AI ledger rows', async () => {
    const sourceContext = sourceContextFixture();
    const config = loadConfig({ ...TEST_DEFAULTS, ...process.env });

    registerChangeAnalysisWorkflow(config, {
      sourceContextBuilder: async () => sourceContext,
      aiGenerator: createFakeGenerator(config),
      testExecutor: async () => ({
        passed: true,
        failed: false,
        duration: 42,
        results: [{ title: 'generated smoke test', status: 'passed' }],
      }),
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
      'generateTests',
      'validateTests',
      'executeTests',
      'repairTests',
      'finaliseReport',
      'persistAcceptedTests',
    ]);

    const plan = steps.find((step) => step.stepName === 'planTests')?.output as {
      tests: unknown[];
    };
    const generated = steps.find((step) => step.stepName === 'generateTests')?.output as {
      specSource: string;
    };
    expect(generated.specSource.match(/\btest\s*\(/g)).toHaveLength(plan.tests.length);
    expect(steps.find((step) => step.stepName === 'validateTests')?.output).toEqual({
      valid: true,
    });
    expect(steps.find((step) => step.stepName === 'executeTests')?.output).toMatchObject({
      passed: true,
      failed: false,
    });
    expect(steps.find((step) => step.stepName === 'repairTests')?.output).toMatchObject({
      attempts: [],
      stopReason: 'original_passed',
    });
    expect(steps.find((step) => step.stepName === 'finaliseReport')?.output).toMatchObject({
      passed: true,
      failed: false,
      passedCount: 1,
      failedCount: 0,
      repaired: false,
    });
    expect(steps.find((step) => step.stepName === 'persistAcceptedTests')?.output).toMatchObject({
      persisted: true,
      source: 'original',
      passedCount: 1,
    });

    const operations = await db.query.aiOperationsTable.findMany({
      where: eq(aiOperationsTable.runId, runId),
    });
    expect(operations.map((operation) => operation.kind).sort()).toEqual([
      'change-analysis',
      'test-generation',
      'test-planning',
    ]);

    const accepted = await db.query.acceptedGeneratedTestsTable.findMany({
      where: eq(acceptedGeneratedTestsTable.runId, runId),
    });
    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.specSource).toBe(generated.specSource);
  });

  it('repairs a generated-test failure and persists the repaired passing spec', async () => {
    const sourceContext = sourceContextFixture();
    const config = loadConfig({ ...TEST_DEFAULTS, ...process.env });
    const usage = { model: 'test-model', promptTokens: 1, completionTokens: 1, costUsd: 0 };
    const generator: AiGenerator = {
      async analyseChanges() {
        return {
          output: { summary: 'summary', behaviouralChanges: [], securitySensitive: false },
          usage,
        };
      },
      async planTests() {
        return {
          output: {
            tests: [
              {
                title: 'repairable test',
                kind: 'regression',
                reasoning: 'prove repair loop',
                priority: 'must',
                coveredByExisting: false,
              },
            ],
          },
          usage,
        };
      },
      async generateTests() {
        return {
          output: {
            specSource:
              "import { test } from '@playwright/test';\ntest('bad generated test', async () => {});",
          },
          usage,
        };
      },
      async classifyTestFailure() {
        return {
          output: {
            category: 'generated_test_error',
            repairRecommended: true,
            summary: 'The generated spec assertion is wrong.',
            evidence: ['The route contract does not support the failed assertion.'],
          },
          usage,
        };
      },
      async repairTests() {
        return {
          output: {
            specSource:
              "import { test } from '@playwright/test';\ntest('repaired generated test', async () => {});",
          },
          usage,
        };
      },
    };

    registerChangeAnalysisWorkflow(config, {
      sourceContextBuilder: async () => sourceContext,
      aiGenerator: generator,
      testExecutor: async (specSource) =>
        specSource.includes('repaired')
          ? {
              passed: true,
              failed: false,
              duration: 15,
              results: [{ title: 'repaired generated test', status: 'passed' }],
            }
          : {
              passed: false,
              failed: true,
              duration: 10,
              results: [
                {
                  title: 'bad generated test',
                  status: 'failed',
                  error: 'Expected 200 received 404',
                },
              ],
            },
    });
    const runId = await createRun('change-analysis');

    await executeRun(db, runId);

    const steps = await db.query.workflowStepsTable.findMany({
      where: eq(workflowStepsTable.runId, runId),
    });
    expect(steps.find((step) => step.stepName === 'repairTests')?.output).toMatchObject({
      stopReason: 'repair_succeeded',
      attempts: [expect.objectContaining({ attempt: 1 })],
    });
    expect(steps.find((step) => step.stepName === 'finaliseReport')?.output).toMatchObject({
      passed: true,
      failed: false,
      repaired: true,
      passedCount: 1,
      failedCount: 0,
    });
    expect(steps.find((step) => step.stepName === 'persistAcceptedTests')?.output).toMatchObject({
      persisted: true,
      source: 'repaired',
    });

    const accepted = await db.query.acceptedGeneratedTestsTable.findMany({
      where: eq(acceptedGeneratedTestsTable.runId, runId),
    });
    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.specSource).toContain('repaired generated test');
  });

  it('stops generated-test repairs after five failed attempts', async () => {
    const sourceContext = sourceContextFixture();
    const config = loadConfig({ ...TEST_DEFAULTS, ...process.env });
    const usage = { model: 'test-model', promptTokens: 1, completionTokens: 1, costUsd: 0 };
    let repairCalls = 0;
    const generator: AiGenerator = {
      async analyseChanges() {
        return {
          output: { summary: 'summary', behaviouralChanges: [], securitySensitive: false },
          usage,
        };
      },
      async planTests() {
        return { output: { tests: [] }, usage };
      },
      async generateTests() {
        return {
          output: {
            specSource:
              "import { test } from '@playwright/test';\ntest('still failing', async () => {});",
          },
          usage,
        };
      },
      async classifyTestFailure() {
        return {
          output: {
            category: 'generated_test_error',
            repairRecommended: true,
            summary: 'The generated spec is still wrong.',
            evidence: ['The assertion still contradicts the contract.'],
          },
          usage,
        };
      },
      async repairTests() {
        repairCalls += 1;
        return {
          output: {
            specSource: `import { test } from '@playwright/test';\ntest('still failing ${repairCalls}', async () => {});`,
          },
          usage,
        };
      },
    };
    const executions: string[] = [];

    registerChangeAnalysisWorkflow(config, {
      sourceContextBuilder: async () => sourceContext,
      aiGenerator: generator,
      testExecutor: async (specSource) => {
        executions.push(specSource);
        return {
          passed: false,
          failed: true,
          duration: 10,
          results: [
            {
              title: 'still failing',
              status: 'failed',
              error: 'Expected 200 received 404',
            },
          ],
        };
      },
    });
    const runId = await createRun('change-analysis');

    await executeRun(db, runId);

    const steps = await db.query.workflowStepsTable.findMany({
      where: eq(workflowStepsTable.runId, runId),
    });
    const repairOutput = steps.find((step) => step.stepName === 'repairTests')?.output as
      { stopReason?: string; attempts?: Array<{ attempt?: number }> } | undefined;
    expect(repairOutput?.stopReason).toBe('max_attempts_reached');
    expect(repairOutput?.attempts?.map((attempt) => attempt.attempt)).toContain(5);
    expect(steps.find((step) => step.stepName === 'finaliseReport')?.output).toMatchObject({
      passed: false,
      failed: true,
      repaired: false,
      failedCount: 1,
    });
    expect(steps.find((step) => step.stepName === 'persistAcceptedTests')?.output).toMatchObject({
      persisted: false,
    });
    expect(repairCalls).toBe(5);
    expect(executions).toHaveLength(6);
  });
});
