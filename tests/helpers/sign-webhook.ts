import { createHmac, randomUUID } from 'node:crypto';

// Test-only hand-port of api-test-gateway's src/lib/webhook-signing.ts.
// The two repos don't share a package, so this is a deliberate duplication
// scoped to tests: it must stay byte-for-byte identical to the sending
// side's signing logic so integration tests exercise the real contract.

export interface SignedWebhookHeaders {
  'X-Portfolio-Event': string;
  'X-Portfolio-Delivery': string;
  'X-Portfolio-Timestamp': string;
  'X-Portfolio-Signature': string;
  'Content-Type': 'application/json';
}

/** HMAC-SHA256(secret, timestamp + "." + rawBody), binding the timestamp into the MAC. */
export function signWebhookBody(secret: string, timestampSeconds: number, rawBody: string): string {
  const mac = createHmac('sha256', secret).update(`${timestampSeconds}.${rawBody}`).digest('hex');
  return `sha256=${mac}`;
}

/** Builds the full header set for an outbound signed webhook request. */
export function buildSignedWebhookHeaders(
  event: string,
  secret: string,
  rawBody: string,
  deliveryId: string = randomUUID(),
): SignedWebhookHeaders {
  const timestampSeconds = Math.floor(Date.now() / 1000);
  return {
    'X-Portfolio-Event': event,
    'X-Portfolio-Delivery': deliveryId,
    'X-Portfolio-Timestamp': String(timestampSeconds),
    'X-Portfolio-Signature': signWebhookBody(secret, timestampSeconds, rawBody),
    'Content-Type': 'application/json',
  };
}
