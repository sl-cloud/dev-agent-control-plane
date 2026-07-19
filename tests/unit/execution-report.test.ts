import { describe, expect, it } from 'vitest';
import { finaliseExecutionReport } from '../../src/modules/execution/report.js';

describe('finaliseExecutionReport', () => {
  it('does not count skipped tests as failed', () => {
    const report = finaliseExecutionReport({
      passed: true,
      failed: false,
      duration: 123,
      results: [
        { title: 'passes', status: 'passed' },
        { title: 'skips by design', status: 'skipped' },
      ],
    });

    expect(report).toMatchObject({
      passed: true,
      failed: false,
      passedCount: 1,
      failedCount: 0,
      repaired: false,
    });
  });
});
