import { describe, expect, it } from 'vitest';
import {
  generatedSpecViolations,
  validateGeneratedSpecSource,
} from '../../src/modules/execution/spec-validator.js';

const SAFE_SPEC = `import { expect, test } from '@playwright/test';

test('loads the homepage', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBe(true);
});
`;

describe('validateGeneratedSpecSource', () => {
  it('accepts a safe generated spec', () => {
    expect(validateGeneratedSpecSource(SAFE_SPEC)).toEqual({ valid: true });
  });

  it.each([
    ['bad import', "import { readFile } from 'node:fs';", 'import source is not allowed'],
    ['process token', `${SAFE_SPEC}\nprocess.env.SECRET;`, 'denied token found: process'],
    ['fs token', `${SAFE_SPEC}\nconst fs = {};`, 'denied token found: fs'],
    [
      'child_process token',
      `${SAFE_SPEC}\nconst name = 'child_process';`,
      'denied token found: child_process',
    ],
    ['fetch token', `${SAFE_SPEC}\nawait fetch('/x');`, 'denied token found: fetch'],
    ['eval token', `${SAFE_SPEC}\neval('1 + 1');`, 'denied token found: eval'],
    [
      'Function constructor',
      `${SAFE_SPEC}\nFunction('return 1');`,
      'denied token found: Function(',
    ],
    ['require call', `${SAFE_SPEC}\nrequire('node:fs');`, 'denied token found: require('],
    [
      'absolute URL',
      `${SAFE_SPEC}\nawait page.goto('https://example.test');`,
      'absolute http(s) URL',
    ],
  ])('rejects %s', (_name, specSource, expectedViolation) => {
    expect(() => validateGeneratedSpecSource(specSource)).toThrow(expectedViolation);
  });

  it('rejects oversized specs', () => {
    const specSource = `${SAFE_SPEC}\n// ${'x'.repeat(20_001)}`;
    expect(generatedSpecViolations(specSource)).toContain('spec source exceeds 20000 bytes');
  });

  it('rejects more than twelve test blocks', () => {
    const specSource = `import { test } from '@playwright/test';\n${Array.from(
      { length: 13 },
      (_, index) => `test('case ${index}', async () => {});`,
    ).join('\n')}`;
    expect(generatedSpecViolations(specSource)).toContain(
      'spec source contains 13 test() calls, maximum is 12',
    );
  });

  it('rejects repeated homepage smoke checks', () => {
    const specSource = `import { expect, test } from '@playwright/test';

test("covers other 1", async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBe(true);
  await expect(page).toHaveTitle(/.+/);
});

test("covers endpoint changed 2", async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBe(true);
  await expect(page).toHaveTitle(/.+/);
});
`;

    expect(generatedSpecViolations(specSource)).toContain(
      'spec contains only repeated homepage smoke checks',
    );
  });

  it('lists every violation in one error', () => {
    expect(() =>
      validateGeneratedSpecSource(
        "import x from 'node:fs';\nprocess.env.X;\nfetch('http://x.test');",
      ),
    ).toThrow(/import source is not allowed.*process.*fetch.*absolute http\(s\) URL/s);
  });
});
