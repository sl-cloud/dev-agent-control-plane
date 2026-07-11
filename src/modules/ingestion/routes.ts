import type { FastifyInstance } from 'fastify';
import { agentRunsTable, errorEventsTable } from '../../db/schema.js';
import { resolveProject } from './resolve-project.js';
import { verifyRequestSignature } from './verify-signature.js';
import { recordDelivery } from './idempotency.js';
import { enqueueWorkflowRun } from '../runs/queue.js';

interface DeploymentCompletedBody {
  project: string;
  event: string;
  repository: string;
  branch: string;
  commitSha: string;
  baseSha: string;
  environment: string;
  ciRunUrl: string;
  deployedAt: string;
}

interface ErrorReportedBody {
  project: string;
  environment: string;
  commitSha: string;
  error: { name: string; message: string; stackSanitised: string };
  request: { method: string; routePattern: string; statusCode: number; requestId: string };
  occurredAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function ingestionRoutes(app: FastifyInstance): Promise<void> {
  app.post('/github-ci', async (request, reply) => {
    const body = request.body;
    if (!isRecord(body) || typeof body.project !== 'string') {
      return reply.status(400).send({ error: 'invalid payload: missing project' });
    }
    const payload = body as unknown as DeploymentCompletedBody;

    const deliveryId = firstHeader(request.headers['x-portfolio-delivery']);
    if (!deliveryId) {
      return reply.status(400).send({ error: 'missing X-Portfolio-Delivery header' });
    }

    const resolved = await resolveProject(app.db, payload.project);
    const rawBody = request.rawBody ?? Buffer.from(JSON.stringify(body));

    const signatureValid = verifyRequestSignature({
      secret: resolved?.secret,
      rawBody,
      timestampHeader: request.headers['x-portfolio-timestamp'],
      signatureHeader: request.headers['x-portfolio-signature'],
    });

    // Unknown project and invalid signature both return 401 with the same
    // shape: never leak which project slugs exist to an unauthenticated caller.
    if (!resolved || !signatureValid) {
      return reply.status(401).send({ error: 'invalid signature' });
    }

    const delivery = await recordDelivery(app.db, {
      projectId: resolved.project.id,
      deliveryId,
      eventType: 'deployment.completed',
      signatureValid: true,
      payload: body,
    });

    if (delivery.outcome === 'duplicate') {
      const existingRun = await app.db.query.agentRunsTable.findFirst({
        where: (runs, { eq }) => eq(runs.triggerDeliveryId, deliveryId),
      });
      return reply.status(200).send({ status: 'duplicate', runId: existingRun?.id });
    }

    const [run] = await app.db
      .insert(agentRunsTable)
      .values({
        projectId: resolved.project.id,
        workflowName: 'stub',
        status: 'queued',
        triggerDeliveryId: deliveryId,
        commitSha: payload.commitSha,
        branch: payload.branch,
      })
      .returning();

    if (!run) {
      throw new Error('insert into agent_runs returned no row');
    }

    if (app.boss) {
      await enqueueWorkflowRun(app.boss, run.id);
    }

    return reply.status(201).send({ runId: run.id });
  });

  app.post('/error-report', async (request, reply) => {
    const body = request.body;
    if (!isRecord(body) || typeof body.project !== 'string') {
      return reply.status(400).send({ error: 'invalid payload: missing project' });
    }
    const payload = body as unknown as ErrorReportedBody;

    const deliveryId = firstHeader(request.headers['x-portfolio-delivery']);
    if (!deliveryId) {
      return reply.status(400).send({ error: 'missing X-Portfolio-Delivery header' });
    }

    const resolved = await resolveProject(app.db, payload.project);
    const rawBody = request.rawBody ?? Buffer.from(JSON.stringify(body));

    const signatureValid = verifyRequestSignature({
      secret: resolved?.secret,
      rawBody,
      timestampHeader: request.headers['x-portfolio-timestamp'],
      signatureHeader: request.headers['x-portfolio-signature'],
    });

    if (!resolved || !signatureValid) {
      return reply.status(401).send({ error: 'invalid signature' });
    }

    const delivery = await recordDelivery(app.db, {
      projectId: resolved.project.id,
      deliveryId,
      eventType: 'error.reported',
      signatureValid: true,
      payload: body,
    });

    if (delivery.outcome === 'duplicate') {
      return reply.status(200).send({ status: 'duplicate' });
    }

    // Error path just persists for now: no run, no workflow triggered.
    await app.db.insert(errorEventsTable).values({
      projectId: resolved.project.id,
      deliveryId,
      payload: body,
    });

    return reply.status(201).send({ status: 'recorded' });
  });
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
