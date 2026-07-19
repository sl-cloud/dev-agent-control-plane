import type { AgentRun, AiOperation, Project, WorkflowStep } from '../../db/schema.js';

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

export interface WorkflowStepSummary {
  name: string;
  attempt: number;
  status: WorkflowStep['status'];
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

export function toWorkflowStepSummary(step: WorkflowStep): WorkflowStepSummary {
  return {
    name: step.stepName,
    attempt: step.attempt,
    status: step.status,
    startedAt: step.startedAt?.toISOString() ?? null,
    finishedAt: step.finishedAt?.toISOString() ?? null,
    output: step.output ?? null,
    error: step.error,
  };
}

export function toAiOperationSummary(operation: AiOperation): AiOperationSummary {
  return {
    kind: operation.kind,
    model: operation.model,
    promptTokens: operation.promptTokens,
    completionTokens: operation.completionTokens,
    createdAt: operation.createdAt.toISOString(),
  };
}

export function toRunDetail(params: {
  run: AgentRun;
  projectSlug: string;
  steps: WorkflowStep[];
  aiOperations: AiOperation[];
}): RunDetail {
  return {
    ...toRunSummary(params.run, params.projectSlug),
    steps: params.steps.map(toWorkflowStepSummary),
    aiOperations: params.aiOperations.map(toAiOperationSummary),
  };
}
