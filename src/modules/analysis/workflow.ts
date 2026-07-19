import { and, desc, eq } from 'drizzle-orm';
import type { AppConfig } from '../../config/index.js';
import type { Db } from '../../db/index.js';
import { acceptedGeneratedTestsTable, projectsTable, workflowStepsTable } from '../../db/schema.js';
import type { WorkflowStepContext } from '../runs/workflow-runner.js';
import { defineWorkflow } from '../runs/workflow-runner.js';
import { buildSourceContext, isAncestorCommit, type SourceContext } from '../scm/source-context.js';
import { createAiGenerator, type AiGenerator } from '../ai/generator.js';
import { recordAiOperation } from '../ai/ledger.js';
import {
  ChangeAnalysisSchema,
  GeneratedSpecSchema,
  TestPlanSchema,
  type ChangeAnalysis,
  type GeneratedSpec,
  type TestPlan,
} from '../ai/schemas.js';
import {
  executePlaywrightSpec,
  type PlaywrightExecutionResult,
} from '../execution/playwright-executor.js';
import { finaliseExecutionReport, type ExecutionReport } from '../execution/report.js';
import { validateGeneratedSpecSource } from '../execution/spec-validator.js';
import { runTestRepairLoop, type TestRepairOutput } from './test-repair.js';

async function loadStepOutput<T>(db: Db, runId: string, stepName: string): Promise<T> {
  const step = await db.query.workflowStepsTable.findFirst({
    where: and(
      eq(workflowStepsTable.runId, runId),
      eq(workflowStepsTable.stepName, stepName),
      eq(workflowStepsTable.status, 'succeeded'),
    ),
    orderBy: [desc(workflowStepsTable.finishedAt)],
  });
  if (!step?.output) {
    throw new Error(`missing output for step ${stepName}`);
  }
  return step.output as T;
}

export interface ChangeAnalysisWorkflowDeps {
  sourceContextBuilder?: (ctx: WorkflowStepContext) => Promise<SourceContext>;
  aiGenerator?: AiGenerator;
  testExecutor?: (specSource: string) => Promise<PlaywrightExecutionResult>;
}

export function registerChangeAnalysisWorkflow(
  config: AppConfig,
  deps: ChangeAnalysisWorkflowDeps = {},
): void {
  const generator = deps.aiGenerator ?? createAiGenerator(config);
  const sourceContextBuilder =
    deps.sourceContextBuilder ?? ((ctx) => buildSourceContext(ctx.db, ctx.run));
  const testExecutor =
    deps.testExecutor ?? ((specSource: string) => executePlaywrightSpec(config, specSource));

  defineWorkflow('change-analysis', [
    {
      name: 'fetchSource',
      run: async (ctx) => sourceContextBuilder(ctx),
    },
    {
      name: 'analyseChanges',
      run: async (ctx) => {
        const sourceContext = await loadStepOutput<SourceContext>(
          ctx.db,
          ctx.run.id,
          'fetchSource',
        );
        const result = await generator.analyseChanges(sourceContext);
        const output = ChangeAnalysisSchema.parse(result.output);
        await recordAiOperation({
          db: ctx.db,
          runId: ctx.run.id,
          stepId: ctx.stepId,
          kind: 'change-analysis',
          usage: result.usage,
        });
        return output;
      },
    },
    {
      name: 'planTests',
      run: async (ctx) => {
        const sourceContext = await loadStepOutput<SourceContext>(
          ctx.db,
          ctx.run.id,
          'fetchSource',
        );
        const analysis = ChangeAnalysisSchema.parse(
          await loadStepOutput<ChangeAnalysis>(ctx.db, ctx.run.id, 'analyseChanges'),
        );
        const result = await generator.planTests(sourceContext, analysis);
        const output = TestPlanSchema.parse(result.output);
        await recordAiOperation({
          db: ctx.db,
          runId: ctx.run.id,
          stepId: ctx.stepId,
          kind: 'test-planning',
          usage: result.usage,
        });
        return output;
      },
    },
    {
      name: 'generateTests',
      run: async (ctx) => {
        const sourceContext = await loadStepOutput<SourceContext>(
          ctx.db,
          ctx.run.id,
          'fetchSource',
        );
        const analysis = ChangeAnalysisSchema.parse(
          await loadStepOutput<ChangeAnalysis>(ctx.db, ctx.run.id, 'analyseChanges'),
        );
        const plan = TestPlanSchema.parse(
          await loadStepOutput<TestPlan>(ctx.db, ctx.run.id, 'planTests'),
        );
        const result = await generator.generateTests(sourceContext, analysis, plan);
        const output = GeneratedSpecSchema.parse(result.output);
        await recordAiOperation({
          db: ctx.db,
          runId: ctx.run.id,
          stepId: ctx.stepId,
          kind: 'test-generation',
          usage: result.usage,
        });
        return output;
      },
    },
    {
      name: 'validateTests',
      run: async (ctx) => {
        const generated = GeneratedSpecSchema.parse(
          await loadStepOutput<GeneratedSpec>(ctx.db, ctx.run.id, 'generateTests'),
        );
        return validateGeneratedSpecSource(generated.specSource);
      },
    },
    {
      name: 'executeTests',
      run: async (ctx) => {
        const generated = GeneratedSpecSchema.parse(
          await loadStepOutput<GeneratedSpec>(ctx.db, ctx.run.id, 'generateTests'),
        );
        return testExecutor(generated.specSource);
      },
    },
    {
      name: 'repairTests',
      run: async (ctx) => {
        const sourceContext = await loadStepOutput<SourceContext>(
          ctx.db,
          ctx.run.id,
          'fetchSource',
        );
        const analysis = ChangeAnalysisSchema.parse(
          await loadStepOutput<ChangeAnalysis>(ctx.db, ctx.run.id, 'analyseChanges'),
        );
        const plan = TestPlanSchema.parse(
          await loadStepOutput<TestPlan>(ctx.db, ctx.run.id, 'planTests'),
        );
        const generated = GeneratedSpecSchema.parse(
          await loadStepOutput<GeneratedSpec>(ctx.db, ctx.run.id, 'generateTests'),
        );
        const execution = await loadStepOutput<PlaywrightExecutionResult>(
          ctx.db,
          ctx.run.id,
          'executeTests',
        );
        return runTestRepairLoop({
          db: ctx.db,
          runId: ctx.run.id,
          stepId: ctx.stepId,
          generator,
          sourceContext,
          analysis,
          plan,
          generated,
          execution,
          testExecutor,
        });
      },
    },
    {
      name: 'finaliseReport',
      run: async (ctx) => {
        const execution = await loadStepOutput<PlaywrightExecutionResult>(
          ctx.db,
          ctx.run.id,
          'executeTests',
        );
        const repair = await loadStepOutput<TestRepairOutput>(ctx.db, ctx.run.id, 'repairTests');
        return finaliseExecutionReport(execution, repair);
      },
    },
    {
      name: 'rerunAcceptedTests',
      run: async (ctx) => {
        const previouslyAccepted = await ctx.db.query.acceptedGeneratedTestsTable.findMany({
          where: eq(acceptedGeneratedTestsTable.projectId, ctx.run.projectId),
          orderBy: [desc(acceptedGeneratedTestsTable.createdAt)],
        });
        const reruns = [];
        for (const test of previouslyAccepted) {
          const execution = await testExecutor(test.specSource);
          const report = finaliseExecutionReport(execution);
          reruns.push({
            acceptedTestId: test.id,
            commitSha: test.commitSha,
            branch: test.branch,
            passed: report.passed,
            passedCount: report.passedCount,
            failedCount: report.failedCount,
            results: report.results,
          });
        }
        return { reruns };
      },
    },
    {
      name: 'persistAcceptedTests',
      run: async (ctx) => {
        const report = await loadStepOutput<ExecutionReport>(ctx.db, ctx.run.id, 'finaliseReport');
        if (!report.passed) {
          return { persisted: false, reason: 'final report did not pass' };
        }

        const generated = GeneratedSpecSchema.parse(
          await loadStepOutput<GeneratedSpec>(ctx.db, ctx.run.id, 'generateTests'),
        );
        const repair = await loadStepOutput<TestRepairOutput>(ctx.db, ctx.run.id, 'repairTests');
        const specSource = repair.finalSpecSource ?? generated.specSource;
        const [accepted] = await ctx.db
          .insert(acceptedGeneratedTestsTable)
          .values({
            projectId: ctx.run.projectId,
            runId: ctx.run.id,
            commitSha: ctx.run.commitSha,
            branch: ctx.run.branch,
            specSource,
            passedCount: report.passedCount,
            duration: report.duration,
          })
          .returning();

        return {
          persisted: true,
          acceptedTestId: accepted?.id,
          source: repair.finalSpecSource ? 'repaired' : 'original',
          passedCount: report.passedCount,
          duration: report.duration,
        };
      },
    },
    {
      name: 'recordDeploymentBase',
      run: async (ctx) => {
        if (!ctx.run.commitSha) {
          return { updated: false, reason: 'run has no commitSha' };
        }

        const project = await ctx.db.query.projectsTable.findFirst({
          where: eq(projectsTable.id, ctx.run.projectId),
        });
        let repositoryUrl: string | null = project?.repositoryUrl ?? null;
        if (!repositoryUrl) {
          const sourceContext = await loadStepOutput<SourceContext>(
            ctx.db,
            ctx.run.id,
            'fetchSource',
          );
          repositoryUrl = sourceContext.repositoryUrl;
        }

        const currentBase = project?.lastSuccessfulCommitSha ?? null;
        if (currentBase && repositoryUrl) {
          const isDescendant = await isAncestorCommit(
            repositoryUrl,
            currentBase,
            ctx.run.commitSha,
          );
          if (!isDescendant) {
            // This run's commit isn't ahead of the recorded base (an older
            // or diverged commit rerun after a newer one already advanced
            // the base) - advancing lastSuccessfulCommitSha here would make
            // the *next* run diff against the wrong side of history.
            return {
              updated: false,
              reason: 'commit is not a descendant of the current base',
              commitSha: ctx.run.commitSha,
              currentBase,
            };
          }
        }

        await ctx.db
          .update(projectsTable)
          .set({
            lastSuccessfulCommitSha: ctx.run.commitSha,
            ...(repositoryUrl ? { repositoryUrl } : {}),
          })
          .where(eq(projectsTable.id, ctx.run.projectId));
        return { updated: true, commitSha: ctx.run.commitSha };
      },
    },
  ]);
}
