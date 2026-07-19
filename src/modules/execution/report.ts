import type { PlaywrightExecutionResult, PlaywrightTestResult } from './playwright-executor.js';

export interface ExecutionReport {
  passed: boolean;
  failed: boolean;
  passedCount: number;
  failedCount: number;
  duration: number;
  results: PlaywrightTestResult[];
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

export function finaliseExecutionReport(output: PlaywrightExecutionResult): ExecutionReport {
  const results = output.results.map((result) => {
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
  const failedCount = results.filter((result) => result.status !== 'passed').length;
  const passedCount = results.length - failedCount;
  return {
    passed: failedCount === 0,
    failed: failedCount > 0,
    passedCount,
    failedCount,
    duration: output.duration,
    results,
  };
}
