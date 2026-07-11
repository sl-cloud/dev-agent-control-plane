import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_PREFIX = 'sha256=';
const TIMESTAMP_WINDOW_SECONDS = 5 * 60;

export interface VerifyWebhookInput {
  secret: string;
  rawBody: Buffer;
  timestampHeader: string | undefined;
  signatureHeader: string | undefined;
  /** Injectable for tests; defaults to the real clock. */
  now?: () => number;
}

export type VerifyWebhookResult =
  | { valid: true }
  | {
      valid: false;
      reason:
        | 'missing_headers'
        | 'malformed_signature'
        | 'timestamp_out_of_window'
        | 'signature_mismatch';
    };

function computeSignature(secret: string, timestampSeconds: string, rawBody: Buffer): string {
  const mac = createHmac('sha256', secret)
    .update(`${timestampSeconds}.`)
    .update(rawBody)
    .digest('hex');
  return `${SIGNATURE_PREFIX}${mac}`;
}

/**
 * Verify-side counterpart to api-test-gateway's webhook-signing.ts.
 * Recomputes HMAC-SHA256(secret, "<timestampSeconds>.<rawBody>") against the
 * exact raw bytes received, using a constant-time comparison, and enforces a
 * +/- 5 minute timestamp window to bound replay risk.
 */
export function verifyWebhookSignature(input: VerifyWebhookInput): VerifyWebhookResult {
  const { secret, rawBody, timestampHeader, signatureHeader } = input;
  const now = input.now ?? (() => Date.now());

  if (!timestampHeader || !signatureHeader) {
    return { valid: false, reason: 'missing_headers' };
  }

  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    return { valid: false, reason: 'malformed_signature' };
  }

  const timestampSeconds = Number(timestampHeader);
  if (!Number.isFinite(timestampSeconds) || !/^\d+$/.test(timestampHeader)) {
    return { valid: false, reason: 'malformed_signature' };
  }

  const nowSeconds = Math.floor(now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > TIMESTAMP_WINDOW_SECONDS) {
    return { valid: false, reason: 'timestamp_out_of_window' };
  }

  const expected = computeSignature(secret, timestampHeader, rawBody);
  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(signatureHeader, 'utf8');

  // timingSafeEqual throws on length mismatch: guard it explicitly so a
  // malformed/short header can never throw out of this function.
  if (expectedBuf.length !== actualBuf.length) {
    return { valid: false, reason: 'signature_mismatch' };
  }

  if (!timingSafeEqual(expectedBuf, actualBuf)) {
    return { valid: false, reason: 'signature_mismatch' };
  }

  return { valid: true };
}
