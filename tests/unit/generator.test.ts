import { describe, expect, it } from 'vitest';
import { createAiGenerator } from '../../src/modules/ai/generator.js';
import type { AppConfig } from '../../src/config/index.js';

function baseConfig(overrides: Partial<AppConfig>): AppConfig {
  return {
    AI_PROVIDER: 'fake',
    AI_MODEL_DEFAULT: 'fake-planner-v1',
    AI_INPUT_COST_PER_MTOK: 5,
    AI_OUTPUT_COST_PER_MTOK: 25,
    ...overrides,
  } as AppConfig;
}

describe('createAiGenerator', () => {
  it('returns a generator for the fake provider', () => {
    const generator = createAiGenerator(baseConfig({ AI_PROVIDER: 'fake' }));
    expect(typeof generator.analyseChanges).toBe('function');
  });

  it('returns a generator for the openai provider', () => {
    const generator = createAiGenerator(
      baseConfig({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test' }),
    );
    expect(typeof generator.analyseChanges).toBe('function');
  });

  it('returns a generator for the opencode provider', () => {
    const generator = createAiGenerator(baseConfig({ AI_PROVIDER: 'opencode' }));
    expect(typeof generator.analyseChanges).toBe('function');
  });
});
