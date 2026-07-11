import { verifyWebhookSignature } from '../../lib/webhook-verify.js';

export interface VerifyRequestSignatureInput {
  secret: string | undefined;
  rawBody: Buffer;
  timestampHeader: string | string[] | undefined;
  signatureHeader: string | string[] | undefined;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Thin adapter over verifyWebhookSignature for Fastify header shapes
 * (string | string[] | undefined) and an unresolved secret (unknown
 * project, or a configured-but-unset env var), both of which must verify
 * as false rather than throw.
 */
export function verifyRequestSignature(input: VerifyRequestSignatureInput): boolean {
  if (!input.secret) {
    return false;
  }

  const result = verifyWebhookSignature({
    secret: input.secret,
    rawBody: input.rawBody,
    timestampHeader: firstHeaderValue(input.timestampHeader),
    signatureHeader: firstHeaderValue(input.signatureHeader),
  });

  return result.valid;
}
