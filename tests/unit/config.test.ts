import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/index.js';

describe('loadConfig', () => {
  it('parses a valid environment', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      ADMIN_API_TOKEN: 'x'.repeat(20),
    });
    expect(config.PORT).toBe(3000);
    expect(config.NODE_ENV).toBe('development');
  });

  it('throws on missing required vars', () => {
    expect(() => loadConfig({})).toThrow(/Invalid environment configuration/);
  });
});
