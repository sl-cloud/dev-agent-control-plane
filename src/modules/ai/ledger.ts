import type { Db } from '../../db/index.js';
import { aiOperationsTable } from '../../db/schema.js';
import type { AiOperationUsage } from './generator.js';

export async function recordAiOperation(params: {
  db: Db;
  runId: string;
  stepId: string;
  kind: string;
  usage: AiOperationUsage;
}): Promise<void> {
  await params.db.insert(aiOperationsTable).values({
    runId: params.runId,
    stepId: params.stepId,
    kind: params.kind,
    model: params.usage.model,
    promptTokens: params.usage.promptTokens,
    completionTokens: params.usage.completionTokens,
    costUsd: params.usage.costUsd.toFixed(6),
  });
}
