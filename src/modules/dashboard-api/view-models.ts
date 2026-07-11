import type { AgentRun, Project } from '../../db/schema.js';

// Whitelisted view-model builders: never spread a raw DB row into a
// response. Each field is named explicitly so a future column added to
// `projects` or `agent_runs` (e.g. webhookSecretRef, a future raw payload
// column) cannot leak onto a public endpoint just by being present on the row.

export interface ProjectSummary {
  slug: string;
  name: string;
}

export function toProjectSummary(project: Project): ProjectSummary {
  return {
    slug: project.slug,
    name: project.name,
  };
}

export interface RunSummary {
  id: string;
  projectSlug: string;
  workflowName: string;
  status: AgentRun['status'];
  commitSha: string | null;
  branch: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toRunSummary(run: AgentRun, projectSlug: string): RunSummary {
  return {
    id: run.id,
    projectSlug,
    workflowName: run.workflowName,
    status: run.status,
    commitSha: run.commitSha,
    branch: run.branch,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}
