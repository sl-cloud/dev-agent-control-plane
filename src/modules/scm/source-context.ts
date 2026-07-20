import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { and, desc, eq } from 'drizzle-orm';
import { getConfig, type AppConfig } from '../../config/index.js';
import type { Db } from '../../db/index.js';
import {
  acceptedGeneratedTestsTable,
  projectsTable,
  webhookEventsTable,
  type AgentRun,
} from '../../db/schema.js';

const execFileAsync = promisify(execFile);
const MAX_DIFF_BYTES = 80_000;
const MAX_FILE_BYTES = 20_000;
const MAX_CHANGED_FILE_COUNT = 12;
const MAX_CONTRACT_FILE_COUNT = 24;
const MAX_EXISTING_GENERATED_TESTS = 5;
const MAX_OPENAPI_SPEC_BYTES = 60_000;
const OPENAPI_SPEC_FETCH_TIMEOUT_MS = 5_000;

export interface SourceContext {
  projectSlug: string;
  repository: string;
  repositoryUrl: string | null;
  branch: string;
  commitSha: string;
  baseSha: string | null;
  environment: string | null;
  ciRunUrl: string | null;
  diffStat: string;
  diff: string;
  changedFiles: string[];
  fileContents: Array<{ path: string; content: string }>;
  contractFiles: Array<{ path: string; content: string }>;
  openApiSpec: string | null;
  existingGeneratedTests: Array<{
    runId: string;
    commitSha: string | null;
    branch: string | null;
    specSource: string;
    passedCount: number;
    duration: number;
  }>;
}

interface DeploymentPayload {
  project: string | undefined;
  repository: string | undefined;
  branch: string | undefined;
  commitSha: string | undefined;
  baseSha: string | undefined;
  environment: string | undefined;
  ciRunUrl: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parseDeploymentPayload(payload: unknown): DeploymentPayload {
  if (!isRecord(payload)) {
    return {
      project: undefined,
      repository: undefined,
      branch: undefined,
      commitSha: undefined,
      baseSha: undefined,
      environment: undefined,
      ciRunUrl: undefined,
    };
  }
  return {
    project: asString(payload.project),
    repository: asString(payload.repository),
    branch: asString(payload.branch),
    commitSha: asString(payload.commitSha),
    baseSha: asString(payload.baseSha),
    environment: asString(payload.environment),
    ciRunUrl: asString(payload.ciRunUrl),
  };
}

function normaliseRepositoryUrl(repository: string | undefined): string | null {
  if (!repository) {
    return null;
  }
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    return `https://github.com/${repository}.git`;
  }
  const match = repository.match(
    /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\.git)?$/,
  );
  if (match) {
    return `https://github.com/${match[1]}/${match[2]}.git`;
  }
  return null;
}

async function git(cwd: string, args: string[], maxBuffer = MAX_DIFF_BYTES): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: 30_000,
    maxBuffer,
    env: { PATH: process.env.PATH },
  });
  return stdout;
}

function truncate(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.byteLength <= maxBytes) {
    return value;
  }
  return `${buffer.subarray(0, maxBytes).toString('utf8')}\n[truncated]`;
}

function shouldReadFile(path: string): boolean {
  return (
    /\.(ts|tsx|js|jsx|json|yml|yaml|md)$/.test(path) &&
    !path.includes('package-lock.json') &&
    !path.includes('/migrations/')
  );
}

function moduleName(path: string): string | undefined {
  return path.match(/^src\/modules\/([^/]+)\//)?.[1];
}

export function buildContractCandidatePaths(allFiles: string[], changedFiles: string[]): string[] {
  const all = new Set(allFiles);
  const candidates = new Set<string>();
  const changedModules = new Set(changedFiles.map(moduleName).filter(Boolean) as string[]);

  for (const path of [
    'src/app.ts',
    'src/server.ts',
    'src/plugins/auth.ts',
    'src/plugins/docs.ts',
    'src/plugins/error-handler.ts',
  ]) {
    if (all.has(path)) candidates.add(path);
  }

  for (const path of allFiles) {
    if (/src\/modules\/[^/]+\/(routes|schemas)\.(ts|tsx|js|jsx)$/.test(path)) {
      candidates.add(path);
    }
  }

  for (const name of changedModules) {
    for (const leaf of ['routes.ts', 'schemas.ts', 'service.ts', 'policies.ts']) {
      const path = `src/modules/${name}/${leaf}`;
      if (all.has(path)) candidates.add(path);
    }
  }

  return [...candidates].filter(shouldReadFile).slice(0, MAX_CONTRACT_FILE_COUNT);
}

async function readFilesAtCommit(
  cwd: string,
  commitSha: string,
  paths: string[],
): Promise<Array<{ path: string; content: string }>> {
  const files: Array<{ path: string; content: string }> = [];
  for (const path of paths) {
    const content = await git(cwd, ['show', `${commitSha}:${path}`], MAX_FILE_BYTES + 1024).catch(
      () => '',
    );
    if (content) {
      files.push({ path, content: truncate(content, MAX_FILE_BYTES) });
    }
  }
  return files;
}

async function extractGitContext(params: {
  repositoryUrl: string;
  commitSha: string;
  baseSha: string | null;
}): Promise<
  Pick<SourceContext, 'diffStat' | 'diff' | 'changedFiles' | 'fileContents' | 'contractFiles'>
> {
  const dir = await mkdtemp(join(tmpdir(), 'cp-scm-'));
  try {
    await git(dir, ['init', '--quiet']);
    await git(dir, ['remote', 'add', 'origin', params.repositoryUrl]);
    const refs = params.baseSha ? [params.baseSha, params.commitSha] : [params.commitSha];
    await git(dir, ['fetch', '--depth=1', 'origin', ...refs], 120_000);

    const range = params.baseSha
      ? [params.baseSha, params.commitSha]
      : [`${params.commitSha}^`, params.commitSha];
    const diffStat = await git(dir, ['diff', '--stat', ...range]).catch(() => '');
    const diff = await git(dir, ['diff', '--unified=80', ...range]).catch(() => '');
    const changedFilesText = await git(dir, ['diff', '--name-only', ...range]).catch(() => '');
    const changedFiles = changedFilesText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const allFilesText = await git(
      dir,
      ['ls-tree', '-r', '--name-only', params.commitSha],
      160_000,
    ).catch(() => '');
    const allFiles = allFilesText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const fileContents = await readFilesAtCommit(
      dir,
      params.commitSha,
      changedFiles.filter(shouldReadFile).slice(0, MAX_CHANGED_FILE_COUNT),
    );
    const contractFiles = await readFilesAtCommit(
      dir,
      params.commitSha,
      buildContractCandidatePaths(allFiles, changedFiles),
    );

    return {
      diffStat: truncate(diffStat, 8_000),
      diff: truncate(diff, MAX_DIFF_BYTES),
      changedFiles,
      fileContents,
      contractFiles,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function fetchOpenApiSpec(config: AppConfig): Promise<string | null> {
  const url = `${config.PLAYWRIGHT_TARGET_URL.replace(/\/$/, '')}/docs/json`;
  const headers: Record<string, string> = {};
  if (config.PLAYWRIGHT_BASIC_AUTH_USERNAME && config.PLAYWRIGHT_BASIC_AUTH_PASSWORD) {
    const credentials = Buffer.from(
      `${config.PLAYWRIGHT_BASIC_AUTH_USERNAME}:${config.PLAYWRIGHT_BASIC_AUTH_PASSWORD}`,
    ).toString('base64');
    headers.Authorization = `Basic ${credentials}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAPI_SPEC_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      return null;
    }
    const body: unknown = await response.json();
    return truncate(JSON.stringify(body), MAX_OPENAPI_SPEC_BYTES);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function isAncestorCommit(
  repositoryUrl: string,
  ancestorSha: string,
  descendantSha: string,
): Promise<boolean> {
  if (ancestorSha === descendantSha) {
    return true;
  }
  const dir = await mkdtemp(join(tmpdir(), 'cp-scm-anc-'));
  try {
    await git(dir, ['init', '--quiet']);
    await git(dir, ['remote', 'add', 'origin', repositoryUrl]);
    // Full (non-shallow) fetch of the descendant's history: ancestry can only
    // be checked against commits that are actually present locally, and a
    // shallow fetch of each SHA independently would leave them disconnected.
    await git(dir, ['fetch', 'origin', descendantSha], 120_000);
    try {
      await execFileAsync('git', ['merge-base', '--is-ancestor', ancestorSha, descendantSha], {
        cwd: dir,
        timeout: 30_000,
        env: { PATH: process.env.PATH },
      });
      return true;
    } catch {
      return false;
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function buildSourceContext(db: Db, run: AgentRun): Promise<SourceContext> {
  const event = await db.query.webhookEventsTable.findFirst({
    where: and(
      eq(webhookEventsTable.projectId, run.projectId),
      eq(webhookEventsTable.deliveryId, run.triggerDeliveryId),
    ),
  });
  const payload = parseDeploymentPayload(event?.payload);
  const repositoryUrl = normaliseRepositoryUrl(payload.repository);
  const commitSha = payload.commitSha ?? run.commitSha ?? '';
  const project = await db.query.projectsTable.findFirst({
    where: eq(projectsTable.id, run.projectId),
  });
  // Prefer the last commit this project's analysis actually completed
  // against over the deploy workflow's HEAD~1 guess, which is wrong
  // whenever deploys are batched, skipped, rolled back, or a merge commit
  // lands. Fall back to the webhook-supplied baseSha only when no prior
  // successful run has recorded one yet (first-ever run for the project).
  const baseSha = project?.lastSuccessfulCommitSha || payload.baseSha || null;

  const [gitContext, openApiSpec, existingGeneratedTests] = await Promise.all([
    repositoryUrl && commitSha
      ? extractGitContext({ repositoryUrl, commitSha, baseSha })
      : Promise.resolve({
          diffStat: '',
          diff: '',
          changedFiles: [],
          fileContents: [],
          contractFiles: [],
        }),
    fetchOpenApiSpec(getConfig()),
    db.query.acceptedGeneratedTestsTable.findMany({
      where: eq(acceptedGeneratedTestsTable.projectId, run.projectId),
      orderBy: [desc(acceptedGeneratedTestsTable.createdAt)],
      limit: MAX_EXISTING_GENERATED_TESTS,
    }),
  ]);

  return {
    projectSlug: payload.project ?? 'unknown',
    repository: payload.repository ?? 'unknown',
    repositoryUrl,
    branch: payload.branch ?? run.branch ?? 'unknown',
    commitSha,
    baseSha,
    environment: payload.environment ?? null,
    ciRunUrl: payload.ciRunUrl ?? null,
    ...gitContext,
    openApiSpec,
    existingGeneratedTests: existingGeneratedTests.map((test) => ({
      runId: test.runId,
      commitSha: test.commitSha,
      branch: test.branch,
      specSource: test.specSource,
      passedCount: test.passedCount,
      duration: test.duration,
    })),
  };
}
