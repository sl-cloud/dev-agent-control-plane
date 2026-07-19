import type { SourceContext } from '../../scm/source-context.js';
import type { ChangeAnalysis } from '../schemas.js';

export const testPlanPrompt = {
  id: 'test-plan',
  version: 1,
  system:
    'You plan concise Playwright API tests for a staging API. Return only JSON matching the requested schema. Plan only tests that are runnable from the checked-out source context. Use contractFiles and fileContents as the source of truth for route paths, request schemas, response shapes, auth guards, docs paths, and setup limits. Do not plan tests that require global first-user or empty-database state unless the source exposes a reset/setup mechanism. Do not plan positive tests that require unknown credentials unless the execution harness supplies them. Prefer high-value tests that prove changed behaviour, especially auth, ownership, validation, and regressions.',
  render(context: SourceContext, analysis: ChangeAnalysis): string {
    return JSON.stringify(
      {
        task: 'Plan Playwright tests for this change. Do not write code yet.',
        project: context.projectSlug,
        repository: context.repository,
        branch: context.branch,
        commitSha: context.commitSha,
        baseSha: context.baseSha,
        analysis,
        changedFiles: context.changedFiles,
        diffStat: context.diffStat,
        existingGeneratedTests: context.existingGeneratedTests,
        contractFiles: context.contractFiles,
        fileContents: context.fileContents,
      },
      null,
      2,
    );
  },
} as const;
