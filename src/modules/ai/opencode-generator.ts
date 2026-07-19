import { execFile as execFileCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
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
  type ChangeAnalysis,
  type GeneratedSpec,
  type TestPlan,
} from './schemas.js';

const EXECUTION_TIMEOUT_MS = 120_000;
const JSON_BLOCK_PATTERN = /```json\s*\n([\s\S]*?)\n```/;

export function extractFinalJsonBlock(text: string): unknown {
  const match = JSON_BLOCK_PATTERN.exec(text);
  if (!match?.[1]) {
    throw new Error('opencode output: no JSON code block found in assistant response');
  }
  return JSON.parse(match[1]);
}

interface OpencodeEvent {
  type?: string;
  role?: string;
  content?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
}

function parseFinalAssistantContent(stdout: string): OpencodeEvent {
  // opencode's `run --format json` emits one JSON object per line for
  // streamed events; a plain single-object stdout (as in tests, and
  // possibly some invocation modes) is also accepted.
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const events: OpencodeEvent[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as OpencodeEvent);
    } catch {
      // Not every line is JSON (opencode may interleave log lines); skip.
    }
  }

  const assistantEvents = events.filter(
    (event) => event.role === 'assistant' && typeof event.content === 'string',
  );
  const final = assistantEvents.at(-1);
  if (!final) {
    throw new Error('opencode output: no assistant message event found');
  }
  return final;
}

type ExecFileFn = typeof execFileCallback;

function execFileAsync(
  execFileImpl: ExecFileFn,
  command: string,
  args: string[],
  options: { timeout: number; maxBuffer: number; env: Record<string, string | undefined> },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFileImpl(command, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(error instanceof Error ? error : new Error('opencode CLI invocation failed'));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function runOpencode(
  execFileImpl: ExecFileFn,
  prompt: string,
): Promise<{ text: string; usage: OpencodeEvent['usage'] | undefined; model: string | undefined }> {
  const { stdout } = await execFileAsync(execFileImpl, 'opencode', ['run', '--format', 'json', prompt], {
    timeout: EXECUTION_TIMEOUT_MS,
    maxBuffer: 2_000_000,
    env: {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    },
  });
  const event = parseFinalAssistantContent(stdout);
  return { text: event.content ?? '', usage: event.usage, model: event.model };
}

export function createOpencodeGenerator(
  config: AppConfig,
  execFileImpl: ExecFileFn = execFileCallback,
  existsSyncImpl: typeof existsSync = existsSync,
): AiGenerator {
  const model = config.AI_MODEL_DEFAULT;

  // Update this path if opencode's documented config directory differs
  // from XDG_DATA_HOME/opencode on the host running this check.
  const credentialPath = join(
    process.env.XDG_DATA_HOME || join(process.env.HOME ?? '', '.local', 'share'),
    'opencode',
  );
  if (!existsSyncImpl(credentialPath)) {
    throw new Error(
      `opencode is not authenticated (expected credentials at ${credentialPath}). Run "opencode auth login".`,
    );
  }

  async function call<T>(
    system: string,
    userContent: string,
    parse: (raw: unknown) => T,
  ): Promise<AiCallResult<T>> {
    const prompt = `${system}\n\n${userContent}`;
    const { text, usage, model: reportedModel } = await runOpencode(execFileImpl, prompt);
    const output = parse(extractFinalJsonBlock(text));

    const promptTokens = usage?.prompt_tokens ?? 0;
    const completionTokens = usage?.completion_tokens ?? 0;

    return {
      output,
      usage: {
        model: reportedModel ?? model,
        promptTokens,
        completionTokens,
        costUsd: calculateCostUsd(config, promptTokens, completionTokens),
      },
    };
  }

  return {
    async analyseChanges(context: SourceContext): Promise<AiCallResult<ChangeAnalysis>> {
      return call(
        changeAnalysisPrompt.system,
        changeAnalysisPrompt.render(context),
        (raw) => ChangeAnalysisSchema.parse(raw),
      );
    },

    async planTests(
      context: SourceContext,
      analysis: ChangeAnalysis,
    ): Promise<AiCallResult<TestPlan>> {
      return call(
        testPlanPrompt.system,
        testPlanPrompt.render(context, analysis),
        (raw) => TestPlanSchema.parse(raw),
      );
    },

    async generateTests(
      context: SourceContext,
      analysis: ChangeAnalysis,
      plan: TestPlan,
    ): Promise<AiCallResult<GeneratedSpec>> {
      return call(
        testGenerationPrompt.system,
        testGenerationPrompt.render(context, analysis, plan),
        (raw) => GeneratedSpecSchema.parse(raw),
      );
    },
  };
}
