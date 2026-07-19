import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../src/config/index.js';

const OPENAI_MARKER = Symbol('openai-generator-stub');
const OPENCODE_MARKER = Symbol('opencode-generator-stub');

vi.mock('../../src/modules/ai/openai-generator.js', () => ({
  createOpenAiGenerator: vi.fn(() => ({
    marker: OPENAI_MARKER,
    analyseChanges: vi.fn(),
    planTests: vi.fn(),
    generateTests: vi.fn(),
  })),
}));

vi.mock('../../src/modules/ai/opencode-generator.js', () => ({
  createOpencodeGenerator: vi.fn(() => ({
    marker: OPENCODE_MARKER,
    analyseChanges: vi.fn(),
    planTests: vi.fn(),
    generateTests: vi.fn(),
  })),
}));

const { createAiGenerator } = await import('../../src/modules/ai/generator.js');
const { createOpenAiGenerator } = await import('../../src/modules/ai/openai-generator.js');
const { createOpencodeGenerator } = await import('../../src/modules/ai/opencode-generator.js');

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
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns a generator for the fake provider', () => {
    const generator = createAiGenerator(baseConfig({ AI_PROVIDER: 'fake' }));
    expect(typeof generator.analyseChanges).toBe('function');
    expect(createOpenAiGenerator).not.toHaveBeenCalled();
    expect(createOpencodeGenerator).not.toHaveBeenCalled();
  });

  it('returns a generator for the openai provider', () => {
    const generator = createAiGenerator(
      baseConfig({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test' }),
    );
    expect(createOpenAiGenerator).toHaveBeenCalled();
    expect(createOpencodeGenerator).not.toHaveBeenCalled();
    expect((generator as unknown as { marker: symbol }).marker).toBe(OPENAI_MARKER);
  });

  it('returns a generator for the opencode provider', () => {
    const generator = createAiGenerator(baseConfig({ AI_PROVIDER: 'opencode' }));
    expect(createOpencodeGenerator).toHaveBeenCalled();
    expect(createOpenAiGenerator).not.toHaveBeenCalled();
    expect((generator as unknown as { marker: symbol }).marker).toBe(OPENCODE_MARKER);
  });

  it('returns a generator for the deepseek provider using the openai adapter', () => {
    const generator = createAiGenerator(
      baseConfig({ AI_PROVIDER: 'deepseek', OPENAI_API_KEY: 'sk-test' }),
    );
    expect(createOpenAiGenerator).toHaveBeenCalled();
    expect((generator as unknown as { marker: symbol }).marker).toBe(OPENAI_MARKER);
  });
});
