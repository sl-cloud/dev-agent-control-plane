import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import { webhookEventsTable, type WebhookEvent } from '../../db/schema.js';

export interface RecordDeliveryInput {
  projectId: string;
  deliveryId: string;
  eventType: string;
  signatureValid: boolean;
  payload: unknown;
}

export type RecordDeliveryResult =
  { outcome: 'recorded'; event: WebhookEvent } | { outcome: 'duplicate'; event: WebhookEvent };

/**
 * Insert-or-detect-duplicate against webhook_events. The unique(projectId,
 * deliveryId) constraint is the idempotency mechanism: a conflicting insert
 * means this exact delivery was already recorded, so we look it up and
 * report it as a duplicate rather than erroring.
 */
export async function recordDelivery(
  db: Db,
  input: RecordDeliveryInput,
): Promise<RecordDeliveryResult> {
  try {
    const [event] = await db
      .insert(webhookEventsTable)
      .values({
        projectId: input.projectId,
        deliveryId: input.deliveryId,
        eventType: input.eventType,
        signatureValid: input.signatureValid,
        payload: input.payload,
      })
      .returning();

    if (!event) {
      throw new Error('insert into webhook_events returned no row');
    }

    return { outcome: 'recorded', event };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const existing = await db.query.webhookEventsTable.findFirst({
        where: and(
          eq(webhookEventsTable.projectId, input.projectId),
          eq(webhookEventsTable.deliveryId, input.deliveryId),
        ),
      });
      if (existing) {
        return { outcome: 'duplicate', event: existing };
      }
    }
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  // node-postgres errors carry `code` directly; drizzle-orm wraps them in a
  // DrizzleQueryError whose `.cause` is the original pg error, so check both.
  if ('code' in err && (err as { code?: string }).code === '23505') {
    return true;
  }
  const cause = (err as { cause?: unknown }).cause;
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    return (cause as { code?: string }).code === '23505';
  }
  return false;
}
