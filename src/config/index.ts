import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().url().or(z.string().startsWith('postgres')),
  PLAYWRIGHT_TARGET_URL: z.string().url(),

  ADMIN_API_TOKEN: z.string().min(16, 'ADMIN_API_TOKEN must be at least 16 characters'),

  COMMIT_SHA: z.string().default('dev'),

  AI_PROVIDER: z.enum(['fake', 'openai', 'opencode', 'deepseek']).default('fake'),
  OPENAI_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  AI_MODEL_DEFAULT: z.string().default('fake-planner-v1'),
  AI_MODEL_CHANGE_ANALYSIS: z.string().optional(),
  AI_MODEL_TEST_PLANNING: z.string().optional(),
  AI_RUN_BUDGET_USD: z.coerce.number().positive().default(1),
  AI_INPUT_COST_PER_MTOK: z.coerce.number().nonnegative().default(5),
  AI_OUTPUT_COST_PER_MTOK: z.coerce.number().nonnegative().default(25),
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  if (result.data.AI_PROVIDER === 'openai' && !result.data.OPENAI_API_KEY) {
    throw new Error(
      'Invalid environment configuration:\n  - OPENAI_API_KEY is required when AI_PROVIDER=openai',
    );
  }

  if (result.data.AI_PROVIDER === 'deepseek' && !result.data.DEEPSEEK_API_KEY) {
    throw new Error(
      'Invalid environment configuration:\n  - DEEPSEEK_API_KEY is required when AI_PROVIDER=deepseek',
    );
  }

  return result.data;
}

/** Cached accessor for use outside the boot path (e.g. inside request handlers). */
export function getConfig(): AppConfig {
  cached ??= loadConfig();
  return cached;
}

/** Test-only: clears the cache so a test can re-load config with different env vars. */
export function resetConfigCache(): void {
  cached = undefined;
}
