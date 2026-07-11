import { describe, expect, it } from 'vitest';
import { verifyWebhookSignature } from '../../src/lib/webhook-verify.js';
import { signWebhookBody } from '../helpers/sign-webhook.js';

const SECRET = 'test-secret-value';

function sign(body: string, timestampSeconds: number): string {
  return signWebhookBody(SECRET, timestampSeconds, body);
}

describe('verifyWebhookSignature', () => {
  it('accepts a validly signed request', () => {
    const body = '{"hello":"world"}';
    const nowSeconds = Math.floor(Date.now() / 1000);
    const result = verifyWebhookSignature({
      secret: SECRET,
      rawBody: Buffer.from(body, 'utf8'),
      timestampHeader: String(nowSeconds),
      signatureHeader: sign(body, nowSeconds),
    });
    expect(result.valid).toBe(true);
  });

  it('rejects a tampered body', () => {
    const body = '{"hello":"world"}';
    const nowSeconds = Math.floor(Date.now() / 1000);
    const signature = sign(body, nowSeconds);
    const result = verifyWebhookSignature({
      secret: SECRET,
      rawBody: Buffer.from('{"hello":"tampered"}', 'utf8'),
      timestampHeader: String(nowSeconds),
      signatureHeader: signature,
    });
    expect(result).toEqual({ valid: false, reason: 'signature_mismatch' });
  });

  it('rejects a tampered signature', () => {
    const body = '{"hello":"world"}';
    const nowSeconds = Math.floor(Date.now() / 1000);
    const result = verifyWebhookSignature({
      secret: SECRET,
      rawBody: Buffer.from(body, 'utf8'),
      timestampHeader: String(nowSeconds),
      signatureHeader: `sha256=${'0'.repeat(64)}`,
    });
    expect(result).toEqual({ valid: false, reason: 'signature_mismatch' });
  });

  it('rejects a stale timestamp (older than 5 minutes)', () => {
    const body = '{"hello":"world"}';
    const staleSeconds = Math.floor(Date.now() / 1000) - 6 * 60;
    const result = verifyWebhookSignature({
      secret: SECRET,
      rawBody: Buffer.from(body, 'utf8'),
      timestampHeader: String(staleSeconds),
      signatureHeader: sign(body, staleSeconds),
    });
    expect(result).toEqual({ valid: false, reason: 'timestamp_out_of_window' });
  });

  it('rejects a future timestamp (more than 5 minutes ahead)', () => {
    const body = '{"hello":"world"}';
    const futureSeconds = Math.floor(Date.now() / 1000) + 6 * 60;
    const result = verifyWebhookSignature({
      secret: SECRET,
      rawBody: Buffer.from(body, 'utf8'),
      timestampHeader: String(futureSeconds),
      signatureHeader: sign(body, futureSeconds),
    });
    expect(result).toEqual({ valid: false, reason: 'timestamp_out_of_window' });
  });

  it('rejects a malformed signature header (no sha256= prefix)', () => {
    const body = '{"hello":"world"}';
    const nowSeconds = Math.floor(Date.now() / 1000);
    const result = verifyWebhookSignature({
      secret: SECRET,
      rawBody: Buffer.from(body, 'utf8'),
      timestampHeader: String(nowSeconds),
      signatureHeader: 'not-a-real-signature',
    });
    expect(result).toEqual({ valid: false, reason: 'malformed_signature' });
  });

  it('rejects a non-numeric timestamp header', () => {
    const body = '{"hello":"world"}';
    const result = verifyWebhookSignature({
      secret: SECRET,
      rawBody: Buffer.from(body, 'utf8'),
      timestampHeader: 'not-a-number',
      signatureHeader: `sha256=${'0'.repeat(64)}`,
    });
    expect(result).toEqual({ valid: false, reason: 'malformed_signature' });
  });

  it('reports missing headers distinctly', () => {
    const result = verifyWebhookSignature({
      secret: SECRET,
      rawBody: Buffer.from('{}', 'utf8'),
      timestampHeader: undefined,
      signatureHeader: undefined,
    });
    expect(result).toEqual({ valid: false, reason: 'missing_headers' });
  });

  it('never throws on a length-mismatched signature (timingSafeEqual guard)', () => {
    const body = '{"hello":"world"}';
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(() =>
      verifyWebhookSignature({
        secret: SECRET,
        rawBody: Buffer.from(body, 'utf8'),
        timestampHeader: String(nowSeconds),
        signatureHeader: 'sha256=short',
      }),
    ).not.toThrow();

    const result = verifyWebhookSignature({
      secret: SECRET,
      rawBody: Buffer.from(body, 'utf8'),
      timestampHeader: String(nowSeconds),
      signatureHeader: 'sha256=short',
    });
    expect(result).toEqual({ valid: false, reason: 'signature_mismatch' });
  });
});
