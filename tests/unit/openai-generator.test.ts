import { describe, expect, it, vi } from 'vitest';
import { createOpenAiGenerator } from '../../src/modules/ai/openai-generator.js';
import type { AppConfig } from '../../src/config/index.js';
import type { SourceContext } from '../../src/modules/scm/source-context.js';

const config = {
  AI_MODEL_DEFAULT: 'gpt-4o-mini',
  AI_MODEL_CHANGE_ANALYSIS: undefined,
  AI_MODEL_TEST_PLANNING: undefined,
  AI_INPUT_COST_PER_MTOK: 5,
  AI_OUTPUT_COST_PER_MTOK: 25,
  OPENAI_API_KEY: 'sk-test',
} as unknown as AppConfig;

const sourceContext: SourceContext = {
  projectSlug: 'demo',
  repository: 'owner/repo',
  repositoryUrl: 'https://github.com/owner/repo.git',
  branch: 'main',
  commitSha: 'abc1234',
  baseSha: 'def5678',
  environment: null,
  ciRunUrl: null,
  diff: '',
  diffStat: '',
  changedFiles: ['src/routes.ts'],
  fileContents: [],
};

function mockClient(content: unknown) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: JSON.stringify(content) } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
          model: 'gpt-4o-mini',
        }),
      },
    },
  };
}

describe('createOpenAiGenerator', () => {
  it('analyseChanges returns validated output and usage', async () => {
    const client = mockClient({
      summary: 'Changed routes.ts',
      behaviouralChanges: [],
      securitySensitive: false,
    });
    const generator = createOpenAiGenerator(config, client as never);

    const result = await generator.analyseChanges(sourceContext);

    expect(result.output.summary).toBe('Changed routes.ts');
    expect(result.usage.promptTokens).toBe(100);
    expect(result.usage.completionTokens).toBe(50);
    expect(result.usage.costUsd).toBeCloseTo(100 / 1e6 * 5 + 50 / 1e6 * 25, 6);
    expect(result.usage.model).toBe('gpt-4o-mini');
  });

  it('throws when the response fails schema validation', async () => {
    const client = mockClient({ summary: 'missing required fields' });
    const generator = createOpenAiGenerator(config, client as never);

    await expect(generator.analyseChanges(sourceContext)).rejects.toThrow();
  });

  it('generateTests returns spec source', async () => {
    const client = mockClient({ specSource: "import { test } from '@playwright/test';" });
    const generator = createOpenAiGenerator(config, client as never);

    const result = await generator.generateTests(
      sourceContext,
      { summary: '', behaviouralChanges: [], securitySensitive: false },
      { tests: [] },
    );

    expect(result.output.specSource).toContain('@playwright/test');
  });
});

describe('createOpenAiGenerator with deepseek provider', () => {
  const deepseekConfig = {
    ...config,
    AI_PROVIDER: 'deepseek',
    OPENAI_API_KEY: undefined,
    DEEPSEEK_API_KEY: 'sk-deepseek-test',
  } as unknown as AppConfig;

  it('uses json_object response format instead of json_schema', async () => {
    const client = mockClient({
      summary: 'Changed routes.ts',
      behaviouralChanges: [],
      securitySensitive: false,
    });
    const generator = createOpenAiGenerator(deepseekConfig, client as never);

    const result = await generator.analyseChanges(sourceContext);

    expect(client.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: { type: 'json_object' },
      }),
    );
    expect(result.output.summary).toBe('Changed routes.ts');
  });

  it('throws when a deepseek response fails local Zod validation', async () => {
    const client = mockClient({ summary: 'missing required fields' });
    const generator = createOpenAiGenerator(deepseekConfig, client as never);

    await expect(generator.analyseChanges(sourceContext)).rejects.toThrow();
  });
});
