import type { AppConfig } from '../../config/index.js';
import type { PlaywrightExecutionResult } from '../execution/playwright-executor.js';
import type { SourceContext } from '../scm/source-context.js';
import type {
  ChangeAnalysis,
  GeneratedSpec,
  TestFailureClassification,
  TestPlan,
} from './schemas.js';
import { createFakeGenerator } from './fake-generator.js';
import { createOpenAiGenerator } from './openai-generator.js';
import { createOpencodeGenerator } from './opencode-generator.js';

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
  classifyTestFailure(params: {
    context: SourceContext;
    analysis: ChangeAnalysis;
    plan: TestPlan;
    spec: GeneratedSpec;
    execution: PlaywrightExecutionResult;
    attempt: number;
  }): Promise<AiCallResult<TestFailureClassification>>;
  repairTests(params: {
    context: SourceContext;
    analysis: ChangeAnalysis;
    plan: TestPlan;
    spec: GeneratedSpec;
    execution: PlaywrightExecutionResult;
    classification: TestFailureClassification;
    attempt: number;
  }): Promise<AiCallResult<GeneratedSpec>>;
}

export function createAiGenerator(config: AppConfig): AiGenerator {
  switch (config.AI_PROVIDER) {
    case 'openai':
      return createOpenAiGenerator(config);
    case 'opencode':
      return createOpencodeGenerator(config);
    case 'deepseek':
      return createOpenAiGenerator(config);
    case 'fake':
    default:
      return createFakeGenerator(config);
  }
}
