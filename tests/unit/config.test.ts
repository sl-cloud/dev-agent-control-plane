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

  it('defaults AI_PROVIDER to fake', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      PLAYWRIGHT_TARGET_URL: 'http://127.0.0.1:3001',
      ADMIN_API_TOKEN: 'x'.repeat(20),
    });
    expect(config.AI_PROVIDER).toBe('fake');
  });

  it('accepts openai provider with an API key', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      PLAYWRIGHT_TARGET_URL: 'http://127.0.0.1:3001',
      ADMIN_API_TOKEN: 'x'.repeat(20),
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test',
    });
    expect(config.AI_PROVIDER).toBe('openai');
    expect(config.OPENAI_API_KEY).toBe('sk-test');
  });

  it('rejects openai provider without an API key', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
        PLAYWRIGHT_TARGET_URL: 'http://127.0.0.1:3001',
        ADMIN_API_TOKEN: 'x'.repeat(20),
        AI_PROVIDER: 'openai',
      }),
    ).toThrow(/OPENAI_API_KEY is required when AI_PROVIDER=openai/);
  });

  it('accepts opencode provider without an API key', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      PLAYWRIGHT_TARGET_URL: 'http://127.0.0.1:3001',
      ADMIN_API_TOKEN: 'x'.repeat(20),
      AI_PROVIDER: 'opencode',
    });
    expect(config.AI_PROVIDER).toBe('opencode');
  });
});
