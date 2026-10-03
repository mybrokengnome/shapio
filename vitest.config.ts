import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defaultClientConditions, defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// Workspace packages resolve to their TypeScript source in tests (no build needed).
const SOURCE_CONDITION = '@shapio/source';
const resolve = { conditions: [SOURCE_CONDITION, ...defaultClientConditions] };
const ssr = { resolve: { conditions: [SOURCE_CONDITION, ...defaultServerConditions] } };
// Server-side tests resolve packages the way Node does: without Vite's `module` condition, which points
// some packages (the AWS SDK) at ESM builds with extensionless imports that only bundlers can load.
const NODE_CONDITIONS = [
  SOURCE_CONDITION,
  ...defaultServerConditions.filter((condition) => condition !== 'module'),
];
// Node ignores graphql's `module` field (it has no `exports`) and loads its CommonJS build; Vite would pick
// index.mjs for Shapio's source while mercurius requires the CommonJS one, and graphql-js rejects schemas
// across the two copies. Point every import at the build Node uses.
const GRAPHQL_MAIN = createRequire(new URL('./apps/api/package.json', import.meta.url)).resolve('graphql');
const nodeResolve = {
  conditions: NODE_CONDITIONS,
  alias: [{ find: /^graphql$/, replacement: GRAPHQL_MAIN }],
};
const nodeSsr = { resolve: { conditions: NODE_CONDITIONS } };

export default defineConfig({
  test: {
    // A root-only option in Vitest 5 (projects cannot set it): a project without test files is not a failure.
    passWithNoTests: true,
    projects: [
      {
        resolve: nodeResolve,
        ssr: nodeSsr,
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            'packages/*/src/**/*.test.ts',
            'apps/api/src/**/*.test.ts',
            'examples/next/src/**/*.test.ts',
          ],
        },
      },
      {
        resolve: nodeResolve,
        ssr: nodeSsr,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['apps/api/test/**/*.int.test.ts'],
          globalSetup: ['apps/api/test/globalSetup.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        // The admin's `@/` alias (apps/admin/vite.config.ts) must resolve in its tests too.
        resolve: { ...resolve, alias: { '@': fileURLToPath(new URL('./apps/admin/src', import.meta.url)) } },
        ssr,
        test: {
          name: 'admin',
          root: 'apps/admin',
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
});
