import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import { webhookEventsTable, type AgentRun } from '../../db/schema.js';

const execFileAsync = promisify(execFile);
const MAX_DIFF_BYTES = 80_000;
const MAX_FILE_BYTES = 20_000;
const MAX_FILE_COUNT = 12;

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

async function extractGitContext(params: {
  repositoryUrl: string;
  commitSha: string;
  baseSha: string | null;
}): Promise<Pick<SourceContext, 'diffStat' | 'diff' | 'changedFiles' | 'fileContents'>> {
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

    const fileContents = [];
    for (const path of changedFiles.filter(shouldReadFile).slice(0, MAX_FILE_COUNT)) {
      const content = await git(
        dir,
        ['show', `${params.commitSha}:${path}`],
        MAX_FILE_BYTES + 1024,
      ).catch(() => '');
      if (content) {
        fileContents.push({ path, content: truncate(content, MAX_FILE_BYTES) });
      }
    }

    return {
      diffStat: truncate(diffStat, 8_000),
      diff: truncate(diff, MAX_DIFF_BYTES),
      changedFiles,
      fileContents,
    };
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
  const baseSha = payload.baseSha || null;

  const gitContext =
    repositoryUrl && commitSha
      ? await extractGitContext({ repositoryUrl, commitSha, baseSha })
      : { diffStat: '', diff: '', changedFiles: [], fileContents: [] };

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
  };
}
