import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/index.js';

describe('loadConfig', () => {
  it('parses a valid environment', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      PLAYWRIGHT_TARGET_URL: 'http://127.0.0.1:3001',
      ADMIN_API_TOKEN: 'x'.repeat(20),
    });
    expect(config.PORT).toBe(3000);
    expect(config.NODE_ENV).toBe('development');
  });

  it('throws on missing required vars', () => {
    expect(() => loadConfig({})).toThrow(/Invalid environment configuration/);
  });
});
