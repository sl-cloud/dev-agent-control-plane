import OpenAI from 'openai';
import type { AppConfig } from '../../config/index.js';
import type { SourceContext } from '../scm/source-context.js';
import type { AiCallResult, AiGenerator } from './generator.js';
import { calculateCostUsd } from './cost.js';
import { changeAnalysisPrompt } from './prompts/change-analysis.v1.js';
import { testPlanPrompt } from './prompts/test-plan.v1.js';
import { testGenerationPrompt } from './prompts/test-generation.v1.js';
import {
  ChangeAnalysisSchema,
  TestPlanSchema,
  GeneratedSpecSchema,
  CHANGE_ANALYSIS_JSON_SCHEMA,
  TEST_PLAN_JSON_SCHEMA,
  GENERATED_SPEC_JSON_SCHEMA,
  type ChangeAnalysis,
  type GeneratedSpec,
  type TestPlan,
} from './schemas.js';

type OpenAiClient = Pick<OpenAI, 'chat'>;

async function call<T>(
  client: OpenAiClient,
  model: string,
  system: string,
  userContent: string,
  schemaName: string,
  jsonSchema: Record<string, unknown>,
  parse: (raw: unknown) => T,
  config: AppConfig,
  useJsonObjectMode: boolean,
): Promise<AiCallResult<T>> {
  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: useJsonObjectMode
          ? `${system}\n\nRespond with a single JSON object matching this shape (no markdown, no code fences): ${JSON.stringify(jsonSchema)}`
          : system,
      },
      { role: 'user', content: userContent },
    ],
    response_format: useJsonObjectMode
      ? { type: 'json_object' }
      : { type: 'json_schema', json_schema: { name: schemaName, schema: jsonSchema, strict: true } },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error(`openai response for ${schemaName} had no content`);
  }
  const output = parse(JSON.parse(content));

  const promptTokens = response.usage?.prompt_tokens ?? 0;
  const completionTokens = response.usage?.completion_tokens ?? 0;

  return {
    output,
    usage: {
      model: response.model ?? model,
      promptTokens,
      completionTokens,
      costUsd: calculateCostUsd(config, promptTokens, completionTokens),
    },
  };
}

export function createOpenAiGenerator(config: AppConfig, client?: OpenAiClient): AiGenerator {
  const isDeepseek = config.AI_PROVIDER === 'deepseek';
  const openai: OpenAiClient =
    client ??
    new OpenAI(
      isDeepseek
        ? { apiKey: config.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com' }
        : { apiKey: config.OPENAI_API_KEY },
    );
  const analysisModel = config.AI_MODEL_CHANGE_ANALYSIS ?? config.AI_MODEL_DEFAULT;
  const planningModel = config.AI_MODEL_TEST_PLANNING ?? config.AI_MODEL_DEFAULT;
  const generationModel = config.AI_MODEL_DEFAULT;

  return {
    async analyseChanges(context: SourceContext): Promise<AiCallResult<ChangeAnalysis>> {
      return call(
        openai,
        analysisModel,
        changeAnalysisPrompt.system,
        changeAnalysisPrompt.render(context),
        'change_analysis',
        CHANGE_ANALYSIS_JSON_SCHEMA,
        (raw) => ChangeAnalysisSchema.parse(raw),
        config,
        isDeepseek,
      );
    },

    async planTests(
      context: SourceContext,
      analysis: ChangeAnalysis,
    ): Promise<AiCallResult<TestPlan>> {
      return call(
        openai,
        planningModel,
        testPlanPrompt.system,
        testPlanPrompt.render(context, analysis),
        'test_plan',
        TEST_PLAN_JSON_SCHEMA,
        (raw) => TestPlanSchema.parse(raw),
        config,
        isDeepseek,
      );
    },

    async generateTests(
      context: SourceContext,
      analysis: ChangeAnalysis,
      plan: TestPlan,
    ): Promise<AiCallResult<GeneratedSpec>> {
      return call(
        openai,
        generationModel,
        testGenerationPrompt.system,
        testGenerationPrompt.render(context, analysis, plan),
        'generated_spec',
        GENERATED_SPEC_JSON_SCHEMA,
        (raw) => GeneratedSpecSchema.parse(raw),
        config,
        isDeepseek,
      );
    },
  };
}
