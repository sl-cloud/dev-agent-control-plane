// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'migrations/**', 'dashboard/**'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      globals: globals.node,
    },
  },
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['src/**/*.ts', 'tests/**/*.ts'],
  })),
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      // Fastify plugin/route-handler signatures are conventionally `async`
      // even when a given handler happens not to await anything.
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    // Root-level config files: plain JS/TS lint rules only, no type-aware
    // linting (they sit outside the app's tsconfig project graph).
    files: ['*.config.js', '*.config.ts'],
    languageOptions: {
      parserOptions: {
        project: null,
      },
    },
  },
  prettier,
);
