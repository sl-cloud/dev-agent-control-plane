import type { PlaywrightExecutionResult } from '../../execution/playwright-executor.js';
import type { SourceContext } from '../../scm/source-context.js';
import type {
  ChangeAnalysis,
  GeneratedSpec,
  TestFailureClassification,
  TestPlan,
} from '../schemas.js';

export const testRepairPrompt = {
  id: 'test-repair',
  version: 1,
  system:
    'You repair a single generated Playwright test file after it failed because the generated spec was wrong. Return only JSON matching the requested schema, with specSource holding the complete replacement TypeScript source. Import only from "@playwright/test". Never reference process, fs, child_process, fetch, eval, Function, or require. Never write absolute http:// or https:// URL literals. Use only route paths, request body fields, response shapes, status codes, auth guards, and docs paths proven by contractFiles and fileContents. Preserve useful passing coverage from the previous spec when it still matches the contract. Remove or skip unreliable guesses. Positive Basic Auth paths should omit Authorization overrides so the harness default is used. Missing or invalid Basic Auth tests may override Authorization explicitly. The target under test is a JSON-only API with no HTML pages: use only the "request" fixture to call routes directly, never the "page" fixture or any browser navigation such as page.goto, and never assert on HTML concerns like page titles.',
  render(params: {
    context: SourceContext;
    analysis: ChangeAnalysis;
    plan: TestPlan;
    spec: GeneratedSpec;
    execution: PlaywrightExecutionResult;
    classification: TestFailureClassification;
    attempt: number;
  }): string {
    return JSON.stringify(
      {
        task: 'Repair this generated Playwright spec. Return a complete replacement file.',
        attempt: params.attempt,
        project: params.context.projectSlug,
        repository: params.context.repository,
        branch: params.context.branch,
        commitSha: params.context.commitSha,
        analysis: params.analysis,
        plan: params.plan,
        classification: params.classification,
        contractFiles: params.context.contractFiles,
        fileContents: params.context.fileContents,
        previousSpecSource: params.spec.specSource,
        execution: params.execution,
        existingGeneratedTests: params.context.existingGeneratedTests,
      },
      null,
      2,
    );
  },
} as const;
