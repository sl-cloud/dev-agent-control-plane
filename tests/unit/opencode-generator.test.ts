import { describe, expect, it, vi } from 'vitest';
import {
  createOpencodeGenerator,
  extractFinalJsonBlock,
} from '../../src/modules/ai/opencode-generator.js';
import type { AppConfig } from '../../src/config/index.js';
import type { SourceContext } from '../../src/modules/scm/source-context.js';

const config = {
  AI_MODEL_DEFAULT: 'opencode-default',
  AI_INPUT_COST_PER_MTOK: 5,
  AI_OUTPUT_COST_PER_MTOK: 25,
} as unknown as AppConfig;

const sourceContext: SourceContext = {
  projectSlug: 'demo',
  repository: 'owner/repo',
  repositoryUrl: null,
  branch: 'main',
  commitSha: 'abc1234',
  baseSha: 'def5678',
  environment: null,
  ciRunUrl: null,
  diff: '',
  diffStat: '',
  changedFiles: [],
  fileContents: [],
  contractFiles: [],
  openApiSpec: null,
  existingGeneratedTests: [],
};

describe('extractFinalJsonBlock', () => {
  it('extracts a fenced json block from event-stream text', () => {
    const text =
      'Here is the result:\n```json\n{"summary":"ok","behaviouralChanges":[],"securitySensitive":false}\n```\nDone.';
    const parsed = extractFinalJsonBlock(text);
    expect(parsed).toEqual({ summary: 'ok', behaviouralChanges: [], securitySensitive: false });
  });

  it('throws when no json block is present', () => {
    expect(() => extractFinalJsonBlock('no json here')).toThrow(/no JSON code block found/);
  });
});

describe('createOpencodeGenerator', () => {
  it('analyseChanges parses the final assistant text and zero-fills usage', async () => {
    const stdout = JSON.stringify({
      type: 'message',
      role: 'assistant',
      content: '```json\n{"summary":"ok","behaviouralChanges":[],"securitySensitive":false}\n```',
    });
    const execFileImpl = vi.fn(
      (
        _cmd: string,
        _args: readonly string[],
        _opts: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(null, stdout, '');
      },
    ) as unknown as typeof import('node:child_process').execFile;

    const existsSyncImpl = vi.fn(() => true);

    const generator = createOpencodeGenerator(config, execFileImpl, existsSyncImpl);
    const result = await generator.analyseChanges(sourceContext);

    expect(result.output.summary).toBe('ok');
    expect(result.usage.promptTokens).toBe(0);
    expect(result.usage.completionTokens).toBe(0);
    expect(result.usage.costUsd).toBe(0);
    expect(result.usage.model).toBe('opencode-default');
  });

  it('throws a clear error when the CLI produces no parseable JSON', async () => {
    const execFileImpl = vi.fn(
      (
        _cmd: string,
        _args: readonly string[],
        _opts: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(null, 'not json at all', '');
      },
    ) as unknown as typeof import('node:child_process').execFile;
    const existsSyncImpl = vi.fn(() => true);

    const generator = createOpencodeGenerator(config, execFileImpl, existsSyncImpl);
    await expect(generator.analyseChanges(sourceContext)).rejects.toThrow();
  });

  it('rejects with a clear message when opencode credentials directory is absent', () => {
    const execFileImpl = vi.fn() as unknown as typeof import('node:child_process').execFile;
    const existsSyncImpl = vi.fn(() => false);

    expect(() => createOpencodeGenerator(config, execFileImpl, existsSyncImpl)).toThrow(
      /opencode is not authenticated/,
    );
    expect(execFileImpl).not.toHaveBeenCalled();
  });
});
