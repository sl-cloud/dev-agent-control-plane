import { and, desc, eq } from 'drizzle-orm';
import type { AppConfig } from '../../config/index.js';
import type { Db } from '../../db/index.js';
import { workflowStepsTable } from '../../db/schema.js';
import type { WorkflowStepContext } from '../runs/workflow-runner.js';
import { defineWorkflow } from '../runs/workflow-runner.js';
import { buildSourceContext, type SourceContext } from '../scm/source-context.js';
import { createAiGenerator, type AiGenerator } from '../ai/generator.js';
import { recordAiOperation } from '../ai/ledger.js';
import { ChangeAnalysisSchema, TestPlanSchema, type ChangeAnalysis } from '../ai/schemas.js';

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
}

export function registerChangeAnalysisWorkflow(
  config: AppConfig,
  deps: ChangeAnalysisWorkflowDeps = {},
): void {
  const generator = deps.aiGenerator ?? createAiGenerator(config);
  const sourceContextBuilder =
    deps.sourceContextBuilder ?? ((ctx) => buildSourceContext(ctx.db, ctx.run));

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
  ]);
}
