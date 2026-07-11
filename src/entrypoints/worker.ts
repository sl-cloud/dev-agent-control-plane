import closeWithGrace from 'close-with-grace';
import { loadConfig } from '../config/index.js';
import { createDbPool } from '../db/client.js';
import { createDb } from '../db/index.js';
import { buildLoggerOptions } from '../lib/logger.js';
import { createBoss, startWorkflowWorker } from '../modules/runs/queue.js';
import { stubWorkflow } from '../modules/runs/workflow-runner.js';
import pino from 'pino';

/**
 * The worker process consumes the pg-boss queue and executes workflow steps.
 * It never serves HTTP. No `runner` process split yet: that machinery lands
 * later. Importing `stubWorkflow` here registers it in the shared in-process
 * workflow registry before the queue starts consuming jobs.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino(buildLoggerOptions(config));

  void stubWorkflow;

  const pool = createDbPool(config);
  const db = createDb(pool);
  const boss = await createBoss(config.DATABASE_URL);

  await startWorkflowWorker(boss, db);
  logger.info('worker started: consuming workflow-run queue');

  closeWithGrace({ delay: 5000 }, async ({ err }) => {
    if (err) {
      logger.error({ err }, 'closing worker due to error');
    }
    await boss.stop();
    await pool.end();
  });
}

main().catch((err: unknown) => {
  console.error('fatal worker startup error:', err);
  process.exit(1);
});
