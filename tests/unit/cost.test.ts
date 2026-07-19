import { describe, expect, it } from 'vitest';
import { calculateCostUsd } from '../../src/modules/ai/cost.js';

describe('calculateCostUsd', () => {
  it('computes cost from per-million-token rates', () => {
    const cost = calculateCostUsd(
      { AI_INPUT_COST_PER_MTOK: 5, AI_OUTPUT_COST_PER_MTOK: 25 },
      1000,
      500,
    );
    // 1000 prompt tokens * $5/1e6 + 500 completion tokens * $25/1e6
    expect(cost).toBeCloseTo(0.005 + 0.0125, 6);
  });

  it('returns zero for zero tokens', () => {
    const cost = calculateCostUsd({ AI_INPUT_COST_PER_MTOK: 5, AI_OUTPUT_COST_PER_MTOK: 25 }, 0, 0);
    expect(cost).toBe(0);
  });
});
