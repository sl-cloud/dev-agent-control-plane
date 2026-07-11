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
  createdAt: string;
  updatedAt: string;
}

export interface OverviewResponse {
  projects: ProjectSummary[];
}

export interface RunsResponse {
  runs: RunSummary[];
  page: number;
  pageSize: number;
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
