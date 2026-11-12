import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * The differential's vitest config: runs `workload.diff.ts` against the source tree in MAIN_DIFF_REPO (an
 * extracted main, or this repository). The workload imports this repository's source and test helpers by
 * relative path; a resolver sends each such import to the same file in MAIN_DIFF_REPO.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const BRANCH = resolve(HERE, '../../../../..');
const REPO = process.env.MAIN_DIFF_REPO ?? BRANCH;
const CONDITIONS = [
  '@shapio/source',
  ...defaultServerConditions.filter((condition) => condition !== 'module'),
];
const GRAPHQL = createRequire(`${REPO}/apps/api/package.json`).resolve('graphql');

export default defineConfig({
  root: REPO,
  plugins: [
    {
      name: 'main-diff-side',
      enforce: 'pre',
      async resolveId(source, importer) {
        if (!importer?.endsWith('workload.diff.ts') || !source.startsWith('.')) {
          return null;
        }
        const target = resolve(dirname(importer), source);
        if (!target.startsWith(`${BRANCH}/apps/api/`) || REPO === BRANCH) {
          return null;
        }
        const resolved = await this.resolve(`${REPO}${target.slice(BRANCH.length)}`, importer, {
          skipSelf: true,
        });
        return resolved;
      },
    },
  ],
  resolve: { conditions: CONDITIONS, alias: [{ find: /^graphql$/, replacement: GRAPHQL }] },
  ssr: { resolve: { conditions: CONDITIONS } },
  server: { fs: { strict: false } },
  test: {
    environment: 'node',
    include: [`${HERE}/workload.diff.ts`],
    testTimeout: 900_000,
    hookTimeout: 900_000,
  },
});
