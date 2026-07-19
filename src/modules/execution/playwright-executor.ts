import { execFile } from 'node:child_process';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import type { AppConfig } from '../../config/index.js';

const EXECUTION_TIMEOUT_MS = 120_000;
const require = createRequire(import.meta.url);
const playwrightCliPath = require.resolve('@playwright/test/cli');
const nodeModulesPath = join(dirname(require.resolve('@playwright/test/package.json')), '..', '..');
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');
const browserPath =
  process.env.PLAYWRIGHT_BROWSERS_PATH ??
  (process.env.HOME ? join(process.env.HOME, '.cache', 'ms-playwright') : undefined);

export interface PlaywrightTestResult {
  title: string;
  status: string;
  error?: string;
}

export interface PlaywrightExecutionResult {
  passed: boolean;
  failed: boolean;
  duration: number;
  results: PlaywrightTestResult[];
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

interface JsonReporterResult {
  stats?: { duration?: number };
  suites?: JsonReporterSuite[];
}

interface JsonReporterSuite {
  title?: string;
  suites?: JsonReporterSuite[];
  specs?: JsonReporterSpec[];
}

interface JsonReporterSpec {
  title?: string;
  ok?: boolean;
  tests?: JsonReporterTest[];
}

interface JsonReporterTest {
  status?: string;
  results?: Array<{ status?: string; error?: { message?: string; stack?: string } }>;
}

function execFileCaptured(file: string, args: string[], options: Parameters<typeof execFile>[2]) {
  return new Promise<ExecResult>((resolve) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      const errorWithCode = error as NodeJS.ErrnoException & {
        code?: number | string;
        killed?: boolean;
        signal?: NodeJS.Signals;
      };
      resolve({
        stdout: typeof stdout === 'string' ? stdout : stdout.toString('utf8'),
        stderr: typeof stderr === 'string' ? stderr : stderr.toString('utf8'),
        exitCode: typeof errorWithCode?.code === 'number' ? errorWithCode.code : error ? 1 : 0,
        timedOut: Boolean(errorWithCode?.killed || errorWithCode?.signal === 'SIGTERM'),
      });
    });
  });
}

function firstError(test: JsonReporterTest): string | undefined {
  const failedResult = test.results?.find((result) => result.error);
  const message = failedResult?.error?.message ?? failedResult?.error?.stack;
  return message ? message.replace(ANSI_PATTERN, '').slice(0, 2000) : undefined;
}

function collectResults(suites: JsonReporterSuite[] | undefined): PlaywrightTestResult[] {
  const results: PlaywrightTestResult[] = [];
  for (const suite of suites ?? []) {
    results.push(...collectResults(suite.suites));
    for (const spec of suite.specs ?? []) {
      const test = spec.tests?.[0];
      const rawStatus = test?.status ?? (spec.ok ? 'passed' : 'failed');
      const status = rawStatus === 'passed' ? 'passed' : 'failed';
      const result: PlaywrightTestResult = { title: spec.title ?? 'untitled test', status };
      const error = test ? firstError(test) : undefined;
      if (error) {
        result.error = error;
      }
      results.push(result);
    }
  }
  return results;
}

function parseReporter(stdout: string): PlaywrightExecutionResult | null {
  const parsed = JSON.parse(stdout) as JsonReporterResult;
  const results = collectResults(parsed.suites);
  const failed = results.some((result) => result.status !== 'passed');
  return {
    passed: !failed,
    failed,
    duration: Math.round(parsed.stats?.duration ?? 0),
    results,
  };
}

function configSource(): string {
  return `import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: 'json',
  timeout: 30_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_TARGET_URL,
  },
});
`;
}

export async function executePlaywrightSpec(
  config: Pick<AppConfig, 'PLAYWRIGHT_TARGET_URL'>,
  specSource: string,
): Promise<PlaywrightExecutionResult> {
  const dir = await mkdtemp(join(tmpdir(), 'cp-playwright-'));
  try {
    await symlink(nodeModulesPath, join(dir, 'node_modules'), 'dir');
    await writeFile(join(dir, 'generated.spec.ts'), specSource, 'utf8');
    await writeFile(join(dir, 'playwright.config.ts'), configSource(), 'utf8');

    const result = await execFileCaptured(
      process.execPath,
      [playwrightCliPath, 'test', '--config', 'playwright.config.ts', '--reporter', 'json'],
      {
        cwd: dir,
        timeout: EXECUTION_TIMEOUT_MS,
        maxBuffer: 2_000_000,
        env: {
          HOME: dir,
          PATH: process.env.PATH,
          PLAYWRIGHT_TARGET_URL: config.PLAYWRIGHT_TARGET_URL,
          PLAYWRIGHT_BROWSERS_PATH: browserPath,
          CI: '1',
        },
      },
    );

    if (result.timedOut) {
      throw new Error('Playwright execution timed out');
    }

    try {
      const parsed = parseReporter(result.stdout);
      if (parsed) {
        return parsed;
      }
    } catch {
      if (result.exitCode === 0) {
        throw new Error('Playwright JSON reporter output could not be parsed');
      }
    }

    throw new Error(
      `Playwright runner failed before producing JSON output: ${result.stderr.slice(0, 2000)}`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
