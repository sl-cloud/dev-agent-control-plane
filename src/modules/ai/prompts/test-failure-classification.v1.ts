import type { PlaywrightExecutionResult } from '../../execution/playwright-executor.js';
import type { SourceContext } from '../../scm/source-context.js';
import type { ChangeAnalysis, GeneratedSpec, TestPlan } from '../schemas.js';

export const testFailureClassificationPrompt = {
  id: 'test-failure-classification',
  version: 1,
  system:
    'You classify failed Playwright API test execution for a deployment workflow. Return only JSON matching the requested schema. Classify environment/setup problems separately from generated-test mistakes and likely application regressions. A generated-test mistake means the spec contradicts the provided source contract, uses unproven paths or fields, depends on impossible shared state, or makes an assertion the route schema/error handler does not support. A likely application regression means the request and assertion match the contract but staging returned the wrong status or body. Environment/setup includes DNS, connection refused, timeouts, browser/runtime problems, stale target URLs, and missing harness credentials. Recommend repair only for generated-test mistakes.',
  render(params: {
    context: SourceContext;
    analysis: ChangeAnalysis;
    plan: TestPlan;
    spec: GeneratedSpec;
    execution: PlaywrightExecutionResult;
    attempt: number;
  }): string {
    return JSON.stringify(
      {
        task: 'Classify why this generated Playwright spec failed.',
        attempt: params.attempt,
        project: params.context.projectSlug,
        repository: params.context.repository,
        branch: params.context.branch,
        commitSha: params.context.commitSha,
        analysis: params.analysis,
        plan: params.plan,
        contractFiles: params.context.contractFiles,
        fileContents: params.context.fileContents,
        specSource: params.spec.specSource,
        execution: params.execution,
        categories: {
          environment_setup: 'Infrastructure or harness failure. Do not repair the spec.',
          generated_test_error: 'The generated spec is wrong. Repair is allowed.',
          likely_app_regression: 'The spec matches the contract, but the app response is wrong.',
          unknown:
            'Insufficient evidence. Do not repair unless the evidence clearly points to the spec.',
        },
      },
      null,
      2,
    );
  },
} as const;
