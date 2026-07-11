import closeWithGrace from 'close-with-grace';
import { loadConfig } from '../config/index.js';
import { buildApp } from '../app.js';
import { createBoss } from '../modules/runs/queue.js';

/**
 * The api process serves HTTP (webhooks, admin, dashboard-api, health) and
 * enqueues jobs; it never runs workflow steps itself. That happens only in
 * the worker process (entrypoints/worker.ts).
 */
async function main(): Promise<void> {
  const config = loadConfig();

  const boss = await createBoss(config.DATABASE_URL);
  const app = await buildApp({ config, boss });

  closeWithGrace({ delay: 5000 }, async ({ err }) => {
    if (err) {
      app.log.error({ err }, 'closing app due to error');
    }
    await app.close();
    await boss.stop();
  });

  try {
    await app.listen({ host: '0.0.0.0', port: config.PORT });
  } catch (err) {
    app.log.error({ err }, 'failed to start server');
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('fatal startup error:', err);
  process.exit(1);
});
