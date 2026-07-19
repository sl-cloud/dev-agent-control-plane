export interface GeneratedSpecValidationResult {
  valid: true;
}

const MAX_SPEC_BYTES = 20_000;
const MAX_TEST_COUNT = 12;

const IMPORT_PATTERNS = [
  /import\s+(?:type\s+)?(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g,
  /import\s*['"]([^'"]+)['"]/g,
];

const DENIED_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'process', pattern: /\bprocess\b/ },
  { label: 'fs', pattern: /\bfs\b/ },
  { label: 'child_process', pattern: /\bchild_process\b/ },
  { label: 'fetch', pattern: /\bfetch\b/ },
  { label: 'eval', pattern: /\beval\b/ },
  { label: 'Function(', pattern: /\bFunction\s*\(/ },
  { label: 'require(', pattern: /\brequire\s*\(/ },
];

const ROOT_HOMEPAGE_SMOKE_PATTERN =
  /\btest\s*\(\s*(?:"[^"]*"|'[^']*'|`[^`]*`)\s*,\s*async\s*\(\s*\{\s*page\s*\}\s*\)\s*=>\s*\{\s*const\s+response\s*=\s*await\s+page\.goto\s*\(\s*['"]\/['"]\s*\)\s*;\s*expect\s*\(\s*response\?\.ok\s*\(\s*\)\s*\)\s*\.toBe\s*\(\s*true\s*\)\s*;\s*await\s+expect\s*\(\s*page\s*\)\s*\.toHaveTitle\s*\(\s*\/\.\+\/\s*\)\s*;\s*\}\s*\)\s*;/g;

export class GeneratedSpecValidationError extends Error {
  constructor(readonly violations: string[]) {
    super(`Generated spec validation failed: ${JSON.stringify({ violations })}`);
    this.name = 'GeneratedSpecValidationError';
  }
}

function importSources(specSource: string): string[] {
  const sources = [];
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of specSource.matchAll(pattern)) {
      const source = match[1];
      if (source) {
        sources.push(source);
      }
    }
  }
  return sources;
}

export function generatedSpecViolations(specSource: string): string[] {
  const violations = [];
  const byteLength = Buffer.byteLength(specSource, 'utf8');
  if (byteLength > MAX_SPEC_BYTES) {
    violations.push(`spec source exceeds ${MAX_SPEC_BYTES} bytes`);
  }

  const testCount = [...specSource.matchAll(/\btest\s*\(/g)].length;
  if (testCount > MAX_TEST_COUNT) {
    violations.push(`spec source contains ${testCount} test() calls, maximum is ${MAX_TEST_COUNT}`);
  }

  const homepageSmokeCount = [...specSource.matchAll(ROOT_HOMEPAGE_SMOKE_PATTERN)].length;
  if (testCount > 1 && homepageSmokeCount === testCount) {
    violations.push('spec contains only repeated homepage smoke checks');
  }

  const disallowedImports = importSources(specSource).filter(
    (source) => source !== '@playwright/test',
  );
  for (const source of disallowedImports) {
    violations.push(`import source is not allowed: ${source}`);
  }

  for (const denied of DENIED_PATTERNS) {
    if (denied.pattern.test(specSource)) {
      violations.push(`denied token found: ${denied.label}`);
    }
  }

  if (/https?:\/\//.test(specSource)) {
    violations.push('absolute http(s) URL literals are not allowed');
  }

  return violations;
}

export function validateGeneratedSpecSource(specSource: string): GeneratedSpecValidationResult {
  const violations = generatedSpecViolations(specSource);
  if (violations.length > 0) {
    throw new GeneratedSpecValidationError(violations);
  }
  return { valid: true };
}
