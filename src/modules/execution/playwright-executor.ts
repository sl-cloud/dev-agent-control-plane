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
  results?: Array<{
    status?: string;
    error?: { message?: string; stack?: string };
    errors?: Array<{ message?: string; stack?: string }>;
  }>;
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
  const failedResult = test.results?.find(
    (result) => result.error || result.errors?.length || result.status === 'failed',
  );
  const firstStructuredError = failedResult?.errors?.[0];
  const message =
    failedResult?.error?.message ??
    failedResult?.error?.stack ??
    firstStructuredError?.message ??
    firstStructuredError?.stack;
  return message ? message.replace(ANSI_PATTERN, '').slice(0, 2000) : undefined;
}

function normaliseReporterStatus(spec: JsonReporterSpec, test: JsonReporterTest | undefined) {
  const resultStatus = test?.results?.at(-1)?.status;
  const rawStatus = resultStatus ?? test?.status ?? (spec.ok ? 'passed' : 'failed');
  if (rawStatus === 'passed' || rawStatus === 'expected') {
    return 'passed';
  }
  if (rawStatus === 'skipped') {
    return 'skipped';
  }
  return 'failed';
}

function collectResults(suites: JsonReporterSuite[] | undefined): PlaywrightTestResult[] {
  const results: PlaywrightTestResult[] = [];
  for (const suite of suites ?? []) {
    results.push(...collectResults(suite.suites));
    for (const spec of suite.specs ?? []) {
      const test = spec.tests?.[0];
      const status = normaliseReporterStatus(spec, test);
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
  const failed = results.some((result) => result.status === 'failed');
  return {
    passed: !failed,
    failed,
    duration: Math.round(parsed.stats?.duration ?? 0),
    results,
  };
}

function configSource(): string {
  return `import { defineConfig } from '@playwright/test';

const authorization = process.env.PLAYWRIGHT_DEFAULT_AUTHORIZATION;

export default defineConfig({
  reporter: 'json',
  timeout: 30_000,
  globalSetup: './global-setup.ts',
  use: {
    baseURL: process.env.PLAYWRIGHT_TARGET_URL,
    extraHTTPHeaders: authorization ? { authorization } : {},
  },
});
`;
}

function globalSetupSource(): string {
  return `export default async function globalSetup(): Promise<void> {
  const email = process.env.TEST_ADMIN_EMAIL;
  const password = process.env.TEST_ADMIN_PASSWORD;
  if (!email || !password) {
    return;
  }

  const baseURL = process.env.PLAYWRIGHT_TARGET_URL;
  const response = await fetch(\`\${baseURL}/api/v1/auth/login\`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    throw new Error(
      \`admin login preflight failed: POST /api/v1/auth/login returned \${response.status}\`,
    );
  }

  const body = (await response.json()) as { accessToken?: string };
  if (!body.accessToken) {
    throw new Error('admin login preflight failed: response had no accessToken');
  }
}
`;
}

function harnessSource(): string {
  return `import { request as playwrightRequest, test as base } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

export { expect } from '@playwright/test';
export type { APIRequestContext, APIResponse, Page } from '@playwright/test';

export const request = playwrightRequest;

export const test = base.extend<{ request: APIRequestContext }>({
  request: async ({}, use) => {
    const authorization = process.env.PLAYWRIGHT_DEFAULT_AUTHORIZATION;
    const request = await playwrightRequest.newContext({
      baseURL: process.env.PLAYWRIGHT_TARGET_URL,
      extraHTTPHeaders: authorization ? { authorization } : {},
    });
    await use(request);
    await request.dispose();
  },
});
`;
}

function executableSpecSource(specSource: string): string {
  return specSource.replace(/from ['"]@playwright\/test['"]/g, "from './harness'");
}

function defaultAuthorization(
  config: Pick<AppConfig, 'PLAYWRIGHT_BASIC_AUTH_USERNAME' | 'PLAYWRIGHT_BASIC_AUTH_PASSWORD'>,
): string | undefined {
  if (!config.PLAYWRIGHT_BASIC_AUTH_USERNAME || !config.PLAYWRIGHT_BASIC_AUTH_PASSWORD) {
    return undefined;
  }
  return `Basic ${Buffer.from(
    `${config.PLAYWRIGHT_BASIC_AUTH_USERNAME}:${config.PLAYWRIGHT_BASIC_AUTH_PASSWORD}`,
  ).toString('base64')}`;
}

export async function executePlaywrightSpec(
  config: Pick<
    AppConfig,
    | 'PLAYWRIGHT_TARGET_URL'
    | 'PLAYWRIGHT_BASIC_AUTH_USERNAME'
    | 'PLAYWRIGHT_BASIC_AUTH_PASSWORD'
    | 'TEST_ADMIN_EMAIL'
    | 'TEST_ADMIN_PASSWORD'
  >,
  specSource: string,
): Promise<PlaywrightExecutionResult> {
  const dir = await mkdtemp(join(tmpdir(), 'cp-playwright-'));
  try {
    await symlink(nodeModulesPath, join(dir, 'node_modules'), 'dir');
    await writeFile(join(dir, 'generated.spec.ts'), executableSpecSource(specSource), 'utf8');
    await writeFile(join(dir, 'harness.ts'), harnessSource(), 'utf8');
    await writeFile(join(dir, 'playwright.config.ts'), configSource(), 'utf8');
    await writeFile(join(dir, 'global-setup.ts'), globalSetupSource(), 'utf8');

    const env: NodeJS.ProcessEnv = {
      HOME: dir,
      PATH: process.env.PATH,
      PLAYWRIGHT_TARGET_URL: config.PLAYWRIGHT_TARGET_URL,
      PLAYWRIGHT_BROWSERS_PATH: browserPath,
      CI: '1',
    };
    if (config.TEST_ADMIN_EMAIL) {
      env.TEST_ADMIN_EMAIL = config.TEST_ADMIN_EMAIL;
    }
    if (config.TEST_ADMIN_PASSWORD) {
      env.TEST_ADMIN_PASSWORD = config.TEST_ADMIN_PASSWORD;
    }
    const authorization = defaultAuthorization(config);
    if (authorization) {
      env.PLAYWRIGHT_DEFAULT_AUTHORIZATION = authorization;
    }

    const result = await execFileCaptured(
      process.execPath,
      [playwrightCliPath, 'test', '--config', 'playwright.config.ts', '--reporter', 'json'],
      {
        cwd: dir,
        timeout: EXECUTION_TIMEOUT_MS,
        maxBuffer: 2_000_000,
        env,
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
