import type { SourceContext } from '../../scm/source-context.js';
import type { ChangeAnalysis } from '../schemas.js';

export const testPlanPrompt = {
  id: 'test-plan',
  version: 1,
  system:
    'You plan concise Playwright API tests for a staging API. Return only JSON matching the requested schema. Prefer high-value tests that prove changed behaviour, especially auth, ownership, validation, and regressions.',
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
        existingGeneratedTests: [],
      },
      null,
      2,
    );
  },
} as const;
