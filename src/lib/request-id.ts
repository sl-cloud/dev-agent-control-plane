import { randomBytes } from 'node:crypto';

/** UUIDv7 generator (RFC 9562). */
export function generateRequestId(): string {
  const timestamp = Date.now();
  const rand = randomBytes(10);

  const bytes = Buffer.alloc(16);
  bytes.writeUIntBE(timestamp, 0, 6);

  bytes[6] = 0x70 | (rand[0]! & 0x0f); // version 7
  bytes[7] = rand[1]!;
  bytes[8] = 0x80 | (rand[2]! & 0x3f); // variant 10
  rand.copy(bytes, 9, 3, 10);

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
