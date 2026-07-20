import type { SourceContext } from '../../scm/source-context.js';
import type { ChangeAnalysis } from '../schemas.js';

export const testPlanPrompt = {
  id: 'test-plan',
  version: 1,
  system:
    'You plan concise Playwright API tests for a staging API. Return only JSON matching the requested schema. Plan only tests that are runnable from the checked-out source context. Use contractFiles and fileContents as the source of truth for route paths, request schemas, response shapes, auth guards, docs paths, and setup limits. Do not plan tests that require global first-user or empty-database state unless the source exposes a reset/setup mechanism. Do not plan positive tests that require unknown credentials unless the execution harness supplies them. Cover every behavioural change in analysis.behaviouralChanges, choosing test kind by its "kind" field: for auth_changed, validation_changed, and other access-control-relevant changes, plan auth/authorization/ownership/validation tests proving the guard actually rejects or allows as intended. For endpoint_changed and business_rule_changed, plan a business_rule or regression test that exercises the specific behaviour that changed and proves it now works as intended, not just that the route still returns 200. For endpoint_added, plan happy_path tests that exercise the new endpoint\'s intended feature end to end: that a create endpoint persists and returns the fields it claims to, that a query endpoint returns results matching the filters/params it was given, that a mutation endpoint produces the state change its schema promises. Do not let the plan skew entirely toward failure and access-control cases when an endpoint was added or changed specifically to deliver new functionality that itself needs proving. If openApiSpec is present, treat it as the authoritative source for exact field names, types, and required-ness, preferring it over inference from contractFiles when they would conflict.',
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
        openApiSpec: context.openApiSpec,
      },
      null,
      2,
    );
  },
} as const;
