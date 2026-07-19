import type { AppConfig } from '../../config/index.js';

export function calculateCostUsd(
  config: Pick<AppConfig, 'AI_INPUT_COST_PER_MTOK' | 'AI_OUTPUT_COST_PER_MTOK'>,
  promptTokens: number,
  completionTokens: number,
): number {
  const inputCost = (promptTokens / 1_000_000) * config.AI_INPUT_COST_PER_MTOK;
  const outputCost = (completionTokens / 1_000_000) * config.AI_OUTPUT_COST_PER_MTOK;
  return inputCost + outputCost;
}
