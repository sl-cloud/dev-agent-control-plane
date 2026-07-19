import type { Db } from '../../db/index.js';
import type { AiGenerator } from '../ai/generator.js';
import type {
  ChangeAnalysis,
  GeneratedSpec,
  TestFailureClassification,
  TestPlan,
} from '../ai/schemas.js';
import { recordAiOperation } from '../ai/ledger.js';
import type {
  PlaywrightExecutionResult,
  PlaywrightTestResult,
} from '../execution/playwright-executor.js';
import {
  generatedSpecViolations,
  validateGeneratedSpecSource,
  type GeneratedSpecValidationResult,
} from '../execution/spec-validator.js';
import type { SourceContext } from '../scm/source-context.js';

export const MAX_TEST_REPAIR_ATTEMPTS = 5;

export interface RepairValidationResult {
  valid: boolean;
  violations?: string[];
}

export interface TestRepairAttempt {
  attempt: number;
  classification: TestFailureClassification;
  repairedSpecSource?: string;
  validation?: RepairValidationResult;
  execution?: PlaywrightExecutionResult;
}

export interface TestRepairOutput {
  attempts: TestRepairAttempt[];
  finalSpecSource: string | null;
  finalExecution: PlaywrightExecutionResult | null;
  stopReason:
    | 'original_passed'
    | 'environment_setup'
    | 'likely_app_regression'
    | 'unknown'
    | 'repair_succeeded'
    | 'max_attempts_reached';
}

export interface RunTestRepairLoopParams {
  db: Db;
  runId: string;
  stepId: string;
  generator: AiGenerator;
  sourceContext: SourceContext;
  analysis: ChangeAnalysis;
  plan: TestPlan;
  generated: GeneratedSpec;
  execution: PlaywrightExecutionResult;
  testExecutor: (specSource: string) => Promise<PlaywrightExecutionResult>;
}

const ENVIRONMENT_ERROR_PATTERNS = [
  /EAI_AGAIN/i,
  /ENOTFOUND/i,
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /Timeout/i,
  /browser.*not.*found/i,
  /Executable doesn't exist/i,
  /missing.*credential/i,
  /unauthorized.*harness/i,
];

function failedResults(execution: PlaywrightExecutionResult): PlaywrightTestResult[] {
  return execution.results.filter((result) => result.status === 'failed');
}

function deterministicEnvironmentClassification(
  execution: PlaywrightExecutionResult,
): TestFailureClassification | null {
  const errors = failedResults(execution)
    .map((result) => result.error ?? '')
    .filter(Boolean);
  if (
    errors.length > 0 &&
    errors.some((error) => ENVIRONMENT_ERROR_PATTERNS.some((pattern) => pattern.test(error)))
  ) {
    return {
      category: 'environment_setup',
      repairRecommended: false,
      summary: 'The failure looks like environment or harness setup, not a generated-test error.',
      evidence: errors.slice(0, 4),
    };
  }
  return null;
}

function validationResultFor(specSource: string): GeneratedSpecValidationResult {
  return validateGeneratedSpecSource(specSource);
}

function repairValidationFor(specSource: string): RepairValidationResult {
  const violations = generatedSpecViolations(specSource);
  return violations.length > 0 ? { valid: false, violations } : { valid: true };
}

function stopReasonFor(classification: TestFailureClassification): TestRepairOutput['stopReason'] {
  if (classification.category === 'environment_setup') {
    return 'environment_setup';
  }
  if (classification.category === 'likely_app_regression') {
    return 'likely_app_regression';
  }
  return 'unknown';
}

export async function runTestRepairLoop({
  db,
  runId,
  stepId,
  generator,
  sourceContext,
  analysis,
  plan,
  generated,
  execution,
  testExecutor,
}: RunTestRepairLoopParams): Promise<TestRepairOutput> {
  if (!execution.failed) {
    return {
      attempts: [],
      finalSpecSource: null,
      finalExecution: null,
      stopReason: 'original_passed',
    };
  }

  let currentSpec = generated;
  let currentExecution = execution;
  const attempts: TestRepairAttempt[] = [];

  for (let attempt = 1; attempt <= MAX_TEST_REPAIR_ATTEMPTS; attempt += 1) {
    const deterministicClassification = deterministicEnvironmentClassification(currentExecution);
    const classificationResult = deterministicClassification
      ? {
          output: deterministicClassification,
          usage: null,
        }
      : {
          ...(await generator.classifyTestFailure({
            context: sourceContext,
            analysis,
            plan,
            spec: currentSpec,
            execution: currentExecution,
            attempt,
          })),
        };

    if (classificationResult.usage) {
      await recordAiOperation({
        db,
        runId,
        stepId,
        kind: 'test-failure-classification',
        usage: classificationResult.usage,
      });
    }

    const classification = classificationResult.output;
    const repairable =
      classification.category === 'generated_test_error' && classification.repairRecommended;
    const repairAttempt: TestRepairAttempt = { attempt, classification };
    attempts.push(repairAttempt);

    if (!repairable) {
      return {
        attempts,
        finalSpecSource: null,
        finalExecution: null,
        stopReason: stopReasonFor(classification),
      };
    }

    const repairResult = await generator.repairTests({
      context: sourceContext,
      analysis,
      plan,
      spec: currentSpec,
      execution: currentExecution,
      classification,
      attempt,
    });
    await recordAiOperation({
      db,
      runId,
      stepId,
      kind: 'test-repair',
      usage: repairResult.usage,
    });

    currentSpec = repairResult.output;
    repairAttempt.repairedSpecSource = currentSpec.specSource;
    repairAttempt.validation = repairValidationFor(currentSpec.specSource);

    if (!repairAttempt.validation.valid) {
      continue;
    }

    validationResultFor(currentSpec.specSource);
    currentExecution = await testExecutor(currentSpec.specSource);
    repairAttempt.execution = currentExecution;

    if (!currentExecution.failed) {
      return {
        attempts,
        finalSpecSource: currentSpec.specSource,
        finalExecution: currentExecution,
        stopReason: 'repair_succeeded',
      };
    }
  }

  return {
    attempts,
    finalSpecSource: null,
    finalExecution: currentExecution,
    stopReason: 'max_attempts_reached',
  };
}
