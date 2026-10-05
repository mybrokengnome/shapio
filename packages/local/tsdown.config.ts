import { defineConfig } from 'tsdown';

/**
 * Bundles the in-process delivery runtime from `@shapio/cms` source (its `./delivery` entry exists only under
 * the `@shapio/source` condition), so this package installs without the server's dependencies (Fastify,
 * argon2, sharp, email). Runtime `dependencies` and optional peers stay external: `@shapio/client` above all,
 * so `ShapioApiError` is the same class in user code and here.
 */
export default defineConfig({
  entry: { index: 'src/index.ts', next: 'src/next.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  dts: { entry: ['src/index.ts', 'src/next.ts'] },
  sourcemap: true,
  fixedExtension: false,
  clean: true,
  external: [/^@aws-sdk\//, 'mysql2'],
  inputOptions: { resolve: { conditionNames: ['@shapio/source', 'import', 'node', 'default'] } },
});
