import { describe, expect, it } from 'vitest';
import { buildContractCandidatePaths } from '../../src/modules/scm/source-context.js';

describe('buildContractCandidatePaths', () => {
  it('includes routes, schemas, auth, docs, and changed-module contract files', () => {
    const allFiles = [
      'src/app.ts',
      'src/server.ts',
      'src/plugins/auth.ts',
      'src/plugins/docs.ts',
      'src/plugins/error-handler.ts',
      'src/modules/auth/routes.ts',
      'src/modules/auth/schemas.ts',
      'src/modules/users/routes.ts',
      'src/modules/users/schemas.ts',
      'src/modules/projects/routes.ts',
      'src/modules/projects/schemas.ts',
      'src/modules/projects/service.ts',
      'src/modules/projects/policies.ts',
      'src/modules/tasks/routes.ts',
      'src/modules/tasks/schemas.ts',
      'src/modules/tasks/service.ts',
      'src/modules/tasks/policies.ts',
      'src/modules/tasks/transitions.ts',
      'src/db/schema.ts',
      'package-lock.json',
      'migrations/0000_init.sql',
    ];

    const paths = buildContractCandidatePaths(allFiles, [
      'src/modules/tasks/service.ts',
      'src/modules/tasks/routes.ts',
    ]);

    expect(paths).toEqual(
      expect.arrayContaining([
        'src/app.ts',
        'src/server.ts',
        'src/plugins/auth.ts',
        'src/plugins/docs.ts',
        'src/plugins/error-handler.ts',
        'src/modules/auth/routes.ts',
        'src/modules/auth/schemas.ts',
        'src/modules/users/routes.ts',
        'src/modules/users/schemas.ts',
        'src/modules/projects/routes.ts',
        'src/modules/projects/schemas.ts',
        'src/modules/tasks/routes.ts',
        'src/modules/tasks/schemas.ts',
        'src/modules/tasks/service.ts',
      ]),
    );
    expect(paths).not.toContain('package-lock.json');
    expect(paths).not.toContain('migrations/0000_init.sql');
  });
});
