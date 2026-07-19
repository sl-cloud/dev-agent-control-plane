import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  jsonb,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

export const runStatusEnum = pgEnum('run_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export const stepStatusEnum = pgEnum('step_status', ['pending', 'running', 'succeeded', 'failed']);

export const projectsTable = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  // Indirection key naming the env var that holds the real webhook secret
  // (e.g. 'CP_WEBHOOK_SECRET'). No secrets manager exists yet; this is a
  // deliberate simplification for this stage. Never store the secret value
  // itself here.
  webhookSecretRef: text('webhook_secret_ref').notNull(),
  isPublicOnDashboard: boolean('is_public_on_dashboard').notNull().default(true),
  // Commit SHA of the last deployment whose change-analysis run completed
  // (analysis + execution finished, independent of whether generated tests
  // passed). Used as the diff base for the next run instead of the deployed
  // commit's immediate Git parent, which is wrong whenever deploys are
  // batched, skipped, rolled back, or merge commits are involved.
  lastSuccessfulCommitSha: text('last_successful_commit_sha'),
  // Learned from the first webhook payload that includes a resolvable
  // repository, so the dashboard can link a run's commit SHA to the actual
  // GitHub commit. Never overwritten once set.
  repositoryUrl: text('repository_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const webhookEventsTable = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projectsTable.id, { onDelete: 'cascade' }),
    deliveryId: text('delivery_id').notNull(),
    eventType: text('event_type').notNull(),
    signatureValid: boolean('signature_valid').notNull(),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('webhook_events_project_delivery_unique').on(table.projectId, table.deliveryId),
  ],
);

export const errorEventsTable = pgTable(
  'error_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projectsTable.id, { onDelete: 'cascade' }),
    deliveryId: text('delivery_id').notNull(),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('error_events_project_delivery_unique').on(table.projectId, table.deliveryId)],
);

export const agentRunsTable = pgTable('agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projectsTable.id, { onDelete: 'cascade' }),
  workflowName: text('workflow_name').notNull(),
  status: runStatusEnum('status').notNull().default('queued'),
  cancellationRequested: boolean('cancellation_requested').notNull().default(false),
  triggerDeliveryId: text('trigger_delivery_id').notNull(),
  commitSha: text('commit_sha'),
  branch: text('branch'),
  isPublicOnDashboard: boolean('is_public_on_dashboard').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workflowStepsTable = pgTable(
  'workflow_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRunsTable.id, { onDelete: 'cascade' }),
    stepName: text('step_name').notNull(),
    attempt: integer('attempt').notNull().default(1),
    status: stepStatusEnum('status').notNull().default('pending'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    output: jsonb('output'),
    error: text('error'),
  },
  (table) => [
    unique('workflow_steps_run_step_attempt_unique').on(table.runId, table.stepName, table.attempt),
  ],
);

// Schema only, unused until a later stage: tracks individual model calls
// made while executing a workflow step.
export const aiOperationsTable = pgTable('ai_operations', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id')
    .notNull()
    .references(() => agentRunsTable.id, { onDelete: 'cascade' }),
  stepId: uuid('step_id').references(() => workflowStepsTable.id, { onDelete: 'set null' }),
  kind: text('kind').notNull(),
  model: text('model').notNull(),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const acceptedGeneratedTestsTable = pgTable('accepted_generated_tests', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projectsTable.id, { onDelete: 'cascade' }),
  runId: uuid('run_id')
    .notNull()
    .references(() => agentRunsTable.id, { onDelete: 'cascade' }),
  commitSha: text('commit_sha'),
  branch: text('branch'),
  specSource: text('spec_source').notNull(),
  passedCount: integer('passed_count').notNull(),
  duration: integer('duration').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Project = typeof projectsTable.$inferSelect;
export type NewProject = typeof projectsTable.$inferInsert;
export type WebhookEvent = typeof webhookEventsTable.$inferSelect;
export type NewWebhookEvent = typeof webhookEventsTable.$inferInsert;
export type ErrorEvent = typeof errorEventsTable.$inferSelect;
export type NewErrorEvent = typeof errorEventsTable.$inferInsert;
export type AgentRun = typeof agentRunsTable.$inferSelect;
export type NewAgentRun = typeof agentRunsTable.$inferInsert;
export type WorkflowStep = typeof workflowStepsTable.$inferSelect;
export type NewWorkflowStep = typeof workflowStepsTable.$inferInsert;
export type AiOperation = typeof aiOperationsTable.$inferSelect;
export type NewAiOperation = typeof aiOperationsTable.$inferInsert;
export type AcceptedGeneratedTest = typeof acceptedGeneratedTestsTable.$inferSelect;
export type NewAcceptedGeneratedTest = typeof acceptedGeneratedTestsTable.$inferInsert;

export const schema = {
  projectsTable,
  webhookEventsTable,
  errorEventsTable,
  agentRunsTable,
  workflowStepsTable,
  aiOperationsTable,
  acceptedGeneratedTestsTable,
};
