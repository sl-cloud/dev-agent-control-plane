// All requests use relative paths (`/api/...`), never a build-time base
// URL: in dev, Vite's server proxies /api to cp-api; in staging, Caddy
// proxies /api to cp-api from the same origin the SPA is served from. No
// CORS configuration is needed on either side.

export interface ProjectSummary {
  slug: string;
  name: string;
}

export interface RunSummary {
  id: string;
  projectSlug: string;
  workflowName: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  commitSha: string | null;
  branch: string | null;
  repositoryUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStepSummary {
  name: string;
  attempt: number;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  startedAt: string | null;
  finishedAt: string | null;
  output: unknown;
  error: string | null;
}

export interface AiOperationSummary {
  kind: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  createdAt: string;
}

export interface RunDetail extends RunSummary {
  steps: WorkflowStepSummary[];
  aiOperations: AiOperationSummary[];
}

export interface OverviewResponse {
  projects: ProjectSummary[];
}

export interface RunsResponse {
  runs: RunSummary[];
  page: number;
  pageSize: number;
}

export function commitUrl(repositoryUrl: string | null, commitSha: string | null): string | null {
  if (!repositoryUrl || !commitSha) {
    return null;
  }
  return `${repositoryUrl.replace(/\.git$/, '')}/commit/${commitSha}`;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`request to ${path} failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export function fetchOverview(): Promise<OverviewResponse> {
  return getJson<OverviewResponse>('/api/v1/public/overview');
}

export function fetchRuns(params: { project?: string; page?: number } = {}): Promise<RunsResponse> {
  const search = new URLSearchParams();
  if (params.project) {
    search.set('project', params.project);
  }
  if (params.page) {
    search.set('page', String(params.page));
  }
  const qs = search.toString();
  return getJson<RunsResponse>(`/api/v1/public/runs${qs ? `?${qs}` : ''}`);
}

export function fetchRun(id: string): Promise<RunDetail> {
  return getJson<RunDetail>(`/api/v1/public/runs/${id}`);
}
