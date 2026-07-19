import type { SourceContext } from '../../scm/source-context.js';

export const changeAnalysisPrompt = {
  id: 'change-analysis',
  version: 1,
  system:
    'You analyse TypeScript API changes for a test-generation workflow. Return only JSON matching the requested schema. Focus on externally observable behaviour, auth, validation, ownership, and business rules.',
  render(context: SourceContext): string {
    return JSON.stringify(
      {
        task: 'Analyse this deployment diff for behaviour that deserves tests.',
        project: context.projectSlug,
        repository: context.repository,
        branch: context.branch,
        commitSha: context.commitSha,
        baseSha: context.baseSha,
        diffStat: context.diffStat,
        diff: context.diff,
        changedFiles: context.changedFiles,
        fileContents: context.fileContents,
        contractFiles: context.contractFiles,
      },
      null,
      2,
    );
  },
} as const;
