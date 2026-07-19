import type { AppConfig } from '../../config/index.js';
import type { SourceContext } from '../scm/source-context.js';
import type { ChangeAnalysis, GeneratedSpec, TestPlan } from './schemas.js';
import { createFakeGenerator } from './fake-generator.js';
import { createOpenAiGenerator } from './openai-generator.js';

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
  generateTests(
    context: SourceContext,
    analysis: ChangeAnalysis,
    plan: TestPlan,
  ): Promise<AiCallResult<GeneratedSpec>>;
}

export function createAiGenerator(config: AppConfig): AiGenerator {
  switch (config.AI_PROVIDER) {
    case 'openai':
      return createOpenAiGenerator(config);
    case 'opencode':
      // Task 5 replaces this with createOpencodeGenerator(config).
      return createFakeGenerator(config);
    case 'fake':
    default:
      return createFakeGenerator(config);
  }
}
