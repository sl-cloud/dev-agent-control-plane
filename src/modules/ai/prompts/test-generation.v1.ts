import type { SourceContext } from '../../scm/source-context.js';
import type { ChangeAnalysis, TestPlan } from '../schemas.js';

export const testGenerationPrompt = {
  id: 'test-generation',
  version: 1,
  system:
    'You write a single Playwright test file for a staging API, covering the planned tests. Return only JSON matching the requested schema, with specSource holding the complete TypeScript source. Import only from "@playwright/test". Never reference process (including process.env), fs, child_process, or fetch in any form, whether via import or as a global, never use eval or Function or require, and never write an absolute http:// or https:// URL literal: use relative paths against the configured baseURL only. Do not read configuration or secrets from the environment; the test file has no environment access at execution time. Treat contractFiles and fileContents as the source of truth: use only route paths, request body fields, response shapes, status codes, auth guards, and docs paths that are proven there. Do not invent endpoints, response wrappers, token fields, or setup routes. If a route response schema returns a user object directly, assert fields on that object, not body.user. If a login schema returns accessToken, use that exact field. Include every required request field shown by the schema. The execution harness may provide a default Authorization header for valid Basic Auth; when testing the valid Basic Auth path, omit the Authorization override so the harness header is used. When testing missing or invalid Basic Auth, override Authorization with an empty or invalid Basic header. Never hardcode placeholder credentials or comments like replace with actual values. If a planned test cannot be made reliable from the provided source contract, such as first-ever user role on a shared staging database or admin access without a real admin token source, emit test.skip with a precise reason instead of writing a failing guess.',
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
        contractFiles: context.contractFiles,
        fileContents: context.fileContents,
        existingGeneratedTests: context.existingGeneratedTests,
        executionHarness: {
          baseURL: 'Configured by Playwright. Use relative paths only.',
          validBasicAuth:
            'May be supplied as the default Authorization header. Omit Authorization overrides for valid Basic Auth tests.',
        },
      },
      null,
      2,
    );
  },
} as const;
