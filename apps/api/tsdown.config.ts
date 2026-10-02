import { defineConfig } from 'tsdown';

/**
 * Bundles the server and the `shapio` bin. Runtime `dependencies` stay external (installed by npm);
 * workspace packages (@shapio/cli, @shapio/client, @shapio/schema) are dev dependencies and get bundled,
 * so the published `shapio` package is self-contained.
 */
export default defineConfig({
  entry: { index: 'src/index.ts', cli: 'src/cli.ts', config: 'src/extensions/public.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  dts: { entry: ['src/index.ts', 'src/extensions/public.ts'] },
  sourcemap: true,
  fixedExtension: false,
  clean: true,
});
