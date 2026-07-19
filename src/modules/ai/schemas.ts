import { z } from 'zod';

export const ChangeAnalysisSchema = z
  .object({
    summary: z.string().max(2000),
    behaviouralChanges: z
      .array(
        z.object({
          description: z.string(),
          kind: z.enum([
            'endpoint_added',
            'endpoint_changed',
            'auth_changed',
            'validation_changed',
            'business_rule_changed',
            'other',
          ]),
          files: z.array(z.string()),
          risk: z.enum(['low', 'medium', 'high']),
        }),
      )
      .max(20),
    securitySensitive: z.boolean(),
  })
  .strict();

export const TestPlanSchema = z
  .object({
    tests: z
      .array(
        z.object({
          title: z.string(),
          kind: z.enum([
            'auth',
            'authorization',
            'ownership',
            'validation',
            'business_rule',
            'happy_path',
            'regression',
          ]),
          reasoning: z.string(),
          priority: z.enum(['must', 'should']),
          coveredByExisting: z.boolean(),
        }),
      )
      .max(12),
  })
  .strict();

export const GeneratedSpecSchema = z
  .object({
    specSource: z.string().max(20_000),
  })
  .strict();

export const TestFailureClassificationSchema = z
  .object({
    category: z.enum([
      'environment_setup',
      'generated_test_error',
      'likely_app_regression',
      'unknown',
    ]),
    repairRecommended: z.boolean(),
    summary: z.string().max(2000),
    evidence: z.array(z.string().max(500)).max(8),
  })
  .strict();

export type ChangeAnalysis = z.infer<typeof ChangeAnalysisSchema>;
export type TestPlan = z.infer<typeof TestPlanSchema>;
export type GeneratedSpec = z.infer<typeof GeneratedSpecSchema>;
export type TestFailureClassification = z.infer<typeof TestFailureClassificationSchema>;

export const CHANGE_ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'behaviouralChanges', 'securitySensitive'],
  properties: {
    summary: { type: 'string', maxLength: 2000 },
    behaviouralChanges: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'kind', 'files', 'risk'],
        properties: {
          description: { type: 'string' },
          kind: {
            type: 'string',
            enum: [
              'endpoint_added',
              'endpoint_changed',
              'auth_changed',
              'validation_changed',
              'business_rule_changed',
              'other',
            ],
          },
          files: { type: 'array', items: { type: 'string' } },
          risk: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
      },
    },
    securitySensitive: { type: 'boolean' },
  },
} as const;

export const TEST_PLAN_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tests'],
  properties: {
    tests: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'kind', 'reasoning', 'priority', 'coveredByExisting'],
        properties: {
          title: { type: 'string' },
          kind: {
            type: 'string',
            enum: [
              'auth',
              'authorization',
              'ownership',
              'validation',
              'business_rule',
              'happy_path',
              'regression',
            ],
          },
          reasoning: { type: 'string' },
          priority: { type: 'string', enum: ['must', 'should'] },
          coveredByExisting: { type: 'boolean' },
        },
      },
    },
  },
} as const;

export const GENERATED_SPEC_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['specSource'],
  properties: {
    specSource: { type: 'string', maxLength: 20_000 },
  },
} as const;

export const TEST_FAILURE_CLASSIFICATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'repairRecommended', 'summary', 'evidence'],
  properties: {
    category: {
      type: 'string',
      enum: ['environment_setup', 'generated_test_error', 'likely_app_regression', 'unknown'],
    },
    repairRecommended: { type: 'boolean' },
    summary: { type: 'string', maxLength: 2000 },
    evidence: {
      type: 'array',
      maxItems: 8,
      items: { type: 'string', maxLength: 500 },
    },
  },
} as const;
