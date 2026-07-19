import type { AppConfig } from '../../config/index.js';
import type { SourceContext } from '../scm/source-context.js';
import type { AiCallResult, AiGenerator } from './generator.js';
import type { ChangeAnalysis, GeneratedSpec, TestPlan } from './schemas.js';

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

function generatedSpecSource(plan: TestPlan): string {
  const tests = plan.tests
    .map(
      (test, index) => `
test(${testTitle(test.title, index)}, async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBe(true);
  await expect(page).toHaveTitle(/.+/);
});`,
    )
    .join('\n');

  return `import { expect, test } from '@playwright/test';
${tests}
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
  };
}
