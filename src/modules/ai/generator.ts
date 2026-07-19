import type { AppConfig } from '../../config/index.js';
import type { SourceContext } from '../scm/source-context.js';
import type { ChangeAnalysis, TestPlan } from './schemas.js';
import { createFakeGenerator } from './fake-generator.js';

export interface AiOperationUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

export interface AiCallResult<T> {
  output: T;
  usage: AiOperationUsage;
}

export interface AiGenerator {
  analyseChanges(context: SourceContext): Promise<AiCallResult<ChangeAnalysis>>;
  planTests(context: SourceContext, analysis: ChangeAnalysis): Promise<AiCallResult<TestPlan>>;
}

export function createAiGenerator(config: AppConfig): AiGenerator {
  return createFakeGenerator(config);
}
