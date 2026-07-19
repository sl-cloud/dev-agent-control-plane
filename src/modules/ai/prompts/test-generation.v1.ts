import type { SourceContext } from '../../scm/source-context.js';
import type { ChangeAnalysis, TestPlan } from '../schemas.js';

export const testGenerationPrompt = {
  id: 'test-generation',
  version: 1,
  system:
    'You write a single Playwright test file for a staging API, covering the planned tests. Return only JSON matching the requested schema, with specSource holding the complete TypeScript source. Import only from "@playwright/test". Never import process, fs, child_process, or fetch, never use eval or Function or require, and never write an absolute http:// or https:// URL literal — use relative paths against the configured baseURL only.',
  render(context: SourceContext, analysis: ChangeAnalysis, plan: TestPlan): string {
    return JSON.stringify(
      {
        task: 'Write a Playwright spec implementing this test plan.',
        project: context.projectSlug,
        repository: context.repository,
        branch: context.branch,
        commitSha: context.commitSha,
        analysis,
        plan,
      },
      null,
      2,
    );
  },
} as const;
