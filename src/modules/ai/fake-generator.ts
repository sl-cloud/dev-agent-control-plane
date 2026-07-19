import type { AppConfig } from '../../config/index.js';
import type { SourceContext } from '../scm/source-context.js';
import type { AiCallResult, AiGenerator } from './generator.js';
import type {
  ChangeAnalysis,
  GeneratedSpec,
  TestFailureClassification,
  TestPlan,
} from './schemas.js';

function classifyKind(path: string): ChangeAnalysis['behaviouralChanges'][number]['kind'] {
  if (path.includes('/auth/') || path.includes('jwt') || path.includes('password')) {
    return 'auth_changed';
  }
  if (path.includes('/routes') || path.includes('routes.ts')) {
    return 'endpoint_changed';
  }
  if (path.includes('/schemas')) {
    return 'validation_changed';
  }
  if (path.includes('/service') || path.includes('/policies') || path.includes('/transitions')) {
    return 'business_rule_changed';
  }
  return 'other';
}

function usage(model: string): AiCallResult<never>['usage'] {
  return { model, promptTokens: 0, completionTokens: 0, costUsd: 0 };
}

function testTitle(title: string, index: number): string {
  const cleanTitle = title.trim() || `generated smoke test ${index + 1}`;
  return JSON.stringify(cleanTitle);
}

function fakeCase(index: number): { method: 'get' | 'post'; path: string; expectedStatus: number } {
  const cases: Array<{ method: 'get' | 'post'; path: string; expectedStatus: number }> = [
    { method: 'get', path: '/health/live', expectedStatus: 200 },
    { method: 'get', path: '/health/ready', expectedStatus: 200 },
    { method: 'get', path: '/api/v1/projects', expectedStatus: 401 },
    { method: 'get', path: '/api/v1/auth/me', expectedStatus: 401 },
    { method: 'get', path: '/api/v1/users', expectedStatus: 401 },
    { method: 'post', path: '/api/v1/tests/trigger', expectedStatus: 401 },
  ];
  return cases[index % cases.length]!;
}

function generatedSpecSource(plan: TestPlan): string {
  const tests = plan.tests
    .map((test, index) => {
      const testCase = fakeCase(index);
      const requestCall =
        testCase.method === 'post'
          ? `request.post('${testCase.path}', { data: { branch: 'main' } })`
          : `request.get('${testCase.path}')`;
      return `
test(${testTitle(test.title, index)}, async ({ request }) => {
  const response = await ${requestCall};
  expect(response.status()).toBe(${testCase.expectedStatus});
});`;
    })
    .join('\n');

  return `import { expect, test } from '@playwright/test';
${tests}
`;
}

function repairedSpecSource(): string {
  return `import { expect, test } from '@playwright/test';

test('repaired generated smoke test', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBe(true);
});
`;
}

export function createFakeGenerator(config: AppConfig): AiGenerator {
  const model = config.AI_MODEL_DEFAULT;

  return {
    async analyseChanges(context: SourceContext): Promise<AiCallResult<ChangeAnalysis>> {
      const changedFiles = context.changedFiles.slice(0, 8);
      const behaviouralChanges = changedFiles.map((file) => ({
        description: `Changed ${file}`,
        kind: classifyKind(file),
        files: [file],
        risk: classifyKind(file) === 'other' ? ('low' as const) : ('medium' as const),
      }));

      return {
        output: {
          summary:
            changedFiles.length > 0
              ? `Deployment ${context.commitSha.slice(0, 7)} changed ${changedFiles.length} file(s).`
              : `Deployment ${context.commitSha.slice(0, 7)} had no diff context available.`,
          behaviouralChanges,
          securitySensitive: behaviouralChanges.some((change) =>
            ['auth_changed', 'business_rule_changed'].includes(change.kind),
          ),
        },
        usage: usage(model),
      };
    },

    async planTests(
      context: SourceContext,
      analysis: ChangeAnalysis,
    ): Promise<AiCallResult<TestPlan>> {
      const tests = analysis.behaviouralChanges.slice(0, 6).map((change, index) => ({
        title: `covers ${change.kind.replaceAll('_', ' ')} ${index + 1}`,
        kind:
          change.kind === 'auth_changed'
            ? ('auth' as const)
            : change.kind === 'validation_changed'
              ? ('validation' as const)
              : change.kind === 'business_rule_changed'
                ? ('business_rule' as const)
                : ('regression' as const),
        reasoning: `The diff touched ${change.files.join(', ')}, so this behaviour should be checked against staging for commit ${context.commitSha.slice(0, 7)}.`,
        priority: change.risk === 'low' ? ('should' as const) : ('must' as const),
        coveredByExisting: false,
      }));

      return { output: { tests }, usage: usage(model) };
    },

    async generateTests(
      _context: SourceContext,
      _analysis: ChangeAnalysis,
      plan: TestPlan,
    ): Promise<AiCallResult<GeneratedSpec>> {
      return { output: { specSource: generatedSpecSource(plan) }, usage: usage(model) };
    },

    async classifyTestFailure(): Promise<AiCallResult<TestFailureClassification>> {
      return {
        output: {
          category: 'generated_test_error',
          repairRecommended: true,
          summary: 'Fake generator treats failed executions as repairable generated-test errors.',
          evidence: ['The fake provider is deterministic for local workflow tests.'],
        },
        usage: usage(model),
      };
    },

    async repairTests(): Promise<AiCallResult<GeneratedSpec>> {
      return { output: { specSource: repairedSpecSource() }, usage: usage(model) };
    },
  };
}
