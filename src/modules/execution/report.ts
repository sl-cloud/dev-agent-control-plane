import type { PlaywrightExecutionResult, PlaywrightTestResult } from './playwright-executor.js';
import type { TestRepairOutput } from '../analysis/test-repair.js';

export interface ExecutionReport {
  passed: boolean;
  failed: boolean;
  passedCount: number;
  failedCount: number;
  duration: number;
  results: PlaywrightTestResult[];
  repairAttempts?: TestRepairOutput['attempts'];
  repairStopReason?: TestRepairOutput['stopReason'];
  repaired: boolean;
}

function cleanError(error: string | undefined): string | undefined {
  if (!error) {
    return undefined;
  }
  const withoutTmpPaths = error
    .replace(/\/tmp\/cp-playwright-[^\s)]+/g, '[tmp]')
    .replace(/file:\/\/[^\s)]+/g, '[file]');
  return withoutTmpPaths.split('\n').slice(0, 6).join('\n').slice(0, 2000);
}

export function finaliseExecutionReport(
  output: PlaywrightExecutionResult,
  repair?: TestRepairOutput,
): ExecutionReport {
  const finalOutput = repair?.finalExecution ?? output;
  const results = finalOutput.results.map((result) => {
    const cleanResult: PlaywrightTestResult = {
      title: result.title,
      status: result.status,
    };
    const error = cleanError(result.error);
    if (error) {
      cleanResult.error = error;
    }
    return cleanResult;
  });
  const failedCount = results.filter((result) => result.status === 'failed').length;
  const passedCount = results.filter((result) => result.status === 'passed').length;
  return {
    passed: failedCount === 0,
    failed: failedCount > 0,
    passedCount,
    failedCount,
    duration: finalOutput.duration,
    results,
    repaired: Boolean(repair?.finalExecution && repair.stopReason === 'repair_succeeded'),
    ...(repair
      ? {
          repairAttempts: repair.attempts,
          repairStopReason: repair.stopReason,
        }
      : {}),
  };
}
